/**
 * Baseline fingerprint capture and verification for reproducible audit.
 *
 * Records a deterministic fingerprint of architecture- and protocol-critical
 * repository surfaces so that every downstream issue can bind its changes to a
 * known source state. The fingerprint excludes build artifacts, timestamps,
 * and other non-deterministic data.
 *
 * Usage:
 *   node scripts/release/baseline-fingerprint.mjs capture   # write .dsh/baseline.json
 *   node scripts/release/baseline-fingerprint.mjs verify    # compare current state to .dsh/baseline.json
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { parseArgs } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

// ---------------------------------------------------------------------------
// Files whose content is part of the fingerprint.
// ---------------------------------------------------------------------------

const SCHEMA_FILES = [
  'packages/sdk/protocol/src/types.ts',
  'packages/core/session/src/types.ts',
  'packages/core/session/src/known-event-types.ts',
  'packages/bundle/base/cordis.patch.yml',
  'packages/core/agent/src/types.ts',
  'packages/core/agent-loop/src/runtime-context.ts',
]

const MANIFEST_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(filePath) {
  const abs = join(repoRoot, filePath)
  if (!existsSync(abs)) {
    throw new Error(`baseline-fingerprint: missing file ${filePath}`)
  }
  const content = readFileSync(abs)
  return createHash('sha256').update(content).digest('hex')
}

function gitHead() {
  return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function gitUpstreamMasterSha() {
  try {
    return execSync('git rev-parse origin/master', { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function nodeVersion() {
  return process.version
}

function pnpmVersion() {
  return execSync('pnpm --version', { encoding: 'utf8' }).trim()
}

function bundleRowIds() {
  const yamlPath = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
  const content = readFileSync(yamlPath, 'utf8')
  const ids = []
  for (const line of content.split('\n')) {
    const m = line.match(/^\s+-\s+id:\s+(\S+)/)
    if (m) ids.push(m[1])
  }
  return ids
}

function globDirs(pattern) {
  const base = join(repoRoot, pattern.replace(/\*$/, ''))
  if (!existsSync(base)) return []
  return readdirSync(base)
    .filter(e => statSync(join(base, e)).isDirectory())
    .map(e => join(base, e))
}

function workspacePackages() {
  const pkgs = []
  const dirs = [
    ...globDirs('packages/*'),
    ...globDirs('vendor/*'),
  ]
  for (const dir of dirs) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      const json = JSON.parse(readFileSync(pj, 'utf8'))
      pkgs.push({ name: json.name, version: json.version })
    }
    if (statSync(dir).isDirectory()) {
      for (const sub of readdirSync(dir)) {
        const subPj = join(dir, sub, 'package.json')
        if (existsSync(subPj)) {
          const json = JSON.parse(readFileSync(subPj, 'utf8'))
          pkgs.push({ name: json.name, version: json.version })
        }
      }
    }
  }
  pkgs.sort((a, b) => a.name.localeCompare(b.name))
  return pkgs
}

function buildFingerprint() {
  const schemaHashes = {}
  for (const f of SCHEMA_FILES) {
    schemaHashes[f] = sha256(f)
  }

  const manifestHashes = {}
  for (const f of MANIFEST_FILES) {
    manifestHashes[f] = sha256(f)
  }

  return {
    git_sha: gitHead(),
    upstream_master_sha: gitUpstreamMasterSha(),
    node_version: nodeVersion(),
    pnpm_version: pnpmVersion(),
    platform: process.platform,
    schema_hashes: schemaHashes,
    manifest_hashes: manifestHashes,
    bundle_row_ids: bundleRowIds(),
    workspace_packages: workspacePackages(),
  }
}

function serialize(fp) {
  return JSON.stringify(fp, Object.keys(fp).sort(), 2)
}

function capture() {
  const fp = buildFingerprint()
  const outPath = join(repoRoot, '.dsh/baseline.json')
  writeFileSync(outPath, JSON.stringify(fp, null, 2) + '\n')
  console.log(`baseline: captured fingerprint to ${relative(repoRoot, outPath)}`)
  console.log(`  git_sha: ${fp.git_sha}`)
  console.log(`  upstream_master_sha: ${fp.upstream_master_sha}`)
  console.log(`  schema_files: ${Object.keys(fp.schema_hashes).length}`)
  console.log(`  manifest_files: ${Object.keys(fp.manifest_hashes).length}`)
  console.log(`  bundle_row_ids: ${fp.bundle_row_ids.length}`)
  console.log(`  workspace_packages: ${fp.workspace_packages.length}`)
  return fp
}

function verify() {
  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  if (!existsSync(baselinePath)) {
    console.error('baseline: NO baseline.json found; run `pnpm baseline:capture` first.')
    process.exit(1)
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const current = buildFingerprint()

  const diffs = []

  // Warn if HEAD changed since capture (expected after committing the baseline itself).
  if (baseline.git_sha !== current.git_sha) {
    console.warn(`baseline: note - HEAD moved from ${baseline.git_sha.slice(0, 12)} to ${current.git_sha.slice(0, 12)} since capture`)
  }

  // Compare schema hashes
  for (const [file, hash] of Object.entries(current.schema_hashes)) {
    const prev = baseline.schema_hashes[file]
    if (prev === undefined) {
      diffs.push({ file, type: 'new_schema_file', message: `${file} not in baseline` })
    } else if (prev !== hash) {
      diffs.push({ file, type: 'schema_hash_mismatch', message: `${file} hash changed: ${prev.slice(0, 8)} -> ${hash.slice(0, 8)}` })
    }
  }
  for (const file of Object.keys(baseline.schema_hashes)) {
    if (current.schema_hashes[file] === undefined) {
      diffs.push({ file, type: 'removed_schema_file', message: `${file} removed from fingerprint` })
    }
  }

  // Compare manifest hashes
  for (const [file, hash] of Object.entries(current.manifest_hashes)) {
    const prev = baseline.manifest_hashes[file]
    if (prev === undefined) {
      diffs.push({ file, type: 'new_manifest_file', message: `${file} not in baseline` })
    } else if (prev !== hash) {
      diffs.push({ file, type: 'manifest_hash_mismatch', message: `${file} hash changed: ${prev.slice(0, 8)} -> ${hash.slice(0, 8)}` })
    }
  }

  // Compare bundle row IDs
  const prevIds = JSON.stringify(baseline.bundle_row_ids)
  const curIds = JSON.stringify(current.bundle_row_ids)
  if (prevIds !== curIds) {
    diffs.push({ type: 'bundle_row_ids_changed', message: 'bundle row IDs changed' })
  }

  // Compare workspace packages (names only, versions may change)
  const prevNames = baseline.workspace_packages.map(p => p.name).sort().join(',')
  const curNames = current.workspace_packages.map(p => p.name).sort().join(',')
  if (prevNames !== curNames) {
    diffs.push({ type: 'workspace_packages_changed', message: 'workspace package set changed' })
  }

  if (diffs.length === 0) {
    console.log('baseline: PASS - current state matches captured fingerprint')
    return true
  } else {
    console.error('baseline: FAIL - detected drift:')
    for (const d of diffs) {
      console.error(`  [${d.type}] ${d.message}`)
    }
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {},
  allowPositionals: true,
})

const command = values._?.[0] ?? process.argv[2]

if (command === 'capture') {
  capture()
} else if (command === 'verify') {
  verify()
} else {
  console.error('Usage: baseline-fingerprint.mjs <capture|verify>')
  process.exit(1)
}

export { buildFingerprint, capture, verify, SCHEMA_FILES, MANIFEST_FILES }
