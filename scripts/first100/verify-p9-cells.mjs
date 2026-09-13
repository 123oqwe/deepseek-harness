/**
 * Verify the P9 extension items against a real CI observation.
 *
 * The nine P9 items are not ledger rows (maintainer decision C3), so the
 * ledger's greening path cannot record them: it indexes `rows[epic]` and a P9
 * id is not there. This script answers the same question the ledger asks — does
 * a real observation show every frozen case for this cell PASSING — and writes
 * the answer to `spec/first100/exec/p9-verification.json`.
 *
 * **It reuses the ledger's own report parser rather than re-reading the JSON.**
 * BLOCKED-106 was a set of cells whose recorded case counts had been copied
 * from the freeze instead of computed from the artifact; the counts here are
 * derived by `parseVitestJsonReport`, the same function the ledger greens with,
 * so the two can never disagree about what "passing" means. Titles are matched
 * the way the ledger matches them too: through the registered-rename table, and
 * refusing a frozen string that names more than one passing case.
 *
 * Outcomes per cell, and only the first is a pass:
 *
 * | VERIFIED | every frozen case is present and passing in this observation, each exactly once |
 * | INCOMPLETE | at least one frozen case is absent or not passing here |
 * | AMBIGUOUS | every frozen case is passing, but at least one frozen string names more than one passing case, so another cell's evidence could satisfy it (BLOCKED-104) |
 * | UNFROZEN | the stage has no freeze entry yet, so there is nothing to verify |
 * | PREMATURE | the epic is not authorized to start yet, whatever its cases show |
 * | SCHEDULED_BLOCKED | the stage's clause has no subject, and the blocker is on record and still open |
 * | STALE_BLOCKER | a stage claims a blocker that is no longer open, or does not exist |
 *
 * SCHEDULED_BLOCKED is a terminal state the program's own goal names — "every
 * P9 item VERIFIED **or** scheduled-BLOCKED on record" — not an invention. It
 * is claimed through `p9-stage-blockers.json`, and the claim is CHECKED: the
 * referenced entry is read out of the queue and must still say OPEN. Without
 * that read the mapping would be the next thing written and never consulted,
 * and a stage would stay blocked for months after its blocker was resolved. A
 * stale or missing reference is reported as its own state, never as blocked.
 *
 * PREMATURE exists because authorization is not the same question as evidence.
 * Maintainer decision C3 released P9-01…07 to run in parallel with R10 and left
 * P9-08 and P9-09 in W21/W22 behind it; the registry extension records that as
 * `parallelWithR10`. Both were opened anyway during this program — the failure
 * was memory, since nothing read that field, and "the next item" is not the
 * same set as "the next item we may start". This gate reads it, so a cell whose
 * epic has not been released cannot reach VERIFIED no matter how green it is.
 *
 * An epic reaches `VERIFIED` only when all four stages do. Anything else is
 * reported as what it is; nothing is ever inferred from a sibling stage.
 *
 * Usage:
 *   node scripts/first100/verify-p9-cells.mjs \
 *     --report <vitest-report.json> --ci-run-url <url> --candidate-sha <sha40>
 *   node scripts/first100/verify-p9-cells.mjs --check
 *
 * `--check` re-derives no verdict: it reports what is on record, and fails when
 * a recorded VERIFIED cell no longer describes the tree it runs in (see
 * {@link staleCells}). Use the recording form to change the record.
 *
 * @module scripts/first100/verify-p9-cells
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findAmbiguousCaseMatches, parseVitestJsonReport } from './generate-ledger.mjs'
import { frozenTitlePresent, registeredRenames } from './frozen-title-renames.mjs'
import { commitmentKey, freezeEntriesAt } from './verify-freeze-in-candidate-tree.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const COMMAND_FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const REGISTRY_EXTENSION_PATH = join(REPO_ROOT, 'tests/first100/registry-extension.json')
const OUTPUT_PATH = join(REPO_ROOT, 'spec/first100/exec/p9-verification.json')
const STAGE_BLOCKERS_PATH = join(REPO_ROOT, 'spec/first100/exec/p9-stage-blockers.json')
const BLOCKED_QUEUE_PATH = join(REPO_ROOT, 'spec/first100/exec/BLOCKED-QUEUE.md')

/** Every stage a P9 epic must clear before it counts as verified. */
const STAGES = ['C', 'P', 'U', 'F']

/**
 * Whether the queue still records `blockerId` as open.
 *
 * Read from the queue itself rather than trusted from the mapping: a blocker
 * that was resolved must stop excusing the stage that named it, and the only
 * place that fact lives is the entry's own status line.
 * @param blockerId - e.g. `BLOCKED-107`.
 * @returns `'OPEN'`, `'CLOSED'`, or `'MISSING'` when the queue has no such entry.
 */
function blockerStatus(blockerId) {
  const queue = readFileSync(BLOCKED_QUEUE_PATH, 'utf8')
  // Headings appear as `### BLOCKED-107 — ...` or `## BLOCKED-116 — ...`.
  const heading = new RegExp(`^#{2,4} ${blockerId}\\b[^\\n]*$`, 'm').exec(queue)
  if (heading === null) return 'MISSING'
  const body = queue.slice(heading.index, heading.index + 2000)
  // Both status spellings occur: `**Status: OPEN, ...` and `**Status:** OPEN`.
  const status = /\*\*Status:?\*?\*?:?\s*([A-Z-]+)/.exec(body)?.[1] ?? ''
  return status === 'OPEN' ? 'OPEN' : 'CLOSED'
}

/** @param {string} text @returns {string} lowercase hex sha256. */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** @param {string} path @returns {unknown} parsed JSON. */
function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Read one flag's value from argv, or `undefined`.
 * @param {readonly string[]} argv - process arguments.
 * @param {string} flag - the flag to read, including its leading dashes.
 * @returns {string | undefined} the value that followed it.
 */
function flag(argv, flag_) {
  const index = argv.indexOf(flag_)
  return index === -1 ? undefined : argv[index + 1]
}

/**
 * The freeze entry a P9 cell is judged against: the last one written for its
 * stage. Recording and the staleness check both call this, so they always judge
 * the same entry.
 * @param freeze - the command freeze.
 * @param epic - the P9 epic.
 * @param stage - the stage.
 * @returns the entry, or `undefined` when the stage has none.
 */
function selectFrozenEntry(freeze, epic, stage) {
  return freeze.entries.filter(entry => entry.epic === epic && entry.stage === stage).at(-1)
}

/**
 * Every repository path a freeze entry's observation depends on: the files it
 * names and the test paths its command runs. Flags such as `--reporter=json`
 * are not paths and are left out.
 * @param entry - a command-freeze entry.
 * @returns the distinct paths.
 */
export function referencedPaths(entry) {
  const commandPaths = entry.argv.slice(4).filter(arg => !arg.startsWith('-'))
  return [...new Set([...(entry.files ?? []), ...commandPaths])]
}

/**
 * Verify every frozen P9 cell against one observation.
 *
 * A cell is VERIFIED only when EVERY frozen case is found passing, and each
 * frozen string names exactly one passing case. A partial match is INCOMPLETE
 * and names what was missing, because "most of the cases passed" is the shape
 * of a stage that silently lost coverage.
 *
 * `matching` carries the ledger's two matching rules. With neither given the
 * result is what it was before they existed: a frozen title matches only when
 * that exact string is passing, and no count is consulted.
 * @param {{ entries: readonly object[] }} freeze - the command freeze.
 * @param {Set<string>} passing - case names observed passing, from the ledger's parser.
 * @param {readonly string[]} p9Ids - every P9 epic id, from the registry extension.
 * @param releasedEpics - the epics authorized to start; `undefined` authorizes all.
 * @param stageBlockers - stages parked on a recorded blocker.
 * @param matching - `matchCounts` from the ledger's parser and `renames` from the rename register.
 * @returns {object[]} one record per (epic, stage), in stage order.
 */
export function verifyCells(freeze, passing, p9Ids, releasedEpics, stageBlockers = [], matching = {}) {
  const renames = matching.renames ?? new Map()
  const cells = []
  for (const epic of p9Ids) {
    if (releasedEpics !== undefined && !releasedEpics.has(epic)) {
      // Checked before the freeze lookup: an unreleased epic's cells are not
      // "unfrozen pending work", they are work that should not have started.
      for (const stage of STAGES) cells.push({ epic, stage, status: 'PREMATURE' })
      continue
    }
    for (const stage of STAGES) {
      const blocked = stageBlockers.find(entry => entry.epic === epic && entry.stage === stage)
      if (blocked !== undefined) {
        const status = blockerStatus(blocked.blocker)
        cells.push(status === 'OPEN'
          ? { epic, stage, status: 'SCHEDULED_BLOCKED', blocker: blocked.blocker, clause: blocked.clause }
          : { epic, stage, status: 'STALE_BLOCKER', blocker: blocked.blocker, detail: `${blocked.blocker} is ${status}` })
        continue
      }
      const frozen = selectFrozenEntry(freeze, epic, stage)
      if (frozen === undefined) {
        cells.push({ epic, stage, status: 'UNFROZEN' })
        continue
      }
      const missing = frozen.expectCases.filter(title => !frozenTitlePresent(title, passing, renames, epic, stage))
      // A frozen string that names more than one passing case is satisfied by
      // any of them, so deleting this cell's own case would leave it verified
      // on another cell's evidence (BLOCKED-104). The ledger refuses to green
      // such a cell; this refuses to verify one.
      const ambiguous = matching.matchCounts === undefined
        ? []
        : findAmbiguousCaseMatches(frozen.expectCases, matching.matchCounts)
      const status = missing.length > 0 ? 'INCOMPLETE' : (ambiguous.length > 0 ? 'AMBIGUOUS' : 'VERIFIED')
      cells.push({
        epic,
        stage,
        status,
        frozenCases: frozen.expectCases.length,
        // Computed from the observation, never copied from the freeze.
        matchedCases: frozen.expectCases.length - missing.length,
        ...missing.length === 0 ? {} : { missingCases: missing },
        ...ambiguous.length === 0 ? {} : { ambiguousCases: ambiguous.map(entry => ({ title: entry.title, count: entry.count })) },
      })
    }
  }
  return cells
}

/**
 * Which recorded VERIFIED cells no longer describe the tree this runs in.
 *
 * A record proves what one observation showed about one tree. `--check` used
 * to re-read it and nothing else, so a record went on saying VERIFIED after the
 * files it had observed changed, and no gate failed: measured 2026-09-13, 17 of
 * 26 recorded cells had changed files before any rebase. A cell is stale when
 * the recorded candidate cannot be read here, when the stage's freeze entry has
 * no identical commitment in that candidate's tree, or when a path the entry
 * names differs between that candidate and HEAD. Only VERIFIED cells can go
 * stale; every other status claims no observation of the current files.
 * @param record - the recorded verification.
 * @param freeze - the command freeze as it is now.
 * @param git - `freezeAt(sha)` gives that tree's freeze entries, or `undefined`
 *   when it cannot be read; `changedPaths(sha, paths)` gives the paths that
 *   differ between that commit and HEAD, or `undefined` when the comparison fails.
 * @returns one `{ epic, stage, reason }` per stale cell.
 */
export function staleCells(record, freeze, git) {
  const verified = (record.cells ?? []).filter(cell => cell.status === 'VERIFIED')
  const recordedEntries = git.freezeAt(record.candidateSha)
  if (recordedEntries === undefined) {
    // An unreadable candidate is never a pass: nothing could be compared.
    return verified.map(cell => ({
      epic: cell.epic,
      stage: cell.stage,
      reason: `the recorded candidate ${record.candidateSha} cannot be read in this clone`,
    }))
  }
  const recordedCommitments = new Set(recordedEntries.map(commitmentKey))
  const stale = []
  for (const cell of verified) {
    const entry = selectFrozenEntry(freeze, cell.epic, cell.stage)
    if (entry === undefined) {
      stale.push({ epic: cell.epic, stage: cell.stage, reason: 'the stage has no freeze entry now' })
      continue
    }
    if (!recordedCommitments.has(commitmentKey(entry))) {
      stale.push({ epic: cell.epic, stage: cell.stage, reason: 'its freeze entry was written or changed after the recorded observation' })
      continue
    }
    const changed = git.changedPaths(record.candidateSha, referencedPaths(entry))
    if (changed === undefined) {
      stale.push({ epic: cell.epic, stage: cell.stage, reason: 'the files it names could not be compared with the recorded candidate' })
    } else if (changed.length > 0) {
      stale.push({ epic: cell.epic, stage: cell.stage, reason: `changed since the recorded observation: ${changed.join(', ')}` })
    }
  }
  return stale
}

/** The repository this script runs in, as {@link staleCells} reads it. */
const repositoryGit = {
  freezeAt: freezeEntriesAt,
  changedPaths(sha, paths) {
    try {
      const output = execFileSync('git', ['diff', '--name-only', sha, 'HEAD', '--', ...paths], { cwd: REPO_ROOT, encoding: 'utf8' })
      return output.split('\n').filter(line => line.length > 0)
    } catch {
      // Swallows git's failure to compare (an absent commit, a broken clone).
      // The caller turns `undefined` into a stale cell, so it never passes.
      return undefined
    }
  },
}

/**
 * Fold per-cell outcomes into one terminal state per epic.
 * @param {readonly object[]} cells - per-(epic, stage) records.
 * @param {readonly string[]} p9Ids - every P9 epic id.
 * @returns {object[]} one record per epic.
 */
export function foldEpics(cells, p9Ids) {
  return p9Ids.map((epic) => {
    const own = cells.filter(cell => cell.epic === epic)
    if (own.every(cell => cell.status === 'PREMATURE')) {
      return { epic, verifiedStages: [], terminalState: 'PREMATURE' }
    }
    const verified = own.filter(cell => cell.status === 'VERIFIED').map(cell => cell.stage)
    const blockedStages = own.filter(cell => cell.status === 'SCHEDULED_BLOCKED').map(cell => cell.stage)
    if (own.some(cell => cell.status === 'STALE_BLOCKER')) {
      return { epic, verifiedStages: verified, blockedStages, terminalState: 'STALE_BLOCKER' }
    }
    // Settled when every stage is either verified or blocked on record. An
    // epic whose work is done to the edge of what has a subject is finished in
    // the only sense available to it, and saying so is more honest than leaving
    // it IN_PROGRESS forever.
    const settled = verified.length + blockedStages.length === STAGES.length
    return {
      epic,
      verifiedStages: verified,
      ...blockedStages.length === 0 ? {} : { blockedStages },
      terminalState: settled ? (blockedStages.length === 0 ? 'VERIFIED' : 'VERIFIED_OR_BLOCKED') : 'IN_PROGRESS',
    }
  })
}

/**
 * The one line a reader takes the program's P9 answer from.
 *
 * The goal is "every P9 item VERIFIED **or** scheduled-BLOCKED on record", so
 * that is what this counts. Counting only `VERIFIED` under-reports an item that
 * has genuinely settled — every stage either verified or blocked on a recorded,
 * still-open blocker — and the summary would say the program is further from
 * its terminal state than it is. The two are still printed apart, because
 * "proved" and "proved unbuildable and parked" are different facts and a reader
 * deciding what to work on needs to tell them apart.
 * @param epics - the per-epic terminal states.
 * @param total - how many P9 items the program has.
 * @param candidateSha - the observation these states were computed from.
 * @param provenance - how the caller obtained them, for the sentence.
 * @returns the summary line.
 */
export function summaryLine(epics, total, candidateSha, provenance) {
  const verified = epics.filter(epic => epic.terminalState === 'VERIFIED').length
  const settledWithBlockers = epics.filter(epic => epic.terminalState === 'VERIFIED_OR_BLOCKED').length
  const settled = verified + settledWithBlockers
  const blockedNote = settledWithBlockers > 0
    ? ` (${String(verified)} fully verified, ${String(settledWithBlockers)} verified-or-scheduled-BLOCKED)`
    : ''
  return `verify-p9-cells: ${String(settled)}/${String(total)} P9 items settled${blockedNote} ${provenance} ${candidateSha}`
}

function main() {
  const argv = process.argv.slice(2)
  const registry = loadJson(REGISTRY_EXTENSION_PATH)
  const rows = Array.isArray(registry) ? registry : (registry.epics ?? [])
  const p9Ids = rows.map(row => row.id).filter(id => typeof id === 'string' && id.startsWith('P9-'))
  // C3's release set, read from the registry rather than restated here: a list
  // written into this script would be a second copy of the decision, and the
  // two would agree only until one of them was edited.
  const releasedEpics = new Set(rows.filter(row => row.parallelWithR10 === true).map(row => row.id))

  if (argv.includes('--check')) {
    if (!existsSync(OUTPUT_PATH)) {
      console.error(`verify-p9-cells: nothing on record at ${OUTPUT_PATH}`)
      process.exit(1)
    }
    const record = loadJson(OUTPUT_PATH)
    console.log(summaryLine(record.epics, p9Ids.length, record.candidateSha, 'on record,'))
    for (const epic of record.epics) {
      console.log(`  ${epic.epic}: ${epic.terminalState} [${epic.verifiedStages.join('') || '-'}]`)
    }
    const stale = staleCells(record, loadJson(COMMAND_FREEZE_PATH), repositoryGit)
    if (stale.length > 0) {
      for (const cell of stale) console.error(`  STALE ${cell.epic}.${cell.stage}: ${cell.reason}`)
      console.error(
        `verify-p9-cells: ${String(stale.length)} recorded cell(s) no longer describe this tree; `
        + 're-record from an observation of it with --report',
      )
      process.exit(1)
    }
    return
  }

  const reportPath = flag(argv, '--report')
  const ciRunUrl = flag(argv, '--ci-run-url')
  const candidateSha = flag(argv, '--candidate-sha')
  if (reportPath === undefined || ciRunUrl === undefined || candidateSha === undefined) {
    console.error('usage: verify-p9-cells.mjs --report <path> --ci-run-url <url> --candidate-sha <sha> | --check')
    process.exit(1)
  }
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error(`verify-p9-cells: --candidate-sha must be a full 40-character sha, got "${candidateSha}"`)
    process.exit(1)
  }
  // The SHA must be the one the ARTIFACT carries, not one the caller typed.
  // A well-formed but wrong sha passed every check here until 2026-09-05, when
  // one was recorded by hand and caught only by re-reading the run: the format
  // check proved the string was a sha, never that it was THIS observation's.
  // GitHub's artifact directory is named `<artifact>-<sha>`, so the evidence
  // for this is in the path already.
  const shaFromArtifactPath = /-([0-9a-f]{40})(?:\/|$)/.exec(dirname(reportPath))?.[1]
  if (shaFromArtifactPath !== undefined && shaFromArtifactPath !== candidateSha) {
    console.error(
      `verify-p9-cells: --candidate-sha ${candidateSha} does not match the artifact it was read from `
      + `(${shaFromArtifactPath}); the report and the sha must describe the same run`,
    )
    process.exit(1)
  }
  if (!existsSync(reportPath)) {
    console.error(`verify-p9-cells: report not found: ${reportPath}`)
    process.exit(1)
  }

  const { raw, titles, matchCounts } = parseVitestJsonReport(reportPath)
  const freeze = loadJson(COMMAND_FREEZE_PATH)
  const stageBlockers = existsSync(STAGE_BLOCKERS_PATH) ? loadJson(STAGE_BLOCKERS_PATH).entries ?? [] : []
  const cells = verifyCells(freeze, titles, p9Ids, releasedEpics, stageBlockers, { matchCounts, renames: registeredRenames() })
  const epics = foldEpics(cells, p9Ids)
  const record = {
    schema: { name: 'first100-p9-verification', version: '1.0' },
    ciRunUrl,
    candidateSha,
    observationSha256: sha256(raw),
    epics,
    cells,
  }
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(record, null, 2)}\n`)
  console.log(`verify-p9-cells: wrote ${OUTPUT_PATH}`)
  console.log(summaryLine(epics, p9Ids.length, candidateSha, 'from observation'))
  for (const cell of cells) {
    if (cell.status === 'INCOMPLETE') {
      console.log(`  INCOMPLETE ${cell.epic}.${cell.stage}: ${cell.matchedCases}/${cell.frozenCases} cases passing here`)
    }
    if (cell.status === 'AMBIGUOUS') {
      console.log(`  AMBIGUOUS ${cell.epic}.${cell.stage}: ${String(cell.ambiguousCases.length)} frozen case string(s) each name more than one passing case`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
