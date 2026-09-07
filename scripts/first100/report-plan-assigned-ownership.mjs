/**
 * Compare the standards the PLAN assigns each epic to own against what the
 * pre-flight records actually claim.
 *
 * `make-vs-use-plan.md` marks shape ownership inline, on the standards line of
 * each epic's card: a standard followed by `唯一涉及者,本 epic 是形状所有者`
 * is assigned to that epic. That is a decision, made once, independent of any
 * test.
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
const PLAN_PATH = join(REPO_ROOT, 'spec/first100/exec/make-vs-use-plan.md')
const AUDIT_PATH = join(REPO_ROOT, 'spec/first100/exec/clause-subject-audit.json')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')

/** The marker the plan uses to assign a vocabulary's shape to one epic. */
const OWNER_MARKER = '形状所有者'

/**
 * The standards each epic's card assigns it to own.
 *
 * Parsed from the card's own standards line rather than from a maintained
 * list, so the report cannot drift from the document it reports on.
 * @returns owned standard names by epic id.
 */
function planAssignedOwnership() {
  const assigned = new Map()
  let current
  for (const line of readFileSync(PLAN_PATH, 'utf8').split('\n')) {
    const heading = line.match(/`?(P\d-\d\d)`?/u)
    if (line.startsWith('####') && heading !== null) {
      current = heading[1]
      continue
    }
    if (current === undefined || !/标准[(（]绑定词汇[)）]/u.test(line)) continue
    const body = line.replace(/^.*?标准[(（]绑定词汇[)）][^:：]*[:：]/u, '')
    for (const item of body.split(' · ')) {
      if (!item.includes(OWNER_MARKER)) continue
      const name = item.replace(/\(\*\*[^)]*\)/gu, '').replaceAll('**', '').split('(')[0].trim()
      if (name.length > 2) assigned.set(current, [...assigned.get(current) ?? [], name])
    }
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
  console.log(`plan-assigned ownership: ${String(assigned.size)} epic(s), ${String(total)} standard(s) marked "${OWNER_MARKER}".`)
  console.log(`of the epics that have a pre-flight record: ${String(matched)} assigned standard(s) claimed, ${String(gaps.length)} epic(s) with a gap.`)
  for (const { epic, status, missing } of gaps) {
    console.log(`  ${epic} (${status})`)
    for (const standard of missing) console.log(`      assigned but not claimed: ${standard}`)
  }
  console.log('Report only. Whether an assignment overrides the frozen-case requirement is a rule decision, not this script\'s.')
}

main()
