#!/usr/bin/env node
/**
 * `pnpm baseline:capture` / `pnpm baseline:verify` (P0-01 P-stage implementation
 * of the C-stage contract in `tests/release/baseline-fingerprint.spec.ts` and
 * `docs/audit/baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md`).
 *
 * `capture` derives the architecture/protocol-critical fingerprint of a
 * checkout — commit, the toolchain the checkout declares, workspace package
 * names, every package manifest field by field, default bundle row ids and
 * each row's content, protocol/event and `spec/*.schema.json` schema file
 * hashes, and the pnpm lockfile hash — and writes it canonically to
 * `.dsh/baseline.json` plus a human-readable
 * `docs/audit/baseline-fingerprint-<gitSha>.md`, which also names the Node and
 * pnpm that captured it. `verify` re-derives the same fields from the current
 * working tree and compares them against the last capture, exiting nonzero and
 * writing `.dsh/rebase-report.json` when a tracked file has drifted. Each drift
 * entry names the file and the smallest element that changed: one manifest
 * field, one bundle row, one schema file.
 *
 * Nothing in `.dsh/baseline.json` depends on the machine that captured it, so
 * one clean checkout captures the same file on Linux and macOS (P0-01
 * acceptance[0]): the toolchain it records is the one the root `package.json`
 * declares, and verify does not compare toolchains, because a change to the
 * declaration is a change to that manifest.
 *
 * CLI: `node scripts/release/baseline-fingerprint.mjs <capture|verify> [--repo-root <path>]`
 * `--repo-root` defaults to `process.cwd()`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, sep } from 'node:path'
import { JSON_SCHEMA, Type, load as parseYaml } from 'js-yaml'

const FORMAT_VERSION = 2
const PROTOCOL_SCHEMA_PATHS = ['packages/sdk/protocol/src/types.ts', 'packages/core/session/src/known-event-types.ts']
/** The directory whose `*.schema.json` files are key schemas beside the two protocol files. */
const SPEC_SCHEMA_DIR = 'spec'
const BUNDLE_ROWS_PATH = 'packages/bundle/base/cordis.patch.yml'
const WORKSPACE_MANIFEST_PATH = 'pnpm-workspace.yaml'
const ROOT_MANIFEST_PATH = 'package.json'
const PNPM_LOCK_PATH = 'pnpm-lock.yaml'

/** `cordis.patch.yml` carries Loader `!!js` expressions (see `scripts/cordis-yaml.ts`); preserve them as opaque data rather than executing or rejecting them. */
const cordisJsExprType = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
})
const cordisSchema = JSON_SCHEMA.extend(cordisJsExprType)

function repoRootArg(args) {
  const index = args.indexOf('--repo-root')
  if (index === -1) return process.cwd()
  if (index + 1 >= args.length) throw new Error('baseline-fingerprint: --repo-root requires a path')
  return args[index + 1]
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key])
    return sorted
  }
  return value
}

function canonicalJson(value) {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`.normalize('NFC')
}

/** The sha256 of a value's canonical JSON, so equal content hashes alike whatever its key order. */
function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function escapeRegExpLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A path under the checkout, relative and `/`-separated whatever path the checkout was reached by. */
function posixRelative(repoRoot, path) {
  return relative(repoRoot, path).split(sep).join('/')
}

/** Expands one `pnpm-workspace.yaml` glob pattern (literal segments plus single-`*` wildcards) to matching directories under `root`. */
function expandWorkspacePattern(root, pattern) {
  let dirs = [root]
  for (const segment of pattern.split('/')) {
    const next = []
    for (const dir of dirs) {
      if (segment.includes('*')) {
        let entries
        try {
          entries = readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }
        const regex = new RegExp(`^${segment.split('*').map(escapeRegExpLiteral).join('.*')}$`)
        for (const entry of entries) {
          if (entry.isDirectory() && regex.test(entry.name)) next.push(join(dir, entry.name))
        }
      } else {
        const candidate = join(dir, segment)
        if (existsSync(candidate) && statSync(candidate).isDirectory()) next.push(candidate)
      }
    }
    dirs = next
  }
  return dirs
}

/** Every workspace package manifest, as its path under the checkout and its parsed content, in path order. */
function readWorkspaceManifests(repoRoot) {
  const manifest = parseYaml(readFileSync(join(repoRoot, WORKSPACE_MANIFEST_PATH), 'utf8'))
  const patterns = (manifest && manifest.packages) || []
  const found = new Map()
  for (const pattern of patterns) {
    for (const dir of expandWorkspacePattern(repoRoot, pattern)) {
      const packageJsonPath = join(dir, 'package.json')
      if (!existsSync(packageJsonPath)) continue
      found.set(posixRelative(repoRoot, packageJsonPath), JSON.parse(readFileSync(packageJsonPath, 'utf8')))
    }
  }
  return [...found].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
}

function readWorkspacePackages(manifests) {
  const names = new Set()
  for (const [, pkg] of manifests) if (typeof pkg.name === 'string') names.add(pkg.name)
  return [...names].sort()
}

/**
 * Every package manifest, the root one included, field by field: a manifest's
 * path under the checkout maps to the hash of each top-level field's value, so
 * a drift names the field that changed rather than only the file.
 */
function readPackageManifests(repoRoot, manifests) {
  const byPath = {}
  const root = JSON.parse(readFileSync(join(repoRoot, ROOT_MANIFEST_PATH), 'utf8'))
  for (const [path, manifest] of [[ROOT_MANIFEST_PATH, root], ...manifests]) {
    const fields = {}
    for (const [field, value] of Object.entries(manifest)) fields[field] = hashValue(value)
    byPath[path] = fields
  }
  return byPath
}

/**
 * Walks a patch document and records every object carrying a string `id` — the
 * `rows: [{ id }]` fixture shape and the real Cordis patch shape
 * (`- insert: [{ id, name, config }]`, with row groups nesting further row
 * arrays under `config`) alike — in document order. A row's content is the row
 * with each nested row replaced by its id, so a change inside a nested row is
 * that row's change alone.
 */
function collectRows(node, rows) {
  if (Array.isArray(node)) {
    for (const item of node) collectRows(item, rows)
    return
  }
  if (node !== null && typeof node === 'object') {
    if (typeof node.id === 'string') rows.push({ id: node.id, content: withNestedRowsAsIds(node) })
    for (const value of Object.values(node)) collectRows(value, rows)
  }
}

function withNestedRowsAsIds(row) {
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip)
    if (value !== null && typeof value === 'object') {
      if (typeof value.id === 'string') return { id: value.id }
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, strip(inner)]))
    }
    return value
  }
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, strip(value)]))
}

/**
 * The default bundle's rows: their distinct ids sorted, every row in document
 * order, and each row's content hash. A second row reusing an id is keyed
 * `<id>#2`, and so on, so neither hides the other.
 */
function readBundleRows(repoRoot) {
  const patch = parseYaml(readFileSync(join(repoRoot, BUNDLE_ROWS_PATH), 'utf8'), { schema: cordisSchema })
  const rows = []
  collectRows(patch, rows)
  const order = []
  const content = {}
  const seen = new Map()
  for (const row of rows) {
    const count = (seen.get(row.id) ?? 0) + 1
    seen.set(row.id, count)
    const key = count === 1 ? row.id : `${row.id}#${count}`
    order.push(key)
    content[key] = hashValue(row.content)
  }
  return { ids: [...seen.keys()].sort(), order, rows: content }
}

function readProtocolSchemaHashes(repoRoot) {
  const specDir = join(repoRoot, SPEC_SCHEMA_DIR)
  const specSchemas = existsSync(specDir)
    ? readdirSync(specDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.schema.json'))
      .map(entry => `${SPEC_SCHEMA_DIR}/${entry.name}`)
    : []
  const hashes = {}
  for (const relPath of [...PROTOCOL_SCHEMA_PATHS, ...specSchemas.sort()]) {
    const content = readFileSync(join(repoRoot, relPath))
    hashes[relPath] = createHash('sha256').update(content).digest('hex')
  }
  return hashes
}

function readPnpmLockHash(repoRoot) {
  const content = readFileSync(join(repoRoot, PNPM_LOCK_PATH))
  return createHash('sha256').update(content).digest('hex')
}

/**
 * The toolchain the checkout declares in its root `package.json`: `engines.node`
 * and the version `packageManager` pins for pnpm, `null` where it declares none.
 * A property of the checkout rather than of the machine capturing it.
 */
function readDeclaredToolchain(repoRoot) {
  const root = JSON.parse(readFileSync(join(repoRoot, ROOT_MANIFEST_PATH), 'utf8'))
  const node = typeof root.engines?.node === 'string' ? root.engines.node : null
  const pinned = typeof root.packageManager === 'string' ? /^pnpm@(?<version>[^+]+)/u.exec(root.packageManager) : null
  return { node, pnpm: pinned?.groups?.version ?? null }
}

function captureFields(repoRoot) {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const manifests = readWorkspaceManifests(repoRoot)
  const { ids, order, rows } = readBundleRows(repoRoot)
  return {
    formatVersion: FORMAT_VERSION,
    gitSha,
    toolchain: capturingToolchain(repoRoot),
    workspacePackages: readWorkspacePackages(manifests),
    packageManifests: readPackageManifests(repoRoot, manifests),
    defaultBundleRowIds: ids,
    bundleRows: { order, rows },
    protocolSchemaHashes: readProtocolSchemaHashes(repoRoot),
    pnpmLockHash: readPnpmLockHash(repoRoot),
  }
}

/** The Node and pnpm running this capture, which the audit document records and the fingerprint does not. */
function capturingToolchain(repoRoot) {
  const pnpm = execFileSync('pnpm', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  return { node: process.versions.node, pnpm }
}

function writeAuditDoc(repoRoot, fields, capturing) {
  const docPath = join(repoRoot, 'docs/audit', `baseline-fingerprint-${fields.gitSha}.md`)
  const schemaRows = Object.keys(fields.protocolSchemaHashes)
    .sort()
    .map((path) => `- \`${path}\`: \`${fields.protocolSchemaHashes[path]}\``)
    .join('\n')
  const declared = (version) => (version === null ? 'not declared' : `\`${version}\``)
  const content = `# Baseline fingerprint report — \`pnpm baseline:capture\`

## 1. Identity

- Git SHA: \`${fields.gitSha}\`
- Toolchain the checkout declares: Node ${declared(fields.toolchain.node)}, pnpm ${declared(fields.toolchain.pnpm)}
- Captured with: Node \`${capturing.node}\`, pnpm \`${capturing.pnpm}\` (recorded here only; the fingerprint does not depend on it)

## 2. Fields

- \`formatVersion\`: ${fields.formatVersion}
- \`workspacePackages\` (${fields.workspacePackages.length}): ${fields.workspacePackages.join(', ')}
- \`packageManifests\`: ${Object.keys(fields.packageManifests).length} manifests, each field hashed
- \`defaultBundleRowIds\` (${fields.defaultBundleRowIds.length}): ${fields.defaultBundleRowIds.join(', ')}
- \`bundleRows\`: ${fields.bundleRows.order.length} rows, each hashed
- \`protocolSchemaHashes\`:
${schemaRows}
- \`pnpmLockHash\`: \`${fields.pnpmLockHash}\`

Generated by \`scripts/release/baseline-fingerprint.mjs capture\`; canonical machine format is \`.dsh/baseline.json\`.
`
  writeFileSync(docPath, content)
}

function capture(repoRoot) {
  const fields = captureFields(repoRoot)
  mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
  writeFileSync(join(repoRoot, '.dsh/baseline.json'), canonicalJson(fields))
  mkdirSync(join(repoRoot, 'docs/audit'), { recursive: true })
  writeAuditDoc(repoRoot, fields, capturingToolchain(repoRoot))
  return 0
}

/** The names in `before` and not in `after`, and the reverse: a membership change as the members that moved. */
function membershipChange(before, after) {
  const kept = new Set(after)
  const had = new Set(before)
  return { removed: before.filter(name => !kept.has(name)), added: after.filter(name => !had.has(name)) }
}

function diffCapture(stored, fresh) {
  const drift = []
  const addSimple = (path, field) => {
    if (stored[field] !== fresh[field]) drift.push({ path, field, expected: stored[field], actual: fresh[field] })
  }
  addSimple('formatVersion', 'formatVersion')
  // A baseline in another format holds other fields; comparing them field by
  // field would report every one as drift. The format is the one difference.
  if (stored.formatVersion !== fresh.formatVersion) return drift
  addSimple('HEAD', 'gitSha')
  for (const tool of ['node', 'pnpm']) {
    if (stored.toolchain[tool] !== fresh.toolchain[tool]) {
      drift.push({ path: `toolchain.${tool}`, field: `toolchain.${tool}`, expected: stored.toolchain[tool], actual: fresh.toolchain[tool] })
    }
  }
  const packages = membershipChange(stored.workspacePackages, fresh.workspacePackages)
  if (packages.removed.length > 0 || packages.added.length > 0) {
    drift.push({ path: WORKSPACE_MANIFEST_PATH, field: 'workspacePackages', expected: packages.removed, actual: packages.added })
  }
  const manifestPaths = new Set([...Object.keys(stored.packageManifests), ...Object.keys(fresh.packageManifests)])
  for (const path of [...manifestPaths].sort()) {
    const before = stored.packageManifests[path]
    const after = fresh.packageManifests[path]
    if (before === undefined || after === undefined) {
      drift.push({ path, field: 'manifest', expected: before === undefined ? null : 'present', actual: after === undefined ? null : 'present' })
      continue
    }
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (before[field] !== after[field]) drift.push({ path, field, expected: before[field] ?? null, actual: after[field] ?? null })
    }
  }
  // A row added or removed is reported once, as a change to the row ids, and
  // only the ids that moved; a row both captures hold is compared by content,
  // then by its position among the rows they share.
  const rows = membershipChange(stored.bundleRows.order, fresh.bundleRows.order)
  if (rows.removed.length > 0 || rows.added.length > 0) {
    drift.push({ path: BUNDLE_ROWS_PATH, field: 'defaultBundleRowIds', expected: rows.removed, actual: rows.added })
  }
  const shared = (order, other) => order.filter(key => Object.hasOwn(other.rows, key))
  const storedOrder = shared(stored.bundleRows.order, fresh.bundleRows)
  const freshOrder = shared(fresh.bundleRows.order, stored.bundleRows)
  for (const key of [...storedOrder].sort()) {
    if (stored.bundleRows.rows[key] !== fresh.bundleRows.rows[key]) {
      drift.push({ path: BUNDLE_ROWS_PATH, field: `row ${key}`, expected: stored.bundleRows.rows[key], actual: fresh.bundleRows.rows[key] })
    }
  }
  if (JSON.stringify(storedOrder) !== JSON.stringify(freshOrder)) {
    drift.push({ path: BUNDLE_ROWS_PATH, field: 'row order', expected: storedOrder, actual: freshOrder })
  }
  addSimple(PNPM_LOCK_PATH, 'pnpmLockHash')
  const schemaPaths = new Set([...Object.keys(stored.protocolSchemaHashes), ...Object.keys(fresh.protocolSchemaHashes)])
  for (const path of schemaPaths) {
    if (stored.protocolSchemaHashes[path] !== fresh.protocolSchemaHashes[path]) {
      drift.push({
        path,
        field: 'protocolSchemaHashes',
        expected: stored.protocolSchemaHashes[path],
        actual: fresh.protocolSchemaHashes[path],
      })
    }
  }
  return drift
}

/**
 * Diff the current working tree's fields against `<repoRoot>/.dsh/baseline.json`,
 * writing `.dsh/rebase-report.json` when drift is found. Shared by `pnpm
 * baseline:verify` (this CLI) and the boot-time `dsh-baseline-preflight` guard
 * plugin — one source of truth for the drift check the P0-01 MUST clause
 * requires before every execution batch.
 * @param {string} repoRoot - checkout root to verify (matches `capture`'s `--repo-root`).
 * @returns {{ ok: boolean, drift: { path: string, field: string, expected: unknown, actual: unknown }[] }}
 * @throws when no baseline has been captured at `<repoRoot>/.dsh/baseline.json`.
 */
export function verifyBaseline(repoRoot) {
  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) {
    throw new Error(`baseline-fingerprint verify: no captured baseline at ${baselinePath}; run \`pnpm baseline:capture\` first`)
  }
  const stored = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const fresh = captureFields(repoRoot)
  const drift = diffCapture(stored, fresh)
  if (drift.length > 0) {
    mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
    writeFileSync(join(repoRoot, '.dsh/rebase-report.json'), `${JSON.stringify({ drift }, null, 2)}\n`)
  }
  return { ok: drift.length === 0, drift }
}

function verify(repoRoot) {
  let result
  try {
    result = verifyBaseline(repoRoot)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
  if (result.ok) {
    process.stdout.write('baseline-fingerprint verify: no drift detected\n')
    return 0
  }
  const lines = ['baseline-fingerprint verify: drift detected against the captured baseline:']
  for (const entry of result.drift) {
    lines.push(`  ${entry.path} (${entry.field}): expected ${JSON.stringify(entry.expected)}, found ${JSON.stringify(entry.actual)}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return 1
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  const repoRoot = repoRootArg(rest)
  if (subcommand === 'capture') process.exit(capture(repoRoot))
  if (subcommand === 'verify') process.exit(verify(repoRoot))
  throw new Error(`baseline-fingerprint: unknown subcommand ${JSON.stringify(subcommand)}`)
}

// Guarded so `verifyBaseline` can be imported as a module (the
// `dsh-baseline-preflight` boot-time gate does exactly this) without also
// running the CLI against the importer's own argv.
if (import.meta.main) main()
