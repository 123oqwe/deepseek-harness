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
 * so the two can never disagree about what "passing" means.
 *
 * Four outcomes per cell, and only the first is a pass:
 *
 * | VERIFIED | every frozen case is present and passing in this observation |
 * | INCOMPLETE | at least one frozen case is absent or not passing here |
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
 * `--check` re-reads the recorded file and re-derives nothing: it reports what
 * is on record. Use the recording form to change it.
 *
 * @module scripts/first100/verify-p9-cells
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseVitestJsonReport } from './generate-ledger.mjs'

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
 * Verify every frozen P9 cell against one observation.
 *
 * A cell is VERIFIED only when EVERY frozen case is found passing. A partial
 * match is INCOMPLETE and names what was missing, because "most of the cases
 * passed" is the shape of a stage that silently lost coverage.
 * @param {{ entries: readonly object[] }} freeze - the command freeze.
 * @param {Set<string>} passing - case names observed passing, from the ledger's parser.
 * @param {readonly string[]} p9Ids - every P9 epic id, from the registry extension.
 * @returns {object[]} one record per (epic, stage), in stage order.
 */
export function verifyCells(freeze, passing, p9Ids, releasedEpics, stageBlockers = []) {
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
      const frozen = freeze.entries.filter(entry => entry.epic === epic && entry.stage === stage).at(-1)
      if (frozen === undefined) {
        cells.push({ epic, stage, status: 'UNFROZEN' })
        continue
      }
      const missing = frozen.expectCases.filter(title => !passing.has(title))
      cells.push({
        epic,
        stage,
        status: missing.length === 0 ? 'VERIFIED' : 'INCOMPLETE',
        frozenCases: frozen.expectCases.length,
        // Computed from the observation, never copied from the freeze.
        matchedCases: frozen.expectCases.length - missing.length,
        ...missing.length === 0 ? {} : { missingCases: missing },
      })
    }
  }
  return cells
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

  const { raw, titles } = parseVitestJsonReport(reportPath)
  const freeze = loadJson(COMMAND_FREEZE_PATH)
  const stageBlockers = existsSync(STAGE_BLOCKERS_PATH) ? loadJson(STAGE_BLOCKERS_PATH).entries ?? [] : []
  const cells = verifyCells(freeze, titles, p9Ids, releasedEpics, stageBlockers)
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
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
