/**
 * Controls for the whole-suite uniqueness of live frozen case strings (BLOCKED-104).
 *
 * Fixtures 1, 3 and 4 make the gate non-vacuous: 1 shows it can go red, 3
 * that rename resolution is live, 4 that a retired rename resolves nothing.
 */
import { describe, expect, it } from 'vitest'

import { argvTargets, classifyFrozenCaseMatches, reportRefusal, uncoveredArgvTargets } from './verify-freeze-case-uniqueness.mjs'

const BARE = 'enumerates at least twelve boundaries, each named once'
const FULL = `P2-04 Fault — risk classification boundary matrix ${BARE}`
const P0_05_OLD = 'has exactly one statement: a type-only `export type * from \'./types.ts\'`'
const P0_05_NEW = 'keeps `export type * from \'./types.ts\'` as its first statement'
const P4_08_OLD = 'leaves an unverified or side-effecting step untouched'
const P4_08_NEW = 'leaves an UNVERIFIED step untouched, whether or not it completed'

const entry = (fields: Record<string, unknown>) => ({ epic: 'P2-04', stage: 'C', argv: ['pnpm', 'exec', 'vitest', 'run'], ...fields })

describe('classifyFrozenCaseMatches', () => {
  it('(1) reports a bare title that names eight passing cases as resolving to 8', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [BARE] })], new Map([[BARE, 8]]), new Map())
    expect(rows).toStrictEqual([{ label: 'P2-04.C', title: BARE, raw: 8, resolved: 8, via: null }])
  })

  it('(2) reports the same case frozen by fullName as resolving to 1', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [FULL] })], new Map([[BARE, 8], [FULL, 1]]), new Map())
    expect(rows.map(row => row.resolved)).toStrictEqual([1])
  })

  it('(3) resolves a title with no passing match through the rename registered for its cell', () => {
    const renames = new Map([[`P0-05|C|${P0_05_OLD}`, P0_05_NEW]])
    const rows = classifyFrozenCaseMatches([entry({ epic: 'P0-05', expectCases: [P0_05_OLD] })], new Map([[P0_05_NEW, 1]]), renames)
    expect(rows).toStrictEqual([{ label: 'P0-05.C', title: P0_05_OLD, raw: 0, resolved: 1, via: `rename:${P0_05_NEW}` }])
  })

  it('(4) resolves nothing through a retired rename, which the renames map does not carry', () => {
    const rows = classifyFrozenCaseMatches([entry({ epic: 'P4-08', expectCases: [P4_08_OLD] })], new Map([[P4_08_NEW, 1]]), new Map())
    expect(rows).toStrictEqual([{ label: 'P4-08.C', title: P4_08_OLD, raw: 0, resolved: 0, via: null }])
  })

  it('(5) reports a string matching no case as resolving to 0, not as ambiguous', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: ['no such case'] })], new Map(), new Map())
    expect(rows.map(row => row.resolved)).toStrictEqual([0])
  })

  it('(6) produces no row for a superseded entry', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [BARE], supersededBy: '2026-09-15T08:16:00Z' })], new Map([[BARE, 8]]), new Map())
    expect(rows).toStrictEqual([])
  })

  it('(7) addresses a supplement entry by its sequence', () => {
    const rows = classifyFrozenCaseMatches([entry({ supplementSeq: 1, expectCases: [FULL] })], new Map([[FULL, 1]]), new Map())
    expect(rows.map(row => row.label)).toStrictEqual(['P2-04.C.1'])
  })
})

describe('whole-suite refusal', () => {
  it('drops flags and the -t pattern from a frozen argv', () => {
    expect(argvTargets(['pnpm', 'exec', 'vitest', 'run', 'packages/a', '-t', 'some name', '--reporter=json', 'packages/b/x.spec.ts']))
      .toStrictEqual(['packages/a', 'packages/b/x.spec.ts'])
  })

  it('(8) names a live argv target that no report file lies at or under', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/policy/risk-taxonomy', 'packages/mcp/mcp-client/tests/annotations.spec.ts'] })]
    const files = ['/home/runner/work/deepseek-harness/deepseek-harness/packages/policy/risk-taxonomy/tests/classify.spec.ts']
    expect(uncoveredArgvTargets(entries, files)).toStrictEqual([{ label: 'P2-04.C', target: 'packages/mcp/mcp-client/tests/annotations.spec.ts' }])
  })

  it('(9) refuses a report carrying a failure the flake registry does not hold, and accepts a registered one', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/a'] })]
    const files = ['/r/packages/a/tests/x.spec.ts']
    const registry = { entries: [{ testFullName: 'a registered flake' }] }
    expect(reportRefusal(new Set(['an unexplained failure']), files, entries, registry)).toContain('1 failed case(s) not in the flake registry')
    expect(reportRefusal(new Set(['a registered flake']), files, entries, registry)).toBeNull()
  })

  it('accepts a clean report, which the flake check itself reports as valid: false', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/a'] })]
    expect(reportRefusal(new Set(), ['/r/packages/a/tests/x.spec.ts'], entries, { entries: [] })).toBeNull()
  })

  it('does not match a target against a file that only shares its name as a prefix', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/run/task'] })]
    expect(uncoveredArgvTargets(entries, ['/r/packages/run/task-profile/tests/a.spec.ts'])).toHaveLength(1)
  })
})
