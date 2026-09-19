/**
 * No epic carrying a live acceptance lock is ACCEPTED in the ledger
 * (BLOCKED-081).
 *
 * The ACCEPTANCE LOCKS register says which epics must not be accepted however
 * green their cells are, and until now nothing read it. `--accept` evaluates
 * four predicates — coverage closure, candidate-chain consistency, observation
 * distinctness, delegate sign-off — and none of them consults the register.
 * The enforcement was one person grepping before each sign-off, and that grep
 * misread a row once already: a LIFTED annotation read as a live lock. **That
 * near-miss ran in the safe direction and nothing would have caught the
 * opposite.**
 *
 * **Two rules, because the register states a lock in two places.**
 *
 * 1. The machine-readable mirror — the `ACCEPT-BLOCKED-BEGIN`/`END` block —
 *    lists one `accept-blocked: <EPIC>` line per live lock. Its own comment
 *    says it exists to be the parse target, precisely so a checker is not
 *    reading the prose table a human already misread.
 * 2. An OPEN entry's STATUS LINE may state the same thing in words — "must NOT
 *    be accepted", "stays unsigned", and the like. Only the status line of an
 *    entry whose status begins `OPEN` is scanned: a CLOSED entry keeps its
 *    original sentences as the record of what was once true (BLOCKED-232's
 *    ruling), and scanning its body would turn that convention into a failure.
 *
 * **Rule 2 PRINTS; it does not decide.** Its first run matched BLOCKED-265's
 * status line, which says the in-flight half "is not built at all" and names
 * `P4-07` in the same sentence — as the epic whose frozen cases DO observe
 * native fencing. The phrase and the epic id are both there and the sentence
 * locks nothing. Prose states a subject in ways no matcher recovers, which is
 * the reason the machine-readable mirror exists: its own comment says it is the
 * parse target precisely so a checker is not reading rows a human already
 * misread. So rule 1 is the gate and rule 2 is a reading for a person, and
 * narrowing rule 2's window until the tree went green would have been fitting
 * the rule to the answer.
 *
 * **Parse failure is a LOCK, never a pass.** A missing block, a malformed one,
 * or an unreadable ledger refuses. The opposite default reproduces the original
 * defect mechanically and at scale: a checker that cannot read the register
 * would report every epic unlocked.
 * @module scripts/first100/verify-acceptance-locks
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const QUEUE_PATH = join(REPO_ROOT, 'spec/first100/exec/BLOCKED-QUEUE.md')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')

/** The markers around the machine-readable mirror. */
const BEGIN = 'ACCEPT-BLOCKED-BEGIN'
const END = 'ACCEPT-BLOCKED-END'

/**
 * Phrases in a status line that assert an epic must not be accepted.
 *
 * Matched case-insensitively against the status line only. The list is the
 * register's own vocabulary rather than an invention: each phrase is one an
 * entry already uses to state a lock in prose.
 */
const LOCK_PHRASES = [
  'must not be accepted',
  'stays unsigned',
  'not be signed',
  'not built',
]

/**
 * The epics the machine-readable mirror lists as locked.
 *
 * @param {string} queue - the text of `BLOCKED-QUEUE.md`.
 * @returns {{ epics: string[] } | { unreadable: string }} the listed epics, or why the block could not be read.
 */
export function mirrorLockedEpics(queue) {
  const begin = queue.indexOf(BEGIN)
  const end = queue.indexOf(END)
  if (begin === -1) return { unreadable: `the ${BEGIN} marker is absent` }
  if (end === -1) return { unreadable: `the ${END} marker is absent` }
  if (end < begin) return { unreadable: `${END} precedes ${BEGIN}` }
  if (queue.indexOf(BEGIN, begin + 1) !== -1) return { unreadable: `${BEGIN} occurs more than once` }
  const body = queue.slice(begin + BEGIN.length, end)
  const epics = [...body.matchAll(/^\s*accept-blocked:\s*(\S+)\s*$/gmu)].map(match => match[1])
  // A block whose every line is prose is indistinguishable from one whose
  // entries were deleted, and the second is the dangerous reading. The register
  // is never legitimately empty while any lock is live, and an empty register
  // is stated by removing the block, not by emptying it.
  if (epics.length === 0) return { unreadable: `no \`accept-blocked:\` line inside the ${BEGIN} block` }
  return { epics }
}

/**
 * Epic ids named on the status line of an OPEN entry that asserts a lock.
 *
 * @param {string} queue - the text of `BLOCKED-QUEUE.md`.
 * @returns {{ id: string, epic: string, phrase: string, line: string }[]} one row per (entry, epic) pair, in file order.
 */
export function statusLineLockClaims(queue) {
  const claims = []
  const headings = [...queue.matchAll(/^#{2,4} (BLOCKED-\d+)\b[^\n]*$/gmu)]
  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length
    const next = headings[index + 1]
    const body = queue.slice(start, next === undefined ? queue.length : next.index)
    const status = /\*\*Status:?\*?\*?:?\s*\**\s*([A-Z][A-Z-]+)/u.exec(body)
    if (status === null || !status[1].startsWith('OPEN')) continue
    // The status LINE, not the entry: a CLOSED-style sentence further down is
    // material, and an OPEN entry's later paragraphs are analysis rather than
    // the entry's own verdict.
    const lineEnd = body.indexOf('\n', status.index)
    const line = body.slice(status.index, lineEnd === -1 ? body.length : lineEnd)
    const phrase = LOCK_PHRASES.find(candidate => line.toLowerCase().includes(candidate))
    if (phrase === undefined) continue
    for (const epic of new Set([...line.matchAll(/\bP\d-\d{2}\b/gu)].map(match => match[0]))) {
      claims.push({ id: heading[1], epic, phrase, line: line.trim() })
    }
  }
  return claims
}

/**
 * Epics the ledger records as ACCEPTED.
 * @param {unknown} ledger - the ledger document.
 * @returns {Set<string>} the accepted epic ids.
 */
export function acceptedEpics(ledger) {
  return new Set(Object.entries(ledger.rows).filter(([, row]) => row.status === 'ACCEPTED').map(([id]) => id))
}

/** Read both inputs, apply both rules, and exit. */
function main() {
  let queue
  let ledger
  try {
    queue = readFileSync(QUEUE_PATH, 'utf8')
    ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  } catch (error) {
    console.error(`verify-acceptance-locks: cannot read the register or the ledger, so every epic reads as unlocked — refusing: ${String(error)}`)
    process.exit(1)
  }

  const mirror = mirrorLockedEpics(queue)
  if ('unreadable' in mirror) {
    console.error(
      `verify-acceptance-locks: the acceptance-lock register cannot be read (${mirror.unreadable}). `
      + 'An unreadable register is treated as LOCKED, never as clear: a checker that cannot read it would otherwise report every epic unlocked.',
    )
    process.exit(1)
  }

  const accepted = acceptedEpics(ledger)
  const violations = mirror.epics.filter(epic => accepted.has(epic))

  // Rule 2's output, on stdout and before the verdict, because it is a reading
  // rather than a finding: every line here needs a person to decide whether the
  // sentence locks the epic it names.
  for (const claim of statusLineLockClaims(queue).filter(claim => accepted.has(claim.epic))) {
    console.log(`verify-acceptance-locks: CANDIDATE (not a failure) — ${claim.id} is OPEN, its status line says "${claim.phrase}", and it names ${claim.epic}, which is ACCEPTED`)
    console.log(`  read the sentence and decide whether it locks that epic: ${claim.line}`)
  }

  if (violations.length === 0) {
    console.log(
      `verify-acceptance-locks: ${String(mirror.epics.length)} live lock(s) and `
      + `${String(accepted.size)} ACCEPTED row(s); no epic is both.`,
    )
    process.exit(0)
  }

  for (const epic of violations) {
    console.error(`verify-acceptance-locks: ${epic} is listed \`accept-blocked\` AND is ACCEPTED in the ledger`)
  }
  process.exit(1)
}

// Run ONLY when this file is the process entry point, so the spec can import
// the predicates without exiting the process (the reason recorded in
// `verify-adapt-dispositions.mjs`).
const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) main()
