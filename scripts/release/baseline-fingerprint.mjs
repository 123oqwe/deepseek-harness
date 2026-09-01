#!/usr/bin/env node
/**
 * `pnpm baseline:capture` / `pnpm baseline:verify` (P0-01 P-stage implementation
 * of the C-stage contract in `tests/release/baseline-fingerprint.spec.ts` and
 * `docs/audit/baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md`).
 *
 * `capture` derives the architecture/protocol-critical fingerprint of a
 * checkout — commit, toolchain versions, workspace package names, default
 * bundle row ids, protocol/event schema file hashes, and the pnpm lockfile
 * hash — and writes it canonically to `.dsh/baseline.json` plus a human-readable
 * `docs/audit/baseline-fingerprint-<gitSha>.md`. `verify` re-derives the same
 * fields from the current working tree and compares them against the last
 * capture, exiting nonzero and writing `.dsh/rebase-report.json` when a
 * tracked file has drifted.
 *
 * CLI: `node scripts/release/baseline-fingerprint.mjs <capture|verify> [--repo-root <path>]`
 * `--repo-root` defaults to `process.cwd()`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { JSON_SCHEMA, Type, load as parseYaml } from 'js-yaml'

const FORMAT_VERSION = 1
const PROTOCOL_SCHEMA_PATHS = ['packages/sdk/protocol/src/types.ts', 'packages/core/session/src/known-event-types.ts']
const BUNDLE_ROWS_PATH = 'packages/bundle/base/cordis.patch.yml'
const WORKSPACE_MANIFEST_PATH = 'pnpm-workspace.yaml'
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

function escapeRegExpLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function readWorkspacePackages(repoRoot) {
  const manifestPath = join(repoRoot, WORKSPACE_MANIFEST_PATH)
  const manifest = parseYaml(readFileSync(manifestPath, 'utf8'))
  const patterns = (manifest && manifest.packages) || []
  const names = new Set()
  for (const pattern of patterns) {
    for (const dir of expandWorkspacePattern(repoRoot, pattern)) {
      const packageJsonPath = join(dir, 'package.json')
      if (!existsSync(packageJsonPath)) continue
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      if (typeof pkg.name === 'string') names.add(pkg.name)
    }
  }
  return [...names].sort()
}

/** Recursively collects every `id` string on any object nested in a patch document — the `rows: [{ id }]` fixture shape and the real Cordis patch shape (`- insert: [{ id, name, config }]`, with row groups nesting further row arrays under `config`) alike. */
function collectRowIds(node, ids) {
  if (Array.isArray(node)) {
    for (const item of node) collectRowIds(item, ids)
    return
  }
  if (node !== null && typeof node === 'object') {
    if (typeof node.id === 'string') ids.push(node.id)
    for (const value of Object.values(node)) collectRowIds(value, ids)
  }
}

function readDefaultBundleRowIds(repoRoot) {
  const patch = parseYaml(readFileSync(join(repoRoot, BUNDLE_ROWS_PATH), 'utf8'), { schema: cordisSchema })
  const ids = []
  collectRowIds(patch, ids)
  return [...new Set(ids)].sort()
}

function readProtocolSchemaHashes(repoRoot) {
  const hashes = {}
  for (const relPath of PROTOCOL_SCHEMA_PATHS) {
    const content = readFileSync(join(repoRoot, relPath))
    hashes[relPath] = createHash('sha256').update(content).digest('hex')
  }
  return hashes
}

function readPnpmLockHash(repoRoot) {
  const content = readFileSync(join(repoRoot, PNPM_LOCK_PATH))
  return createHash('sha256').update(content).digest('hex')
}

function captureFields(repoRoot) {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const node = execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '')
  const pnpm = execFileSync('pnpm', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  return {
    formatVersion: FORMAT_VERSION,
    gitSha,
    toolchain: { node, pnpm },
    workspacePackages: readWorkspacePackages(repoRoot),
    defaultBundleRowIds: readDefaultBundleRowIds(repoRoot),
    protocolSchemaHashes: readProtocolSchemaHashes(repoRoot),
    pnpmLockHash: readPnpmLockHash(repoRoot),
  }
}

function writeAuditDoc(repoRoot, fields) {
  const docPath = join(repoRoot, 'docs/audit', `baseline-fingerprint-${fields.gitSha}.md`)
  const schemaRows = Object.keys(fields.protocolSchemaHashes)
    .sort()
    .map((path) => `- \`${path}\`: \`${fields.protocolSchemaHashes[path]}\``)
    .join('\n')
  const content = `# Baseline fingerprint report — \`pnpm baseline:capture\`

## 1. Identity

- Git SHA: \`${fields.gitSha}\`
- Toolchain: Node \`${fields.toolchain.node}\`, pnpm \`${fields.toolchain.pnpm}\`

## 2. Fields

- \`formatVersion\`: ${fields.formatVersion}
- \`workspacePackages\` (${fields.workspacePackages.length}): ${fields.workspacePackages.join(', ')}
- \`defaultBundleRowIds\` (${fields.defaultBundleRowIds.length}): ${fields.defaultBundleRowIds.join(', ')}
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
  writeAuditDoc(repoRoot, fields)
  return 0
}

function diffCapture(stored, fresh) {
  const drift = []
  const addSimple = (path, field) => {
    if (stored[field] !== fresh[field]) drift.push({ path, field, expected: stored[field], actual: fresh[field] })
  }
  addSimple('formatVersion', 'formatVersion')
  addSimple('HEAD', 'gitSha')
  if (stored.toolchain.node !== fresh.toolchain.node) {
    drift.push({ path: 'toolchain.node', field: 'toolchain.node', expected: stored.toolchain.node, actual: fresh.toolchain.node })
  }
  if (stored.toolchain.pnpm !== fresh.toolchain.pnpm) {
    drift.push({ path: 'toolchain.pnpm', field: 'toolchain.pnpm', expected: stored.toolchain.pnpm, actual: fresh.toolchain.pnpm })
  }
  if (JSON.stringify(stored.workspacePackages) !== JSON.stringify(fresh.workspacePackages)) {
    drift.push({
      path: WORKSPACE_MANIFEST_PATH,
      field: 'workspacePackages',
      expected: stored.workspacePackages,
      actual: fresh.workspacePackages,
    })
  }
  if (JSON.stringify(stored.defaultBundleRowIds) !== JSON.stringify(fresh.defaultBundleRowIds)) {
    drift.push({
      path: BUNDLE_ROWS_PATH,
      field: 'defaultBundleRowIds',
      expected: stored.defaultBundleRowIds,
      actual: fresh.defaultBundleRowIds,
    })
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

function verify(repoRoot) {
  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) {
    process.stderr.write(`baseline-fingerprint verify: no captured baseline at ${baselinePath}; run \`pnpm baseline:capture\` first\n`)
    return 1
  }
  const stored = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const fresh = captureFields(repoRoot)
  const drift = diffCapture(stored, fresh)
  if (drift.length === 0) {
    process.stdout.write('baseline-fingerprint verify: no drift detected\n')
    return 0
  }
  const lines = ['baseline-fingerprint verify: drift detected against the captured baseline:']
  for (const entry of drift) {
    lines.push(`  ${entry.path} (${entry.field}): expected ${JSON.stringify(entry.expected)}, found ${JSON.stringify(entry.actual)}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
  writeFileSync(join(repoRoot, '.dsh/rebase-report.json'), `${JSON.stringify({ drift }, null, 2)}\n`)
  return 1
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  const repoRoot = repoRootArg(rest)
  if (subcommand === 'capture') process.exit(capture(repoRoot))
  if (subcommand === 'verify') process.exit(verify(repoRoot))
  throw new Error(`baseline-fingerprint: unknown subcommand ${JSON.stringify(subcommand)}`)
}

main()
