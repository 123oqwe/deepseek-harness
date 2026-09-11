/**
 * Every `adapt` package and every named standard on an epic's make-vs-use card
 * must have a recorded disposition — gate (e).
 *
 * The card records what the plan intended to reuse. The pre-flight records what
 * the epic actually did. Nothing compared them, so an epic could silently write
 * by hand what its own card said to adopt, and the omission left no trace: a
 * missing entry and a considered rejection looked identical.
 *
 * **Three dispositions, and silence is not one of them.**
 *
 * - `adopted[]` — taken, with the form it was taken in.
 * - `deviations[]` — not taken, with one of the allowed reasons. A deviation
 *   without a reason is not a disposition, it is the silence this gate exists
 *   to end.
 * - For a standard, `standardsOwned` or `standardsImported` — this epic fixes
 *   the vocabulary, or inherits it from a named source.
 *
 * A `PENDING_ADOPTION` entry — one carrying `landsIn`, recorded before the
 * stage that imports it exists — passes mid-epic and FAILS once the Fault
 * stage has started or the epic is ACCEPTED. By then the adoption has landed
 * or it was never made, and without this rule `landsIn` defers forever.
 *
 * An epic with no `makeVsUse` record at all and a card that names something is
 * `UNRECORDED`, which does not pass. That is the state P1-03 was in: three
 * `adapt` packages on its card, no pre-flight record of any kind, and the
 * fourth pre-flight question only became standard practice after that epic had
 * started.
 *
 * **Deferred only for an unstarted epic that has recorded NOTHING.** An epic
 * nobody has touched has nothing to disclose yet, so a total absence there is
 * listed separately rather than failing the gate — firing on 79 unstarted
 * epics would train its reader to ignore the output. But an epic that has
 * WRITTEN a record is disclosing, and an incomplete disclosure is worse than
 * an absent one because it reads as considered. Those gaps fail whatever the
 * stage. P2-04 is the case: its record says `adopted: []` while its card names
 * three adapt packages, and deferring it because no cell has greened yet would
 * have hidden exactly the omission this gate is for.
 *
 * Usage: `node scripts/first100/verify-adapt-dispositions.mjs`
 *
 * @module scripts/first100/verify-adapt-dispositions
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realitySet } from './epic-reality-set.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/make-vs-use-ledger.json')
const AUDIT_PATH = join(REPO_ROOT, 'spec/first100/exec/clause-subject-audit.json')
const EXEC_LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')
const OWNERSHIP_PATH = join(REPO_ROOT, 'spec/first100/exec/standards-ownership.json')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')

const loadJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** Whether any of this epic's cells has left NOT_RUN, so the epic has real work to disclose. */
function hasStarted(row) {
  return Object.values(row?.cells ?? {}).some(
    cell => cell?.status !== undefined && cell.status !== 'NOT_RUN' && cell.status !== 'N/A',
  )
}

/** The npm name an `adapt` entry can be matched by, or undefined when it names only a project. */
const adaptName = entry => entry.npm ?? entry.name

/**
 * The standards half of gate (e): which assigned or carded standards this
 * epic's record leaves undisclosed.
 *
 * Exported so the rule can be tested on constructed inputs rather than only
 * through the whole tree, where every epic's real record would have to be
 * disturbed to reach a branch.
 * @param standards - the standards this epic's make-vs-use card names.
 * @param declared - the epic's `makeVsUse` pre-flight record.
 * @param assigned - `standards-ownership.json`'s rows for this epic.
 * @returns one message per undisclosed standard; empty when all are dispositioned.
 */
export function standardDispositionGaps(standards, declared, assigned) {
  const missing = []
  // `standardsImported` entries may be a bare name or `{standard, from}`;
  // reading only the bare form reported P1-02's Sigstore bundle as
  // undisclosed when its record names both the standard and its source.
  const importedNames = (declared.standardsImported ?? []).map(
    entry => typeof entry === 'string' ? entry : entry?.standard,
  ).filter(Boolean)
  // Both lists accept a bare name or `{standard, ...}`; the object form
  // carries the evidence substring or the source epic. Reading only the
  // bare form reported a fully dispositioned standard as undisclosed.
  const ownedNames = (declared.standardsOwned ?? []).map(
    entry => typeof entry === 'string' ? entry : entry?.standard,
  ).filter(Boolean)
  // A deviation names a STANDARD in `standard` and an adapt package in
  // `name` + `npm`. The two keys mark two kinds of subject, not two spellings
  // of one: across the records, 57 adapt rows carry `name` + `npm` and 22
  // standard rows carry `standard`. So this reads `standard` only, and a
  // standard recorded under `name` is a malformed record rather than a shape
  // this gate should absorb — tolerating it would let an adapt row silently
  // discharge a standard's disposition.
  const deviatedNames = (declared.deviations ?? []).map(entry => entry.standard).filter(Boolean)
  const accounted = new Set([...ownedNames, ...importedNames, ...deviatedNames])
  for (const standard of standards) {
    if (!accounted.has(standard)) missing.push(`standard ${JSON.stringify(standard)} is neither owned, imported, nor deviated`)
  }
  // Shape ownership is ASSIGNED by standards-ownership.json, generated from
  // the plan. An epic the table names as owner must CLAIM it — the table
  // decides who owns the vocabulary, the check grades the evidence, and an
  // executor must not settle ownership by omission, which is what a backfill
  // did to 22 standards across 12 epics.
  //
  // **Ownership is not an obligation to adopt** (§12.85 note 47). It means
  // "if this vocabulary appears in the tree, this epic is answerable for it".
  // So a claim comes two ways and both are claims: ADOPT it and freeze a case
  // naming it, or MEASURE that the implementation took another route and
  // record that in `deviations[]` with the census. A measured non-adoption is
  // a disposition; it is the opposite of the silence this check refuses. The
  // rule this replaced admitted only the first, which left an epic whose
  // implementation never touched an assigned vocabulary with no honest way to
  // say so — it could either fail this gate or invent a case to satisfy it.
  const claimed = new Set([...ownedNames, ...deviatedNames])
  for (const entry of assigned) {
    if (entry.thisEpicOwns !== true) continue
    if (!claimed.has(entry.standard)) {
      missing.push(`standards-ownership.json assigns ${JSON.stringify(entry.standard)} to this epic, but neither standardsOwned nor deviations claims it`)
    }
  }
  return missing
}

function main() {
  const cards = new Map(loadJson(LEDGER_PATH).rows.map(row => [row.id, row]))
  const preFlight = loadJson(AUDIT_PATH).preFlight ?? {}
  const rows = loadJson(EXEC_LEDGER_PATH).rows
  const ownership = loadJson(OWNERSHIP_PATH).perEpic ?? {}
  const registryEpics = loadJson(REGISTRY_PATH).epics
  const freeze = loadJson(FREEZE_PATH).entries

  const unrecorded = []
  const deferred = []
  let satisfied = 0

  for (const [id, card] of cards) {
    const adapts = (card.oss ?? []).filter(entry => entry.role === 'adapt').map(adaptName).filter(Boolean)
    const standards = card.standards ?? []
    if (adapts.length === 0 && standards.length === 0) continue

    const declared = preFlight[id]?.makeVsUse
    const started = hasStarted(rows[id])
    const missing = []

    if (declared === undefined) {
      missing.push(`no makeVsUse record at all, while the card names ${String(adapts.length)} adapt package(s) and ${String(standards.length)} standard(s)`)
    } else {
      const dispositioned = new Set([
        ...(declared.adopted ?? []).map(adaptName).filter(Boolean),
        ...(declared.deviations ?? []).map(adaptName).filter(Boolean),
      ])
      for (const name of adapts) {
        if (!dispositioned.has(name)) missing.push(`adapt ${name} appears in neither adopted[] nor deviations[]`)
      }
      missing.push(...standardDispositionGaps(standards, declared, ownership[id] ?? []))

      const pending = (declared.adopted ?? []).filter(entry => typeof entry.landsIn === 'string' && entry.landsIn.length > 0)
      if (pending.length > 0) {
        const faultStarted = rows[id]?.cells?.F?.status !== undefined
          && rows[id].cells.F.status !== 'NOT_RUN' && rows[id].cells.F.status !== 'N/A'
        if (rows[id]?.status === 'ACCEPTED' || faultStarted) {
          for (const entry of pending) {
            missing.push(`${adaptName(entry)} is still adopted-pending (landsIn ${JSON.stringify(entry.landsIn)}) while the epic is ${rows[id]?.status === 'ACCEPTED' ? 'ACCEPTED' : 'past its Fault stage'} — a pending adoption is not a disposition at this point`)
          }
        }
      }

      for (const deviation of declared.deviations ?? []) {
        // A read-only reason is reserved for an ACCEPTED row. `accepted-unadopted`
        // says "this shipped, hand-written, and nothing propagates from it";
        // `ownership-transferred` says a standard's owner moved. Neither is
        // available to work still in flight, where "we did not adopt it" is a
        // live choice rather than a settled fact. Using one on an unaccepted
        // row opens exactly the escape the register exists to close — and a
        // batch backfill applied it to four such rows before this check
        // existed.
        //
        // Anchored at the start, because a disposition states its KIND first
        // and all 57 existing read-only reasons are written that way. An
        // unanchored match also fired on a reason that NAMED the old label
        // while replacing it -- "previously recorded as `accepted-unadopted`,
        // which said the row's status and not the ruling" is a real
        // disposition, and reading it as the label it corrects would force the
        // history out of the record to satisfy the check.
        const readOnly = /^\s*(?:accepted-unadopted|ownership-transferred)\b/u.test(String(deviation.reason))
        if (readOnly && rows[id]?.status !== 'ACCEPTED') {
          missing.push(`a deviation for ${String(adaptName(deviation) ?? deviation.standard)} uses a read-only reason, but this epic is ${String(rows[id]?.status ?? 'unrecorded')} rather than ACCEPTED`)
        }
        if (typeof deviation.reason !== 'string' || deviation.reason.length === 0) {
          missing.push(`a deviation for ${String(adaptName(deviation) ?? deviation.standard)} carries no reason, which is not a disposition`)
        }

        // `slice-consumer` says: this epic does not implement the thing, it
        // RECEIVES it from a scheduled slice. That is a real disposition and
        // not a rejection, and the difference is checkable at exactly one
        // moment — when the slice lands. Before then the consumer has nothing
        // to wire; after, a consumer that has not wired it is a defect, while
        // a rejection would still be fine.
        //
        // So the gate bites later rather than looser: `landsIn` names the path
        // the slice creates, and once that path exists the epic's reality set
        // must import it. Delegate ruling, 2026-09-07, scoped to slices §3.1
        // to §3.4 name with a schedule.
        if (/^\s*slice-consumer\b/u.test(String(deviation.reason))) {
          if (typeof deviation.landsIn !== 'string' || deviation.landsIn.length === 0) {
            missing.push(`a slice-consumer deviation for ${String(adaptName(deviation) ?? deviation.standard)} names no landsIn path, so nothing can tell when the slice arrived`)
          } else if (existsSync(resolve(REPO_ROOT, deviation.landsIn))) {
            const registryEpic = registryEpics.find(entry => entry.id === id)
            const files = registryEpic === undefined ? [] : realitySet(registryEpic, freeze)
            const importing = files.some(file => {
              const absolute = resolve(REPO_ROOT, file)
              if (!existsSync(absolute) || !statSync(absolute).isFile()) return false
              return readFileSync(absolute, 'utf8').includes(String(deviation.importedAs ?? deviation.landsIn))
            })
            if (!importing) {
              missing.push(`${String(adaptName(deviation) ?? deviation.standard)} is recorded as a slice-consumer and its slice has LANDED at ${deviation.landsIn}, but no file in this epic's reality set imports it`)
            }
          }
        }
      }
    }

    // An epic that has WRITTEN a record is disclosing, and an incomplete
    // disclosure is worse than none: it reads as considered. So a record's
    // gaps are enforced whatever the stage, and only a total absence on an
    // unstarted epic is deferred.
    if (missing.length === 0) satisfied += 1
    else if (started || declared !== undefined) unrecorded.push({ id, missing })
    else deferred.push(id)
  }

  for (const { id, missing } of unrecorded) {
    console.error(`  UNRECORDED  ${id}`)
    for (const line of missing) console.error(`      ${line}`)
  }
  if (deferred.length > 0) {
    console.log(`not yet started, nothing to disclose (${String(deferred.length)}): ${deferred.sort().join(' ')}`)
  }
  if (unrecorded.length === 0) {
    console.log(`verify-adapt-dispositions: ${String(satisfied)} started epic(s) with a card have every adapt package and standard dispositioned.`)
    return
  }
  console.error(
    `verify-adapt-dispositions: ${String(unrecorded.length)} started epic(s) leave an adapt package or a standard undisclosed. `
    + 'Each must be adopted (with its form), deviated (with a reason), or — for a standard — owned or imported. '
    + 'Silence is not a disposition: an omission and a considered rejection are indistinguishable without one.',
  )
  process.exit(1)
}

main()
