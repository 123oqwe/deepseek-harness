#!/usr/bin/env node
/**
 * Check, in an npm publish job and before it publishes anything, that the
 * tarballs it downloaded are exactly the ones its pack job recorded in the
 * release evidence package (BLOCKED-362).
 *
 * The pack job verifies the whole evidence package (`verify-evidence.mjs`) and
 * then uploads the tarballs; the publish job runs on a fresh runner and cannot
 * re-run that verification, because the baseline and working-tree diff it
 * re-derives exist only in the pack job's checkout. This script checks the one
 * thing that crosses the job boundary: the published bytes. It refuses unless
 * the evidence package is the one the pack job reported (its sha256 equals
 * `--evidence-sha256`, which the pack job passes as a job output rather than
 * through artifact storage), it records `accepted: true`, the files under
 * `--dir` are exactly the keys of its `requiredBuildArtifacts`, and each file's
 * sha256 equals the recorded digest.
 *
 * It imports only Node builtins: the node-addon publish job installs nothing,
 * and `verify-evidence.mjs` reaches `js-yaml` through `baseline-fingerprint.mjs`.
 * The digest is `collect-evidence.mjs`'s `digestOfFile`: the hex sha256 of the
 * file's bytes.
 *
 * CLI: `node scripts/release/verify-published-artifacts.mjs --evidence <path>
 * --evidence-sha256 <hex> --dir <repo-relative directory> [--repo-root <path>]`.
 * Exits 0 when everything matches, and 1 listing every mismatch otherwise.
 * @module scripts/release/verify-published-artifacts
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Every flag this script reads; each takes one value, and none may repeat. */
const KNOWN_FLAGS = new Set(['--repo-root', '--evidence', '--evidence-sha256', '--dir'])

/**
 * Parse `--flag value` pairs, refusing an unknown flag, a missing value, or a repeat.
 * @param {readonly string[]} argv - the arguments after the script path.
 * @returns {Map<string, string>} each flag's value.
 */
export function parseFlags(argv) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const token = argv[i]
    if (!KNOWN_FLAGS.has(token)) throw new Error(`verify-published-artifacts: unknown argument ${JSON.stringify(token)}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`verify-published-artifacts: ${token} requires a value`)
    if (flags.has(token)) throw new Error(`verify-published-artifacts: ${token} is given twice`)
    flags.set(token, value)
  }
  return flags
}

/**
 * The hex sha256 of a file's bytes.
 * @param {string} path - the file.
 * @returns {string} the digest.
 */
function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Every file below `dir`, as repository-relative paths with `/` separators.
 * @param {string} repoRoot - the repository root.
 * @param {string} dir - the absolute directory.
 * @returns {string[]} the paths, sorted.
 */
function filesBelow(repoRoot, dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(repoRoot, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

/**
 * Compare the downloaded tarballs with the evidence package the pack job recorded.
 * @param {{ repoRoot: string, evidencePath: string, evidenceSha256: string, dir: string }} input - absolute paths and the expected evidence digest.
 * @returns {string[]} every mismatch; empty when the publish may proceed.
 */
export function verifyPublishedArtifacts({ repoRoot, evidencePath, evidenceSha256, dir }) {
  let bytes
  try {
    bytes = readFileSync(evidencePath)
  } catch (error) {
    return [`no readable evidence package at ${evidencePath}: ${error instanceof Error ? error.message : String(error)}`]
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== evidenceSha256) {
    return [`the evidence package is not the one the pack job reported (sha256 ${actualSha256}, expected ${evidenceSha256})`]
  }
  let pkg
  try {
    pkg = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    return [`the evidence package is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]
  }
  const mismatches = []
  if (pkg.accepted !== true) mismatches.push(`the evidence package records accepted=${JSON.stringify(pkg.accepted)}, not true`)
  const recorded = pkg.requiredBuildArtifacts
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) {
    mismatches.push('the evidence package has no requiredBuildArtifacts object')
    return mismatches
  }
  const downloaded = filesBelow(repoRoot, dir)
  for (const path of downloaded) {
    if (!Object.hasOwn(recorded, path)) mismatches.push(`${path} was downloaded but the evidence package does not record it`)
  }
  for (const [path, digest] of Object.entries(recorded)) {
    if (!downloaded.includes(path)) {
      mismatches.push(`${path} is recorded in the evidence package but was not downloaded`)
      continue
    }
    const actual = sha256Of(join(repoRoot, path))
    if (actual !== digest) mismatches.push(`${path} does not match the evidence package (recorded ${String(digest)}, downloaded ${actual})`)
  }
  return mismatches
}

function main() {
  const flags = parseFlags(process.argv.slice(2))
  const repoRoot = resolve(flags.get('--repo-root') ?? process.cwd())
  const evidence = flags.get('--evidence')
  const evidenceSha256 = flags.get('--evidence-sha256')
  const dir = flags.get('--dir')
  if (evidence === undefined || evidenceSha256 === undefined || dir === undefined) {
    throw new Error('verify-published-artifacts: --evidence, --evidence-sha256 and --dir are required')
  }
  const evidencePath = resolve(repoRoot, evidence)
  const mismatches = verifyPublishedArtifacts({ repoRoot, evidencePath, evidenceSha256, dir: resolve(repoRoot, dir) })
  if (mismatches.length === 0) {
    process.stdout.write(`verify-published-artifacts: every file under ${dir} matches ${evidence}\n`)
    process.exit(0)
  }
  process.stdout.write(`verify-published-artifacts: refusing to publish ${dir}:\n${mismatches.map(line => `  ${line}`).join('\n')}\n`)
  process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
