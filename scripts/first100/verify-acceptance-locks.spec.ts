/**
 * The acceptance-lock gate: which readings refuse, which merely report, and
 * the two controls that keep the second from being vacuous (BLOCKED-081).
 *
 * The register's whole defect was that a human grep decided it and once
 * misread a row. So the cases here are about the two things a replacement must
 * not do: pass because it could not read, and fail because prose contained a
 * phrase.
 */

import { describe, expect, it } from 'vitest'
import { acceptedEpics, mirrorLockedEpics, statusLineLockClaims } from './verify-acceptance-locks.mjs'

/**
 * A register with the given mirror body and entries.
 * @param mirror - the lines to put inside the machine-readable block.
 * @param entries - entry bodies, already including their `**Status:**` lines.
 * @returns the register text.
 */
function register(mirror: string, entries = ''): string {
  return [
    '## ACCEPTANCE LOCKS — epics that MUST NOT be marked ACCEPTED',
    '',
    '<!-- ACCEPT-BLOCKED-BEGIN — machine-readable mirror.',
    mirror,
    'ACCEPT-BLOCKED-END -->',
    '',
    entries,
  ].join('\n')
}

const LEDGER = { rows: { 'P1-02': { status: 'ACCEPTED' }, 'P6-01': { status: 'NOT_RUN' }, 'P4-07': { status: 'ACCEPTED' } } }

describe('the machine-readable mirror decides', () => {
  it('reads the listed epics', () => {
    expect(mirrorLockedEpics(register('accept-blocked: P6-01\naccept-blocked: P1-02'))).toEqual({ epics: ['P6-01', 'P1-02'] })
  })

  it('catches a listed epic that the ledger has ACCEPTED', () => {
    const mirror = mirrorLockedEpics(register('accept-blocked: P1-02'))
    expect('epics' in mirror).toBe(true)
    const accepted = acceptedEpics(LEDGER)
    // The whole point of the register, and the thing nothing checked.
    expect(('epics' in mirror ? mirror.epics : []).filter(epic => accepted.has(epic))).toEqual(['P1-02'])
  })

  it('reports a clean register as clean, so the case above is not passing on a broken reader', () => {
    const mirror = mirrorLockedEpics(register('accept-blocked: P6-01'))
    const accepted = acceptedEpics(LEDGER)
    expect(('epics' in mirror ? mirror.epics : []).filter(epic => accepted.has(epic))).toEqual([])
  })
})

describe('an unreadable register is LOCKED, never clear', () => {
  // Each of these would, under the opposite default, report every epic
  // unlocked — the original defect reproduced mechanically and at scale.
  it('refuses when the block is absent', () => {
    expect(mirrorLockedEpics('## ACCEPTANCE LOCKS\n\nnothing machine-readable here')).toHaveProperty('unreadable')
  })

  it('refuses when the block is present but lists nothing', () => {
    // An emptied block and a block whose entries were deleted are the same
    // bytes. An empty register is stated by removing the block.
    expect(mirrorLockedEpics(register('(no locks at the moment)'))).toHaveProperty('unreadable')
  })

  it('refuses when the begin marker occurs twice, because which one is the register is undecidable', () => {
    const doubled = register('accept-blocked: P6-01') + '\n<!-- ACCEPT-BLOCKED-BEGIN\naccept-blocked: P1-02\nACCEPT-BLOCKED-END -->'
    expect(mirrorLockedEpics(doubled)).toHaveProperty('unreadable')
  })

  it('refuses when the end marker precedes the begin marker', () => {
    expect(mirrorLockedEpics('ACCEPT-BLOCKED-END\naccept-blocked: P1-02\nACCEPT-BLOCKED-BEGIN')).toHaveProperty('unreadable')
  })
})

describe('the prose scan reports and never decides', () => {
  const OPEN_ENTRY = [
    '### BLOCKED-500 — a lock stated in words',
    '',
    '**Status:** OPEN (2026-09-19). P1-02 must NOT be accepted until the library verifies anything.',
    '',
    'Body prose that also mentions P6-01 and says it stays unsigned.',
  ].join('\n')

  it('finds a lock phrase on an OPEN status line', () => {
    const claims = statusLineLockClaims(register('accept-blocked: P6-01', OPEN_ENTRY))
    expect(claims.map(claim => [claim.id, claim.epic, claim.phrase]))
      .toEqual([['BLOCKED-500', 'P1-02', 'must not be accepted']])
  })

  it('reads the STATUS LINE only, so an epic named further down is not a claim', () => {
    // `P6-01` appears in the body with `stays unsigned` beside it; the case
    // above shows the scan works, so this one is about scope rather than about
    // the scan being dead.
    const claims = statusLineLockClaims(register('accept-blocked: P6-01', OPEN_ENTRY))
    expect(claims.some(claim => claim.epic === 'P6-01')).toBe(false)
  })

  it('NEGATIVE CONTROL: a CLOSED entry carrying the same sentence is not a claim', () => {
    // The convention this protects: a closed entry keeps its original
    // sentences as the record of what was once true, and scanning it would
    // turn that record into a failure (BLOCKED-232's ruling).
    const closed = [
      '### BLOCKED-501 — the same words, settled',
      '',
      '**Status:** CLOSED (2026-09-19). P1-02 must NOT be accepted until the library verifies anything.',
    ].join('\n')
    expect(statusLineLockClaims(register('accept-blocked: P6-01', closed))).toEqual([])
  })
})
