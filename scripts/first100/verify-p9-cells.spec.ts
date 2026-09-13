/**
 * The P9 verifier's three decisions: what the summary counts, which recorded
 * cells have gone stale, and how a frozen title is matched.
 *
 * The summary counts the goal, not half of it. The program's terminal
 * condition names "every P9 item VERIFIED **or** scheduled-BLOCKED on record".
 * The summary used to count only `VERIFIED`, so an item whose every stage had
 * settled — some proved, the rest parked on a recorded, still-open blocker — was
 * reported as outstanding.
 *
 * A record goes stale. `--check` used to re-read the record and nothing else,
 * so a cell stayed VERIFIED after the files it observed changed and no gate
 * failed. The staleness decision is pure over an injected repository, so these
 * cases need no git history.
 *
 * Titles match the way the ledger matches them: through the rename register,
 * and never on a frozen string that names more than one passing case.
 */
import { describe, expect, it } from 'vitest'
import { referencedPaths, staleCells, summaryLine, verifyCells } from './verify-p9-cells.mjs'
import type { P9Cell, P9Freeze, P9FreezeEntry, P9Git } from './verify-p9-cells.mjs'

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

/**
 * A freeze entry for P9-01 whose command runs one spec and names one source file.
 * @param stage - the stage.
 * @param cases - the frozen titles.
 * @param source - the source file the entry names.
 * @returns the entry.
 */
function entry(stage: string, cases: readonly string[], source = 'packages/x/src/x.ts'): P9FreezeEntry {
  return {
    epic: 'P9-01',
    stage,
    argv: ['pnpm', 'exec', 'vitest', 'run', `packages/x/tests/${stage}.spec.ts`, '--reporter=json'],
    expectCases: cases,
    files: [source],
  }
}

const FREEZE: P9Freeze = {
  entries: [entry('C', ['c'], 'packages/x/src/c.ts'), entry('P', ['p']), entry('U', ['u']), entry('F', ['f'])],
}

const VERIFIED_RECORD = {
  candidateSha: SHA,
  cells: ['C', 'P', 'U', 'F'].map((stage): P9Cell => ({ epic: 'P9-01', stage, status: 'VERIFIED' })),
}

/**
 * A repository whose recorded candidate carries `FREEZE` and in which nothing changed.
 * @param over - the reads a case replaces.
 * @returns the repository.
 */
function repository(over: Partial<P9Git> = {}): P9Git {
  return { freezeAt: () => FREEZE.entries, changedPaths: () => [], ...over }
}

describe('verify-p9-cells --check: a recorded cell that no longer describes the tree is stale', () => {
  it('reports nothing when the candidate carries the same freeze entries and none of their files changed', () => {
    // The control: without it, a check that reported every cell would pass the
    // cases below.
    expect(staleCells(VERIFIED_RECORD, FREEZE, repository())).toEqual([])
  })

  it('reports the cell whose named file changed since the recorded observation, and names the file', () => {
    const stale = staleCells(VERIFIED_RECORD, FREEZE, repository({
      changedPaths: (_sha, paths) => paths.filter(path => path === 'packages/x/src/c.ts'),
    }))
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({ epic: 'P9-01', stage: 'C' })
    expect(stale[0]!.reason).toContain('packages/x/src/c.ts')
  })

  it('compares the test paths the command runs as well as the declared files, and never a flag', () => {
    expect(referencedPaths(entry('P', ['p']))).toEqual(['packages/x/src/x.ts', 'packages/x/tests/P.spec.ts'])
    const stale = staleCells(VERIFIED_RECORD, FREEZE, repository({
      changedPaths: (_sha, paths) => paths.filter(path => path === 'packages/x/tests/U.spec.ts'),
    }))
    expect(stale.map(cell => cell.stage)).toEqual(['U'])
  })

  it('reports a cell whose freeze entry was written or changed after the recorded observation', () => {
    const recorded = FREEZE.entries.map(frozen => (frozen.stage === 'F' ? { ...frozen, expectCases: ['f-before'] } : frozen))
    const stale = staleCells(VERIFIED_RECORD, FREEZE, repository({ freezeAt: () => recorded }))
    expect(stale.map(cell => cell.stage)).toEqual(['F'])
    expect(stale[0]!.reason).toContain('after the recorded observation')
  })

  it('reports every VERIFIED cell when the recorded candidate cannot be read, never a pass', () => {
    const stale = staleCells(VERIFIED_RECORD, FREEZE, repository({ freezeAt: () => undefined }))
    expect(stale.map(cell => cell.stage)).toEqual(['C', 'P', 'U', 'F'])
  })

  it('reports a cell whose files could not be compared, rather than treating a failed comparison as unchanged', () => {
    const stale = staleCells(VERIFIED_RECORD, FREEZE, repository({ changedPaths: () => undefined }))
    expect(stale).toHaveLength(4)
  })

  it('ignores a cell that was never VERIFIED, since only a verified claim can go stale', () => {
    const record = { candidateSha: SHA, cells: [{ epic: 'P9-01', stage: 'C', status: 'SCHEDULED_BLOCKED' }] }
    expect(staleCells(record, FREEZE, repository({ changedPaths: (_sha, paths) => [...paths] }))).toEqual([])
  })
})

/**
 * The cell verifyCells produces for P9-01's C stage.
 * @param passing - titles observed passing.
 * @param matching - the matching rules for the call.
 * @returns the cell.
 */
function contractCell(passing: readonly string[], matching?: Parameters<typeof verifyCells>[5]): P9Cell {
  const freeze: P9Freeze = { entries: [entry('C', ['c'])] }
  const cells = verifyCells(freeze, new Set(passing), ['P9-01'], undefined, [], matching)
  return cells.find(cell => cell.stage === 'C')!
}

describe('verify-p9-cells matching: a frozen title is matched the way the ledger matches it', () => {
  it('refuses to verify a cell whose frozen title names two passing cases', () => {
    const cell = contractCell(['c'], { matchCounts: new Map([['c', 2]]) })
    expect(cell.status).toBe('AMBIGUOUS')
    expect(cell.ambiguousCases).toEqual([{ title: 'c', count: 2 }])
  })

  it('verifies the same cell when its title names exactly one passing case', () => {
    // The control: the refusal above is about the count, not about counting.
    expect(contractCell(['c'], { matchCounts: new Map([['c', 1]]) }).status).toBe('VERIFIED')
  })

  it('verifies a cell whose frozen title was renamed, through the registered rename', () => {
    expect(contractCell(['c renamed'], { renames: new Map([['P9-01|C|c', 'c renamed']]) }).status).toBe('VERIFIED')
    // Without the register the renamed case is simply missing.
    expect(contractCell(['c renamed']).status).toBe('INCOMPLETE')
  })

  it('matches exactly as before when no rename is registered and no counts are given', () => {
    expect(contractCell(['c']).status).toBe('VERIFIED')
    expect(contractCell([])).toMatchObject({ status: 'INCOMPLETE', missingCases: ['c'] })
  })
})
