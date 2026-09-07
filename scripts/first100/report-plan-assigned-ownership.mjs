/**
 * Compare the standards the PLAN assigns each epic to own against what the
 * pre-flight records actually claim.
 *
 * `standards-ownership.json` is generated from the plan's shape-ownership
 * marking and is the single source for who owns which vocabulary. Ownership is
 * a decision, made once, independent of any test.
 *
 * **This is a report, not a gate, and the reason is a live rule conflict.**
 * `verify-make-vs-use` requires an owned standard to be named by a live frozen
 * case, and that check has caught real over-claiming — P0-05 has 105 frozen
 * cases and not one mentions OpenFeature. But the plan assigns P0-05 exactly
 * that standard. So:
 *
 * - Read the plan as authority and every assigned standard becomes `owned`,
 *   which the frozen-case check then rejects in bulk.
 * - Read the check as authority and the records contradict the plan they were
 *   built from.
 *
 * Neither is the executor's to settle, so this prints the comparison and
 * exits zero. It becomes a gate once the rule is decided.
 *
 * Usage: `node scripts/first100/report-plan-assigned-ownership.mjs`
 *
 * @module scripts/first100/report-plan-assigned-ownership
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OWNERSHIP_PATH = join(REPO_ROOT, 'spec/first100/exec/standards-ownership.json')
const AUDIT_PATH = join(REPO_ROOT, 'spec/first100/exec/clause-subject-audit.json')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')

/**
 * The standards each epic is assigned to own.
 *
 * Read from the GENERATED `standards-ownership.json` rather than by parsing
 * the plan's prose. An earlier version scraped the card text and produced
 * names subtly different from the generator's — "OpenFeature evaluation API"
 * against "OpenFeature evaluation API (optional)" — so seven epics looked like
 * gaps when the only disagreement was a parenthetical. Two parsers of one
 * document is one parser too many.
 * @returns owned standard names by epic id.
 */
function planAssignedOwnership() {
  const perEpic = JSON.parse(readFileSync(OWNERSHIP_PATH, 'utf8')).perEpic ?? {}
  const assigned = new Map()
  for (const [epic, standards] of Object.entries(perEpic)) {
    const owned = standards.filter(entry => entry.thisEpicOwns === true).map(entry => entry.standard)
    if (owned.length > 0) assigned.set(epic, owned)
  }
  return assigned
}

/** The standard names an epic's record claims to own, whatever the basis. */
function recordedOwnership(record) {
  return new Set((record?.standardsOwned ?? []).map(entry => typeof entry === 'string' ? entry : entry?.standard).filter(Boolean))
}

function main() {
  const assigned = planAssignedOwnership()
  const preFlight = JSON.parse(readFileSync(AUDIT_PATH, 'utf8')).preFlight ?? {}
  const rows = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).rows

  const gaps = []
  let matched = 0
  for (const [epic, standards] of [...assigned].sort()) {
    const record = preFlight[epic]?.makeVsUse
    if (record === undefined) continue
    const claimed = recordedOwnership(record)
    const missing = standards.filter(standard => !claimed.has(standard))
    if (missing.length === 0) matched += standards.length
    else gaps.push({ epic, status: rows[epic]?.status ?? 'unrecorded', missing })
  }

  const total = [...assigned.values()].reduce((count, list) => count + list.length, 0)
  console.log(`plan-assigned ownership: ${String(assigned.size)} epic(s), ${String(total)} standard(s) assigned by standards-ownership.json.`)
  console.log(`of the epics that have a pre-flight record: ${String(matched)} assigned standard(s) claimed, ${String(gaps.length)} epic(s) with a gap.`)
  for (const { epic, status, missing } of gaps) {
    console.log(`  ${epic} (${status})`)
    for (const standard of missing) console.log(`      assigned but not claimed: ${standard}`)
  }
  console.log('Report only. Whether an assignment overrides the frozen-case requirement is a rule decision, not this script\'s.')
}

main()
