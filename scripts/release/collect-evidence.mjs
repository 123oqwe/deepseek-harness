#!/usr/bin/env node
/**
 * `pnpm evidence:collect` (P0-07 P-stage implementation of the C-stage type
 * contract in `packages/assurance/evidence-format/src/types.ts` and
 * `tests/release/evidence-package.spec.ts`).
 *
 * Builds a real `EvidencePackage` (`@deepseek-ai/dsh-evidence-format`) on
 * disk, one gate at a time, converging a whole release's evidence into a
 * single JSON file at `--out` (default `.dsh/evidence/evidence.json`):
 *
 *   node scripts/release/collect-evidence.mjs init --base-sha <prior-release-sha> --required-gate typecheck --required-gate test --required-artifact lib/index.js
 *   node scripts/release/collect-evidence.mjs run --gate-id typecheck --required -- pnpm run typecheck
 *   node scripts/release/collect-evidence.mjs run --gate-id test --required -- pnpm test
 *   node scripts/release/collect-evidence.mjs build-artifact --path lib/index.js
 *
 * `init` binds the current checkout's baseline fingerprint
 * (`scripts/release/baseline-fingerprint.mjs`'s `verifyBaseline`, Epic
 * P0-01 — reused, not reimplemented; `init` refuses to proceed if the
 * checkout has drifted from its captured baseline) and a real
 * patch of the working tree (`workingTreePatch`) against the caller-supplied
 * `--base-sha` (required: `verifyBaseline` already proves the baseline's own captured
 * `gitSha` equals the current `HEAD`, so defaulting to it would always
 * yield an empty diff — the real comparison point, a previous release tag
 * or a branch merge-base, is a release-time decision this script cannot
 * guess), and seeds every `--required-gate` id with a placeholder
 * `MissingGateEvidence` — so a required gate that is declared but never
 * reached by a `run` invocation (a crashed collector, a misconfigured CI
 * step) stays recorded as genuinely missing, never silently absent from the
 * file. `run` executes one real gate command (`spawnSync`, no shell),
 * records its real exit code/timestamps/environment and a real sha256
 * digest of its captured log, and merges the result into `requiredGates`
 * (if its id was declared at `init`) or `additionalGates` (any other real
 * outcome is legal there — never gates `accepted`). `build-artifact` hashes
 * a real build output file into `requiredBuildArtifacts`. Every write
 * recomputes `accepted` from the real, current state (must[2]: `true` only
 * once every declared required gate is a `CompletedGateEvidence` with
 * `exitCode === 0` and every declared required artifact path is present —
 * never from what a caller merely claims) and `signature`, a sha256
 * content-integrity digest over the package's own canonical serialization
 * (every other field, sorted keys). This is deliberately NOT a keyed
 * cryptographic authentication signature (no secret/private key, no pinned
 * trust anchor): it detects accidental corruption of the evidence-package.json
 * itself and, combined with `verify-evidence.mjs`'s per-field digest
 * recomputation, detects tampering with any file the package REFERENCES
 * (a log, an artifact, a build output) after collection — acceptance[0]'s
 * scenario. It does not, and structurally cannot without a secret key,
 * stop an attacker who edits the evidence-package.json file itself and
 * recomputes a self-consistent `signature` to match; closing that gap with
 * a real keyed signature against a pinned trust anchor is future work this
 * P-stage slice intentionally leaves for a maintainer decision (see this
 * epic's Writer report) rather than adding unscoped key-management
 * infrastructure.
 *
 * Every digest this script records corresponds to a real file on disk:
 * repo-tracked files (`.dsh/baseline.json`, artifact/build-artifact paths)
 * are hashed at their real repo-relative path; collector-produced files
 * (each gate's captured log, the git diff text) live in a sidecar directory
 * next to `--out` — `<out-dir>/<out-basename>.d/logs/<gateId>.log` and
 * `.../gitdiff.patch` — so `verify-evidence.mjs` can recompute every digest
 * fully offline, without re-running any gate (acceptance[1]).
 * `<sidecar>/manifest.json` additionally records the `--required-artifact`
 * paths and `--required-gate` ids declared at `init` — private bookkeeping
 * this script and `verify-evidence.mjs` both read, kept out of the typed
 * `EvidencePackage` JSON itself. `init` writes it before signing and records
 * its digest as the package's `sidecarManifestDigest`, so an edit to it after
 * collection is a verify mismatch.
 *
 * CLI: `node scripts/release/collect-evidence.mjs <init|run|build-artifact> [--repo-root <path>] [--out <path>] ...`
 * `--repo-root` defaults to `process.cwd()`; `--out` defaults to
 * `.dsh/evidence/evidence.json` under `--repo-root`.
 */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { verifyBaseline } from './baseline-fingerprint.mjs'

const FORMAT_VERSION = 1

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key])
    return sorted
  }
  return value
}

/** Compact canonical JSON: sorted object keys, no whitespace — the digest input, decoupled from the pretty-printed on-disk format. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value))
}

/** sha256 of a value's canonical JSON serialization. */
export function digestOfValue(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/** sha256 of a file's real current bytes. */
export function digestOfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The collector-produced sidecar directory next to an evidence package's `--out` path. */
export function sidecarDir(outPath) {
  return join(dirname(outPath), `${basename(outPath, extname(outPath))}.d`)
}

/**
 * Settings of the checkout's own git configuration that let git read a changed
 * file as unchanged, overridden on every git call {@link workingTreePatch}
 * makes: an fsmonitor hook that reports no change, and a stat check that
 * ignores ctime or sub-second mtime. `core.untrackedCache=false` is defensive
 * hardening with no sensitivity proof: `ls-files --others` does not read the
 * untracked cache in git 2.50.1.
 */
const GIT_READS_THE_WORKING_TREE = ['-c', 'core.fsmonitor=false', '-c', 'core.checkStat=default', '-c', 'core.trustCtime=true', '-c', 'core.untrackedCache=false']

/**
 * The working tree against `baseSha` as one patch: `git diff --binary` for
 * tracked files, then each untracked file as a binary diff against /dev/null,
 * in path order. The untracked files are those the tree's `.gitignore` files do
 * not ignore, plus every untracked `.gitignore`, ignored or not, because a new
 * `.gitignore` can ignore itself and the files beside it. Rules outside the
 * tree, in `.git/info/exclude` or `core.excludesFile`, are not read, so a rule
 * added there after collection hides nothing. The evidence package's own output
 * file and sidecar directory are left out, because the package cannot describe
 * itself.
 * Both diffs run with `--no-ext-diff --no-textconv --no-color`, so the patch is
 * git's own whatever external diff program, textconv filter or color setting
 * the git configuration names, and every call overrides
 * {@link GIT_READS_THE_WORKING_TREE}. Each
 * collection step records this, and verification takes it again, so a change
 * made after the last step shows, a new untracked file included.
 * `baseSha` follows `--end-of-options`, so git reads an option-shaped value as
 * a revision and refuses it instead of acting on it.
 * @param {string} repoRoot - the checkout.
 * @param {string} baseSha - the commit the patch is measured against.
 * @param {string} outPath - the evidence package's absolute path.
 * @returns {string} the patch text.
 * @throws {Error} when the index marks a file skip-worktree or assume-unchanged, because `git diff` then reads the index instead of the working tree for that file; when the attributes assign a filter to a path the checkout holds, because git then compares what the filter prints instead of the file; and when git produces no patch for an untracked entry, such as a symbolic link to a directory or a nested repository.
 */
export function workingTreePatch(repoRoot, baseSha, outPath) {
  const run = (args, input) => execFileSync('git', [...GIT_READS_THE_WORKING_TREE, ...args], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30, ...input === undefined ? {} : { input } })
  // `ls-files -v` tags a skip-worktree entry `S` and an assume-unchanged one with a lowercase letter.
  const marked = run(['ls-files', '-v', '-z']).split('\0')
    .filter(entry => entry !== '' && (entry[0] === 'S' || entry[0] !== entry[0].toUpperCase()))
    .map(entry => entry.slice(2))
  if (marked.length > 0) {
    throw new Error(`the index marks ${marked.join(', ')} skip-worktree or assume-unchanged, so git diff reads the index for them instead of the working tree`)
  }
  const ownFile = relative(repoRoot, outPath).split(sep).join('/')
  const ownDir = `${relative(repoRoot, sidecarDir(outPath)).split(sep).join('/')}/`
  const others = (options, pathspec) => run(['ls-files', '--others', ...options, '-z', ...pathspec]).split('\0')
    .filter(path => path !== '' && path !== ownFile && !path.startsWith(ownDir))
  const untracked = [...new Set([
    ...others(['--exclude-per-directory=.gitignore'], []),
    ...others(['--ignored', '--exclude-per-directory=.gitignore'], ['--', ':(glob)**/.gitignore']),
  ])].sort()
  // The attributes decide, not the configuration: a filter defined for no path,
  // such as a global git-lfs install, changes no comparison.
  const tracked = run(['ls-files', '-z']).split('\0').filter(path => path !== '')
  const attributes = run(['check-attr', '--stdin', '-z', 'filter'], [...tracked, ...untracked].join('\0')).split('\0')
  const filtered = []
  for (let index = 0; index + 2 < attributes.length; index += 3) {
    const value = attributes[index + 2]
    if (value !== 'unspecified' && value !== 'unset' && value !== 'set') filtered.push(`${attributes[index]} (filter=${value})`)
  }
  if (filtered.length > 0) {
    throw new Error(`the checkout assigns a filter to ${filtered.join(', ')}, and git compares a filtered file by what its filter prints, not by its bytes`)
  }
  const added = untracked.map((path) => {
    const result = spawnSync('git', [...GIT_READS_THE_WORKING_TREE, 'diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', '--no-index', '--', '/dev/null', path], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 })
    // `git diff --no-index` exits 1 both when the sides differ, as they do for
    // any new file, and when it cannot read a side, so only output that starts
    // a patch is one.
    if (result.status !== 1 || !result.stdout.startsWith('diff --git ')) {
      throw new Error(`git diff --no-index -- /dev/null ${path} produced no patch (exit ${result.status}): ${result.stderr}`)
    }
    return result.stdout
  })
  return run(['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color', '--end-of-options', baseSha]) + added.join('')
}

/**
 * Record the working tree after a collection step: rewrite the patch sidecar
 * and bind its digest into the package, which the caller signs next.
 * @param {string} repoRoot - the checkout.
 * @param {string} outPath - the evidence package's absolute path.
 * @param {{ gitDiff: { baseSha: string, headSha: string, digest: string } }} pkg - the package being written.
 */
function recordWorkingTree(repoRoot, outPath, pkg) {
  const diffPath = join(sidecarDir(outPath), 'gitdiff.patch')
  writeFileSync(diffPath, workingTreePatch(repoRoot, pkg.gitDiff.baseSha, outPath))
  pkg.gitDiff = { ...pkg.gitDiff, digest: digestOfFile(diffPath) }
}

function repoRootArg(flags) {
  return flagOne(flags, '--repo-root', process.cwd())
}

function outPathArg(flags, repoRoot) {
  return resolve(repoRoot, flagOne(flags, '--out', '.dsh/evidence/evidence.json'))
}

const BOOLEAN_FLAGS = new Set(['--required', '--force'])

/**
 * Every flag this script reads, across all three subcommands.
 *
 * An unknown flag is refused rather than ignored, because `parseFlags` gives a
 * value-taking flag the NEXT argument: a misspelt `--requird-gate typecheck`
 * did not merely fail to register a required gate, it also swallowed
 * `typecheck`, and the evidence package recorded one fewer required gate than
 * the caller asked for. A silently weaker release gate is the one outcome this
 * script exists to prevent.
 *
 * One set for all subcommands rather than one per subcommand: this refuses
 * what no subcommand understands, which is the typo case. A flag aimed at the
 * wrong subcommand is a narrower mistake and is left for the subcommand's own
 * reading of what it needs.
 */
const KNOWN_FLAGS = new Set([
  '--repo-root', '--out', '--force',
  '--base-sha', '--required-gate', '--required-artifact',
  '--gate-id', '--required', '--artifact', '--skip', '--missing', '--test-counts',
  '--path',
])

/** Splits `argv` at the first literal `--`: everything after it is the gate command to run, never a flag. */
function splitArgs(argv) {
  const sepIndex = argv.indexOf('--')
  if (sepIndex === -1) return { flagArgs: argv, command: [] }
  return { flagArgs: argv.slice(0, sepIndex), command: argv.slice(sepIndex + 1) }
}

/** Parses `--flag value` pairs (repeatable, collected in order) and known boolean flags from a flag-only argv slice. */
function parseFlags(flagArgs) {
  const flags = new Map()
  for (let i = 0; i < flagArgs.length; i++) {
    const token = flagArgs[i]
    if (!token.startsWith('--')) throw new Error(`collect-evidence: unexpected argument ${JSON.stringify(token)}`)
    if (!KNOWN_FLAGS.has(token)) throw new Error(`collect-evidence: unknown flag ${JSON.stringify(token)}`)
    if (BOOLEAN_FLAGS.has(token)) {
      flags.set(token, [...(flags.get(token) ?? []), 'true'])
      continue
    }
    const value = flagArgs[i + 1]
    if (value === undefined) throw new Error(`collect-evidence: ${token} requires a value`)
    flags.set(token, [...(flags.get(token) ?? []), value])
    i++
  }
  return flags
}

function flagOne(flags, name, fallback) {
  const values = flags.get(name)
  if (values === undefined || values.length === 0) return fallback
  return values[values.length - 1]
}

function flagAll(flags, name) {
  return flags.get(name) ?? []
}

function currentEnvironment() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version.replace(/^v/, ''),
    ci: Boolean(process.env.CI),
  }
}

/** Builds one `GateEvidence` record, attaching its own `recordDigest` last. */
function buildEvidence(gateId, command, startedAt, endedAt, outcome, exitCode, logDigest, artifacts, testCounts, skipReasons) {
  const base = { gateId, command, startedAt, endedAt, environment: currentEnvironment(), outcome, exitCode, logDigest, artifacts, testCounts, skipReasons }
  return { ...base, recordDigest: digestOfValue(base) }
}

/** A required gate declared at `init` but not yet reached by any `run` invocation. */
function missingPlaceholder(gateId) {
  return buildEvidence(gateId, '', new Date(0).toISOString(), new Date(0).toISOString(), 'missing', null, null, [], null, ['not yet attempted'])
}

/** must[2], for real runtime data: `true` only once every required gate is a passing `CompletedGateEvidence` and every declared required artifact path is present. */
function computeAccepted(requiredGates, requiredBuildArtifacts, requiredArtifactPaths) {
  const gatesOk = Object.values(requiredGates).every(gate => gate.outcome === 'completed' && gate.exitCode === 0)
  const artifactsOk = requiredArtifactPaths.every(path => Object.prototype.hasOwnProperty.call(requiredBuildArtifacts, path))
  return gatesOk && artifactsOk
}

function digestOfPackage(pkg) {
  const { signature: _signature, ...rest } = pkg
  return digestOfValue(rest)
}

function writePackage(outPath, pkg) {
  writeFileSync(outPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

function readPackage(outPath) {
  return JSON.parse(readFileSync(outPath, 'utf8'))
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
}

function cmdInit(flags) {
  const repoRoot = repoRootArg(flags)
  const outPath = outPathArg(flags, repoRoot)
  if (existsSync(outPath) && !flags.has('--force')) {
    process.stderr.write(`collect-evidence init: ${outPath} already exists; pass --force to overwrite\n`)
    return 1
  }

  const baselinePath = join(repoRoot, '.dsh/baseline.json')
  const baselineCheck = verifyBaseline(repoRoot)
  if (!baselineCheck.ok) {
    const lines = baselineCheck.drift.map(entry => `  ${entry.path} (${entry.field})`)
    process.stderr.write(`collect-evidence init: checkout has drifted from its captured baseline; run \`pnpm baseline:capture\` first:\n${lines.join('\n')}\n`)
    return 1
  }
  const storedBaseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const baselineDigest = digestOfFile(baselinePath)

  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  // `verifyBaseline` above already proved `storedBaseline.gitSha === headSha`
  // (any other HEAD is itself reported as drift), so defaulting `baseSha` to
  // the baseline's own gitSha would always yield an empty diff. The
  // release's real comparison point (a previous release tag, main's
  // merge-base) is a caller decision this script cannot guess.
  const baseSha = flagOne(flags, '--base-sha')
  if (baseSha === undefined) throw new Error('collect-evidence init: --base-sha is required (the commit this evidence package\'s Git diff is measured against)')
  const dir = sidecarDir(outPath)
  mkdirSync(join(dir, 'logs'), { recursive: true })
  const diffPath = join(dir, 'gitdiff.patch')
  writeFileSync(diffPath, workingTreePatch(repoRoot, baseSha, outPath))
  const gitDiffDigest = digestOfFile(diffPath)

  const requiredGateIds = flagAll(flags, '--required-gate')
  const requiredArtifactPaths = flagAll(flags, '--required-artifact')
  const requiredGates = Object.fromEntries(requiredGateIds.map(gateId => [gateId, missingPlaceholder(gateId)]))
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify({ requiredArtifactPaths, requiredGateIds }, null, 2)}\n`)

  const pkg = {
    formatVersion: FORMAT_VERSION,
    baselineFingerprint: { gitSha: storedBaseline.gitSha, digest: baselineDigest },
    gitDiff: { baseSha, headSha, digest: gitDiffDigest },
    sidecarManifestDigest: digestOfFile(manifestPath),
    additionalGates: [],
    requiredGates,
    requiredBuildArtifacts: {},
    accepted: computeAccepted(requiredGates, {}, requiredArtifactPaths),
    signature: '',
  }
  pkg.signature = digestOfPackage(pkg)
  mkdirSync(dirname(outPath), { recursive: true })
  writePackage(outPath, pkg)
  process.stdout.write(`collect-evidence init: wrote ${outPath}\n`)
  return 0
}

function cmdRun(flags, command) {
  const repoRoot = repoRootArg(flags)
  const outPath = outPathArg(flags, repoRoot)
  if (!existsSync(outPath)) {
    process.stderr.write(`collect-evidence run: no evidence package at ${outPath}; run \`collect-evidence.mjs init\` first\n`)
    return 1
  }
  const gateId = flagOne(flags, '--gate-id')
  if (gateId === undefined) throw new Error('collect-evidence run: --gate-id is required')
  const artifactPaths = flagAll(flags, '--artifact')
  const skipReasons = flagAll(flags, '--skip')
  const missingReasons = flagAll(flags, '--missing')
  const testCountsPath = flagOne(flags, '--test-counts')
  const commandText = command.join(' ')

  const pkg = readPackage(outPath)
  const dir = sidecarDir(outPath)
  const manifest = readManifest(dir)

  const startedAt = new Date().toISOString()
  let evidence
  let exitCode = 0

  if (skipReasons.length > 0) {
    evidence = buildEvidence(gateId, commandText, startedAt, startedAt, 'skipped', null, null, [], null, skipReasons)
  } else if (missingReasons.length > 0) {
    evidence = buildEvidence(gateId, commandText, startedAt, startedAt, 'missing', null, null, [], null, missingReasons)
  } else {
    if (command.length === 0) throw new Error('collect-evidence run: a gate command is required after `--` (or pass --skip/--missing)')
    const result = spawnSync(command[0], command.slice(1), { cwd: repoRoot, encoding: 'utf8' })
    const endedAt = new Date().toISOString()
    if (result.error !== undefined || result.status === null) {
      const reason = result.error !== undefined ? result.error.message : `terminated by signal ${result.signal}`
      evidence = buildEvidence(gateId, commandText, startedAt, endedAt, 'missing', null, null, [], null, [reason])
      exitCode = 1
    } else {
      mkdirSync(join(dir, 'logs'), { recursive: true })
      const logPath = join(dir, 'logs', `${gateId}.log`)
      writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`)
      const logDigest = digestOfFile(logPath)
      const artifacts = artifactPaths.map(path => ({ path, digest: digestOfFile(join(repoRoot, path)) }))
      const testCounts = testCountsPath === undefined ? null : JSON.parse(readFileSync(resolve(repoRoot, testCountsPath), 'utf8'))
      evidence = buildEvidence(gateId, commandText, startedAt, endedAt, 'completed', result.status, logDigest, artifacts, testCounts, [])
      exitCode = result.status
    }
  }

  if (Object.prototype.hasOwnProperty.call(pkg.requiredGates, gateId)) {
    pkg.requiredGates[gateId] = evidence
  } else {
    const idx = pkg.additionalGates.findIndex(existing => existing.gateId === gateId)
    if (idx === -1) pkg.additionalGates.push(evidence)
    else pkg.additionalGates[idx] = evidence
  }
  pkg.accepted = computeAccepted(pkg.requiredGates, pkg.requiredBuildArtifacts, manifest.requiredArtifactPaths)
  recordWorkingTree(repoRoot, outPath, pkg)
  pkg.signature = digestOfPackage(pkg)
  writePackage(outPath, pkg)
  return exitCode
}

function cmdBuildArtifact(flags) {
  const repoRoot = repoRootArg(flags)
  const outPath = outPathArg(flags, repoRoot)
  const artifactPath = flagOne(flags, '--path')
  if (artifactPath === undefined) throw new Error('collect-evidence build-artifact: --path is required')

  const pkg = readPackage(outPath)
  const dir = sidecarDir(outPath)
  const manifest = readManifest(dir)

  pkg.requiredBuildArtifacts[artifactPath] = digestOfFile(join(repoRoot, artifactPath))
  pkg.accepted = computeAccepted(pkg.requiredGates, pkg.requiredBuildArtifacts, manifest.requiredArtifactPaths)
  recordWorkingTree(repoRoot, outPath, pkg)
  pkg.signature = digestOfPackage(pkg)
  writePackage(outPath, pkg)
  process.stdout.write(`collect-evidence build-artifact: recorded ${artifactPath}\n`)
  return 0
}

function main() {
  const [subcommand, ...rest] = process.argv.slice(2)
  const { flagArgs, command } = splitArgs(rest)
  const flags = parseFlags(flagArgs)
  if (subcommand === 'init') process.exit(cmdInit(flags))
  if (subcommand === 'run') process.exit(cmdRun(flags, command))
  if (subcommand === 'build-artifact') process.exit(cmdBuildArtifact(flags))
  throw new Error(`collect-evidence: unknown subcommand ${JSON.stringify(subcommand)}`)
}

if (import.meta.main) main()
