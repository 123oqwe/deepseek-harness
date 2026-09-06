/**
 * The P9 summary line counts the goal, not half of it.
 *
 * The program's terminal condition names "every P9 item VERIFIED **or**
 * scheduled-BLOCKED on record". The summary used to count only `VERIFIED`, so
 * an item whose every stage had settled — some proved, the rest parked on a
 * recorded, still-open blocker — was reported as outstanding. The number a
 * reader takes the program's answer from would have said the terminal state was
 * further away than it is.
 */
import { describe, expect, it } from 'vitest'
import { summaryLine } from './verify-p9-cells.mjs'

const SHA = '1f51e6a3d5bda5f3a9b9a5f902f27741be0cd6b3'

describe('verify-p9-cells summary line', () => {
  it('counts a VERIFIED_OR_BLOCKED item as settled, and says how many are which', () => {
    const line = summaryLine(
      [
        { epic: 'P9-01', terminalState: 'VERIFIED' },
        { epic: 'P9-05', terminalState: 'VERIFIED_OR_BLOCKED' },
        { epic: 'P9-08', terminalState: 'PREMATURE' },
      ],
      3,
      SHA,
      'from observation',
    )
    expect(line).toContain('2/3 P9 items settled')
    // Proved and proved-unbuildable-and-parked are different facts, and a
    // reader deciding what to work on needs them apart.
    expect(line).toContain('1 fully verified, 1 verified-or-scheduled-BLOCKED')
  })

  it('says nothing about blockers when every settled item is fully verified', () => {
    const line = summaryLine(
      [{ epic: 'P9-01', terminalState: 'VERIFIED' }, { epic: 'P9-02', terminalState: 'VERIFIED' }],
      2,
      SHA,
      'on record,',
    )
    expect(line).toContain('2/2 P9 items settled')
    expect(line).not.toContain('scheduled-BLOCKED')
  })

  it('counts neither IN_PROGRESS nor PREMATURE as settled', () => {
    // The control for the case above: without it, a summary that counted every
    // item regardless of state would satisfy both.
    const line = summaryLine(
      [
        { epic: 'P9-05', terminalState: 'IN_PROGRESS' },
        { epic: 'P9-08', terminalState: 'PREMATURE' },
        { epic: 'P9-09', terminalState: 'STALE_BLOCKER' },
      ],
      3,
      SHA,
      'from observation',
    )
    expect(line).toContain('0/3 P9 items settled')
  })
})
