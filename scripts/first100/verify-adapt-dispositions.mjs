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
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/make-vs-use-ledger.json')
const AUDIT_PATH = join(REPO_ROOT, 'spec/first100/exec/clause-subject-audit.json')
const EXEC_LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')

const loadJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** Whether any of this epic's cells has left NOT_RUN, so the epic has real work to disclose. */
function hasStarted(row) {
  return Object.values(row?.cells ?? {}).some(
    cell => cell?.status !== undefined && cell.status !== 'NOT_RUN' && cell.status !== 'N/A',
  )
}

/** The npm name an `adapt` entry can be matched by, or undefined when it names only a project. */
const adaptName = entry => entry.npm ?? entry.name

function main() {
  const cards = new Map(loadJson(LEDGER_PATH).rows.map(row => [row.id, row]))
  const preFlight = loadJson(AUDIT_PATH).preFlight ?? {}
  const rows = loadJson(EXEC_LEDGER_PATH).rows

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
      const accounted = new Set([
        ...ownedNames,
        ...importedNames,
        ...(declared.deviations ?? []).map(entry => entry.standard).filter(Boolean),
      ])
      for (const standard of standards) {
        if (!accounted.has(standard)) missing.push(`standard ${JSON.stringify(standard)} is neither owned, imported, nor deviated`)
      }
      for (const deviation of declared.deviations ?? []) {
        if (typeof deviation.reason !== 'string' || deviation.reason.length === 0) {
          missing.push(`a deviation for ${String(adaptName(deviation) ?? deviation.standard)} carries no reason, which is not a disposition`)
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
