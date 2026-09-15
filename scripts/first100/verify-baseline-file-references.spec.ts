/**
 * Controls for verify-baseline-file-references: a `B` reference exists at the baseline, at its recorded
 * baseline path when it was renamed afterwards, or it fails.
 */
import { describe, expect, it } from 'vitest'

import { baselineReferenceFindings } from './verify-baseline-file-references.mjs'

const atBaseline = new Set(['packages/core/agent/src/inbox.ts', 'packages/demo/thing/src/here.ts'])
const exists = (path: string): boolean => atBaseline.has(path)
const registry = (files: { path: string; kind: string; baselinePath?: string }[]) => ({ epics: [{ id: 'P9-99', files }] })

describe('baselineReferenceFindings', () => {
  it('accepts a kind B file present at the baseline and reports one that is not', () => {
    const { epics, summary } = baselineReferenceFindings(registry([{ path: 'packages/demo/thing/src/here.ts', kind: 'B' }, { path: 'packages/core/agent-loop/src/inbox.ts', kind: 'B' }]), exists)
    expect(epics['P9-99']).toStrictEqual({ missingB: ['packages/core/agent-loop/src/inbox.ts'], existingN: [], okB: 1, okN: 0, pCount: 0 })
    expect(summary.totalMissingB).toBe(1)
  })

  it('checks a renamed kind B file at its baselinePath, and names both paths when that is absent too', () => {
    const renamed = { path: 'packages/core/agent-loop/src/inbox.ts', kind: 'B', baselinePath: 'packages/core/agent/src/inbox.ts' }
    expect(baselineReferenceFindings(registry([renamed]), exists).epics['P9-99']).toStrictEqual({ missingB: [], existingN: [], okB: 1, okN: 0, pCount: 0 })
    const lost = { ...renamed, baselinePath: 'packages/core/agent/src/gone.ts' }
    expect(baselineReferenceFindings(registry([lost]), exists).epics['P9-99']?.missingB)
      .toStrictEqual(['packages/core/agent-loop/src/inbox.ts (baseline path packages/core/agent/src/gone.ts)'])
  })

  it('reports an N file already at the baseline and collects an unknown kind for the caller to refuse', () => {
    const result = baselineReferenceFindings(registry([{ path: 'packages/demo/thing/src/here.ts', kind: 'N' }, { path: 'x.ts', kind: 'Z' }]), exists)
    expect(result.epics['P9-99']?.existingN).toStrictEqual(['packages/demo/thing/src/here.ts'])
    expect(result.unknownKinds).toStrictEqual([{ epic: 'P9-99', path: 'x.ts', kind: 'Z' }])
  })
})
