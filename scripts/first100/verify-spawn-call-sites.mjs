/**
 * Every production call site of `ctx.subprocess` is classified -- P3-10 R5.
 *
 * P3-10.P holds a world's ceilings by passing them, as data, from the one
 * upstream point that knows the agent down to the spawn. That is wired call
 * site by call site, so a new call site that nobody wired runs unbounded while
 * every existing case stays green. This gate turns that omission into a red:
 * `spec/first100/exec/spawn-call-sites.json` classifies each file that reaches
 * the seam, with how many calls it makes, and a file the table does not list
 * fails.
 *
 * **Five classes, each a statement a reader can check.**
 * - `limited` -- the call carries the bound world's ceilings.
 * - `deferred` -- it will, in the work-order phase named by `until`.
 * - `exempt` -- it belongs to no world, for the stated `reason`.
 * - `opt-in-mount` -- a provider a deployment mounts itself, outside both the
 *   dsh file sandbox and the ceilings once mounted, for the stated `reason`.
 * - `spawns-nothing` -- it reads the service but starts no process through
 *   it, for the stated `reason`.
 *
 * **What counts as a call site.** A non-comment line of a production source
 * file (`packages/<group>/<pkg>/src/` or `apps/<app>/src/`) that calls
 * `subprocess.spawn(` or `subprocess.spawnTerminal(`, or that reads the
 * service by name with `get('subprocess')`. The seam's own packages
 * (`packages/subprocess/`) are its providers, not its callers, and the
 * generated API catalog only quotes signatures. A caller that stores the
 * service under another name and calls `.spawn(` on that name is not seen;
 * the table's `note` says so, and a reviewer adding such a caller adds its row.
 *
 * Usage: `node scripts/first100/verify-spawn-call-sites.mjs`
 *
 * @module scripts/first100/verify-spawn-call-sites
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TABLE_PATH = join(REPO_ROOT, 'spec/first100/exec/spawn-call-sites.json')

/** The classes a table row may carry, and the field each one must explain itself with. */
const CLASS_EXPLANATION = new Map([
  ['limited', 'reason'],
  ['deferred', 'until'],
  ['exempt', 'reason'],
  ['opt-in-mount', 'reason'],
  ['spawns-nothing', 'reason'],
])

/** A production source file, as this gate scopes one. */
const PRODUCTION_SOURCE = /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+)\/src\/.+\.(?:ts|tsx|mts|mjs)$/u

/** One reach into the seam on one line. */
const CALL_SITE = /\bsubprocess\.(?:spawn|spawnTerminal)\(|\bget\((['"])subprocess\1\)/gu

/**
 * Whether `path` is a file this gate scans.
 * @param path - a repository-relative path.
 * @returns true for production source outside the seam's own packages and the generated API catalog.
 */
export function isScannedSource(path) {
  return PRODUCTION_SOURCE.test(path)
    && !path.startsWith('packages/subprocess/')
    && !path.endsWith('/api-catalog.ts')
}

/**
 * Count the call sites in one file's text.
 * @param text - the file's contents.
 * @returns the number of reaches into the seam on non-comment lines.
 */
export function countCallSites(text) {
  let count = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
    count += [...line.matchAll(CALL_SITE)].length
  }
  return count
}

/**
 * Compare the tree's call sites with the table.
 * @param counts - call sites per scanned file, files with none omitted.
 * @param table - the parsed `spawn-call-sites.json`.
 * @returns one line per finding; empty when every call site is classified and every row is current.
 */
export function spawnCallSiteFindings(counts, table) {
  const findings = []
  const rows = new Map()
  for (const row of table.callSites) {
    const explanation = CLASS_EXPLANATION.get(row.class)
    if (explanation === undefined) {
      findings.push(`MALFORMED ${row.path}: class ${JSON.stringify(row.class)} is not one of ${[...CLASS_EXPLANATION.keys()].join(', ')}`)
    } else if (typeof row[explanation] !== 'string' || row[explanation].trim() === '') {
      findings.push(`MALFORMED ${row.path}: a ${row.class} row states its ${explanation}`)
    }
    if (rows.has(row.path)) findings.push(`MALFORMED ${row.path}: listed twice`)
    rows.set(row.path, row)
  }
  for (const [path, count] of counts) {
    const row = rows.get(path)
    if (row === undefined) findings.push(`UNCLASSIFIED ${path}: ${String(count)} call site(s) the table does not list`)
    else if (row.calls !== count) findings.push(`COUNT ${path}: the table says ${String(row.calls)}, the tree has ${String(count)}`)
  }
  for (const path of rows.keys()) {
    if (!counts.has(path)) findings.push(`STALE ${path}: listed, but the tree has no call site there`)
  }
  return findings
}

/**
 * Read the tree's call sites and the table.
 * @returns `{ counts, table }` for {@link spawnCallSiteFindings}.
 */
export function loadSpawnCallSiteInputs() {
  const listed = spawnSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listed.status !== 0) throw new Error(`verify-spawn-call-sites: git ls-files failed: ${listed.stderr}`)
  const counts = new Map()
  for (const path of listed.stdout.split('\n')) {
    if (!isScannedSource(path)) continue
    const count = countCallSites(readFileSync(join(REPO_ROOT, path), 'utf8'))
    if (count > 0) counts.set(path, count)
  }
  return { counts, table: JSON.parse(readFileSync(TABLE_PATH, 'utf8')) }
}

function main() {
  const { counts, table } = loadSpawnCallSiteInputs()
  const findings = spawnCallSiteFindings(counts, table)
  if (findings.length === 0) {
    const calls = [...counts.values()].reduce((sum, count) => sum + count, 0)
    console.log(`verify-spawn-call-sites: ${String(calls)} call site(s) in ${String(counts.size)} file(s), every one classified.`)
    return
  }
  for (const finding of findings) console.error(`  ${finding}`)
  console.error(
    `verify-spawn-call-sites: ${String(findings.length)} finding(s). Each file that reaches ctx.subprocess is listed in `
    + 'spec/first100/exec/spawn-call-sites.json with its call count and class, so a call site nobody wired for ceilings is a red rather than an unbounded spawn.',
  )
  process.exit(1)
}

// Run only as the entry point, so the spec can import the pure functions
// (the same guard as verify-adapt-dispositions.mjs, for the same reason).
const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) main()
