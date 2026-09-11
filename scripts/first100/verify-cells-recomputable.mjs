#!/usr/bin/env node
/**
 * BLOCKED-106 mechanical gate: every GREEN ledger cell must be RECOMPUTABLE
 * from the observation artifact it names.
 *
 * 24 of 97 GREEN cells were written by hand rather than by
 * `generate-ledger.mjs --green`. Their evidence was real -- genuine candidate
 * SHAs, real CI runs, artifact hashes matching GitHub -- and a later rerun of
 * the tool reproduced all 24. What the hand-write skipped was the checking.
 * `expectCasesMatched` was copied out of `command-freeze.json` rather than
 * computed from the observation, so a field meaning *these cases were seen
 * passing* was filled with *these cases were frozen*. The values happened to
 * be right; nothing had established that when they were written.
 *
 * Nothing detected this for days, because every field that could have exposed
 * it is self-described. `generatedBy` is a string the writer chooses.
 * `capturedAtUtc` is a timestamp the writer types. The one structural trace --
 * `absorbedFlakes: []`, which the tool's spread guard can never emit -- exists
 * only because someone once saved a few bytes, and a detection that survives
 * by accident is not a detection.
 *
 * So this gate checks RECOMPUTATION, never appearance. It does not ask who
 * wrote a cell or whether its fields look tool-shaped; it re-derives them from
 * the artifact and compares. A cell whose contents match its observation is
 * sound whoever typed it, and a cell that does not match fails however
 * plausible it looks -- the only way to pass is for the observation itself to
 * say so.
 *
 * **An expired artifact is not lost evidence.** Two properties were easy to
 * conflate here, and separating them is what keeps the retention window from
 * looking like a cliff: `observationSha256` is a tamper seal over one specific
 * uploaded file and dies with GitHub's retention, while the substantive claim
 * -- *these cases passed at this commit* -- stays reproducible for as long as
 * the tree and the workflow are in git, since `first100-exact-sha.yml` accepts
 * any historical SHA. A re-dispatched run necessarily produces a DIFFERENT
 * digest (durations vary), so it cannot satisfy the seal; that is the two
 * properties differing, not a failure.
 *
 * **An unreachable artifact is its own outcome, never a pass.** Scratchpad
 * paths are cleared and GitHub artifacts expire, so a cell can become
 * unverifiable through nothing but time. Reporting that as success would
 * rebuild the exact defect this gate exists for: a check with nothing to do,
 * reporting the same green as a check that ran. UNAVAILABLE is counted and
 * listed separately, and `--require-all` turns it into a failure for callers
 * that need every cell proved now.
 *
 * States a cell can be in:
 *
 * | state | meaning |
 * |---|---|
 * | VERIFIED | recomputed from the cell's own artifact, digest intact |
 * | MISMATCHED | the artifact does not support what the cell records |
 * | UNAVAILABLE | the artifact is unreachable, so nothing is proved either way |
 *
 * A cell whose artifact has expired is UNAVAILABLE, and the route back is to
 * re-dispatch the workflow at the cell's `candidateSha` and recompute the
 * substantive claim from the fresh run -- deriving it from the source again
 * rather than trusting anyone's saved summary. A stored extract would be one
 * more "I read the original and it said X", which is the shape of the very
 * defect this gate exists for.
 *
 * CLI:
 *   node scripts/first100/verify-cells-recomputable.mjs
 *     [--report <path>]     write full JSON findings to this path
 *     [--require-all]       exit non-zero when any cell is UNAVAILABLE
 */
import { frozenTitlePresent, registeredRenames } from './frozen-title-renames.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const LEDGER_PATH = resolve(REPO_ROOT, 'spec/first100/exec/ledger.json')

/**
 * Where a run's rescued artifacts live, when a deployment keeps them.
 *
 * Unset is the normal state and not an error: the gate then searches only the
 * path each cell recorded, which is what it did before.
 */
const ARTIFACT_DIR_ENV = 'FIRST100_ARTIFACT_DIR'
const FREEZE_PATH = resolve(REPO_ROOT, 'spec/first100/exec/command-freeze.json')

function opt(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Choose the artifact whose bytes hash to the recorded digest.
 *
 * A `first100-exact-sha.yml` run uploads TWO files named `vitest-report.json`
 * -- under `first100-vitest-report-<sha>/` and `first100-evidence-<sha>/` --
 * and only the second is what a cell's `observationSha256` was taken over.
 * Choosing by directory name, or taking whichever is found first, yields a
 * digest that does not match and so a MISMATCHED verdict for a cell that is
 * perfectly sound. A false MISMATCHED is less dangerous than a false VERIFIED,
 * but it sends someone to repair a row that was never broken.
 *
 * Selecting by digest cannot make that mistake, and needs no knowledge of the
 * naming convention at all.
 * @param candidates - paths to consider, with their contents' digests.
 * @param expectedSha256 - the digest the cell recorded.
 * @returns the matching path, or null when none matches.
 */
export function selectArtifactByDigest(candidates, expectedSha256) {
  const match = candidates.find(candidate => candidate.sha256 === expectedSha256)
  return match?.path ?? null
}

/**
 * Where a run's uploaded artifacts may be found besides the path the cell
 * recorded.
 *
 * The recorded path is an absolute one from whichever session greened the
 * cell, and those sessions end: 60 GREEN cells today point into scratchpad
 * directories of sessions that no longer exist, so the gate reports them
 * `unavailable` and audits nothing. A rescued copy of the same run's artifacts
 * under `$FIRST100_ARTIFACT_DIR/<run id>/` is the same bytes in a directory
 * that outlives the session.
 *
 * Candidates are ENUMERATED rather than constructed: both upload directories
 * are read from disk instead of composing `first100-vitest-report-<sha>` from
 * the cell's own `candidateSha`. Composing would silently miss a rescued
 * artifact whose directory name disagrees with the cell, and it is exactly
 * that disagreement a reader would want the gate to notice rather than skip.
 *
 * Selection still happens by digest in {@link selectArtifactByDigest}, so
 * widening where the gate LOOKS never widens what it will ACCEPT.
 * @param ciRunUrl - the cell's recorded workflow-run URL, whose last segment is the run id.
 * @param artifactDir - `$FIRST100_ARTIFACT_DIR`, or undefined when unset.
 * @returns absolute paths to every `vitest-report.json` that run uploaded.
 */
export function rescuedArtifactPaths(ciRunUrl, artifactDir) {
  if (artifactDir === undefined || artifactDir === '' || typeof ciRunUrl !== 'string') return []
  const runId = ciRunUrl.split('/').filter(part => part !== '').at(-1)
  if (runId === undefined || !/^\d+$/u.test(runId)) return []
  const runDir = join(artifactDir, runId)
  if (!existsSync(runDir)) return []
  const paths = []
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(runDir, entry.name, 'vitest-report.json')
    if (existsSync(candidate)) paths.push(candidate)
  }
  return paths.sort()
}

/**
 * Every case name a report shows PASSING, in the same terms
 * `generate-ledger.mjs` matches on.
 *
 * Both `title` and `fullName` are collected because a freeze may legitimately
 * name either, and this gate must agree with the matcher it audits rather than
 * invent a second definition of a match.
 * @param report - a parsed vitest `--reporter=json` document.
 * @returns the passing names.
 */
function passingNames(report) {
  const names = new Set()
  for (const file of report.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (a.status !== 'passed') continue
      if (typeof a.title === 'string') names.add(a.title)
      if (typeof a.fullName === 'string') names.add(a.fullName)
    }
  }
  return names
}

/**
 * Re-derive one cell's `expectCasesMatched` from its observation.
 *
 * This is the field the hand-written cells got wrong, and re-deriving it is
 * the whole point: the value must come from what the artifact shows passing,
 * never from the freeze that asked for it.
 * @param expectCases - the frozen case strings for this cell.
 * @param passing - names the observation shows passing.
 * @returns the frozen strings the observation confirms, and any it does not.
 */
export function recomputeMatchedCases(expectCases, passing, epic, stage) {
  // Resolves a registered rename, like every other tool that reads a frozen
  // title: a case renamed by later work is not an unmatched one, and reporting
  // it as MISMATCHED accuses the ledger of a defect the register already
  // explains (see ./frozen-title-renames.mjs).
  const renames = registeredRenames()
  const matched = expectCases.filter(title => frozenTitlePresent(title, passing, renames, epic, stage))
  const unmatched = expectCases.filter(title => !frozenTitlePresent(title, passing, renames, epic, stage))
  return { matched, unmatched }
}

/**
 * Compare a recorded cell against what its observation supports.
 * @param cell - the ledger cell.
 * @param frozen - the live freeze entry for the cell's epic and stage.
 * @param report - the parsed observation.
 * @returns the findings for this cell; empty when it recomputes exactly.
 */
export function checkCellAgainstObservation(cell, frozen, report) {
  const findings = []
  const passing = passingNames(report)
  const recorded = cell.expectCasesMatched ?? []

  // The load-bearing check, and the one the hand-written cells failed: every
  // case the cell RECORDS as matched must actually be passing in the artifact
  // the cell names. Compared against the observation directly, never against
  // the current freeze -- a cell is evidence about the run it cites, and a
  // freeze edited afterwards cannot make a case stop having passed.
  // A registered rename is resolved here too: the cell records the title it
  // FROZE, and greening copies the frozen titles verbatim, so a case renamed
  // by later work leaves the cell holding the old name while the observation
  // carries the new one. That is the register's case, not a false claim.
  const renames = registeredRenames()
  const claimedNotObserved = recorded.filter(title => !frozenTitlePresent(title, passing, renames, frozen.epic, frozen.stage))
  if (claimedNotObserved.length > 0) {
    findings.push({
      field: 'expectCasesMatched',
      problem: `${claimedNotObserved.length} case(s) recorded as matched are NOT passing in the observation this cell names -- the cell asserts a check the artifact does not support`,
      detail: claimedNotObserved,
    })
  }

  // Separately: the live freeze may have moved since the cell was greened.
  // That is drift, not a false claim, so it is reported under its own field --
  // conflating the two would let a supersession read as evidence tampering.
  const { unmatched } = recomputeMatchedCases(frozen.expectCases, passing, frozen.epic, frozen.stage)
  if (unmatched.length > 0) {
    findings.push({
      field: 'frozenCasesNotInObservation',
      problem: `${unmatched.length} case(s) in the LIVE freeze are not passing in this cell's observation -- the cell predates the current freeze and needs regreening`,
      detail: unmatched,
    })
  }
  const recordedSet = new Set(recorded)
  const staleRecord = frozen.expectCases.filter(title => passing.has(title) && !recordedSet.has(title))
  if (staleRecord.length > 0) {
    findings.push({
      field: 'frozenCasesNotRecorded',
      problem: `${staleRecord.length} case(s) the live freeze names and the observation confirms are absent from the cell's record -- drift, not a false claim`,
      detail: staleRecord,
    })
  }
  return findings
}

function main() {
  const requireAll = process.argv.includes('--require-all')
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, 'utf8'))

  const liveFreeze = new Map()
  for (const entry of freeze.entries) {
    if (entry.supersededBy) continue
    if (entry.supplementSeq !== undefined) continue
    liveFreeze.set(`${entry.epic}|${entry.stage}`, entry)
  }

  const cells = []
  for (const [epic, row] of Object.entries(ledger.rows)) {
    for (const [stage, cell] of Object.entries(row.cells ?? {})) {
      if (cell?.status === 'GREEN') cells.push({ epic, stage, cell })
    }
  }

  const results = { verified: [], mismatched: [], unavailable: [] }
  for (const { epic, stage, cell } of cells) {
    const key = `${epic}.${stage}`
    const reportPath = cell.observationReportPath
    // The recorded path first, then whatever the same run's rescued artifacts
    // offer. The fallback is used ONLY when the cell recorded a digest: with
    // no digest there is nothing to tell one run's report from another's, and
    // a gate that guessed would be auditing a cell against bytes it cannot
    // show belong to it.
    const rescued = cell.observationSha256 ? rescuedArtifactPaths(cell.ciRunUrl, process.env[ARTIFACT_DIR_ENV]) : []
    const searched = [...(typeof reportPath === 'string' ? [reportPath] : []), ...rescued].filter(path => existsSync(path))
    if (searched.length === 0) {
      results.unavailable.push({ key, reason: `observation artifact not reachable: ${reportPath ?? '(none recorded)'}`, ciRunUrl: cell.ciRunUrl })
      continue
    }
    const candidates = searched.map(path => ({ path, sha256: sha256(readFileSync(path)) }))
    const chosen = cell.observationSha256
      ? selectArtifactByDigest(candidates, cell.observationSha256)
      : candidates[0].path
    if (chosen === null) {
      // Two different failures, and collapsing them would send someone to
      // repair a sound row. The RECORDED artifact hashing wrong is a claim
      // about this cell's evidence -- MISMATCHED. A rescued copy of the same
      // run not containing the upload the digest was taken over is just an
      // absence: the run put two files named `vitest-report.json` in two
      // directories and only one may have been kept.
      const recorded = candidates.find(candidate => candidate.path === reportPath)
      if (recorded !== undefined) {
        results.mismatched.push({
          key,
          findings: [{
            field: 'observationSha256',
            problem: `artifact at the recorded path hashes to ${recorded.sha256}, not the recorded ${cell.observationSha256}`,
            detail: [],
          }],
        })
      } else {
        results.unavailable.push({
          key,
          reason: `the recorded artifact is gone and none of the ${candidates.length} rescued file(s) for this run hashes to ${cell.observationSha256}`,
          ciRunUrl: cell.ciRunUrl,
        })
      }
      continue
    }
    const bytes = readFileSync(chosen)
    const frozen = liveFreeze.get(`${epic}|${stage}`)
    if (frozen === undefined) {
      results.unavailable.push({ key, reason: 'no live command-freeze.json entry for this epic and stage', ciRunUrl: cell.ciRunUrl })
      continue
    }
    const findings = checkCellAgainstObservation(cell, frozen, JSON.parse(bytes.toString('utf8')))
    if (findings.length > 0) results.mismatched.push({ key, findings })
    else results.verified.push(key)
  }

  const findings = {
    summary: {
      greenCells: cells.length,
      verified: results.verified.length,
      mismatched: results.mismatched.length,
      unavailable: results.unavailable.length,
    },
    ...results,
  }
  const reportPath = opt('report')
  if (reportPath) writeFileSync(resolve(REPO_ROOT, reportPath), `${JSON.stringify(findings, null, 2)}\n`, 'utf8')

  console.log(
    `ledger.json: ${cells.length} GREEN cell(s) -- ${results.verified.length} RECOMPUTED from their observation, ` +
      `${results.mismatched.length} MISMATCHED, ${results.unavailable.length} UNAVAILABLE (artifact unreachable).`,
  )
  for (const m of results.mismatched) {
    for (const f of m.findings) console.error(`  ${m.key}: ${f.field} -- ${f.problem}${f.detail.length > 0 ? `\n      ${f.detail.slice(0, 5).join('\n      ')}` : ''}`)
  }
  if (results.unavailable.length > 0) {
    console.log('UNAVAILABLE (not a pass -- these cells are currently unprovable, re-download from ciRunUrl while the artifact is retained):')
    for (const u of results.unavailable) console.log(`  ${u.key}: ${u.reason}`)
  }

  const failed = results.mismatched.length > 0 || (requireAll && results.unavailable.length > 0)
  process.exit(failed ? 1 : 0)
}

// Guarded so the gate's pure functions can be imported by tests without the
// whole verification running as a side effect of the import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
