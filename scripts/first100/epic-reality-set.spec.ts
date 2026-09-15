/**
 * Controls for the reality set: declarations read through the deliverable-path patches only ever add paths.
 */
import { describe, expect, it } from 'vitest'

import { realitySet } from './epic-reality-set.mjs'

const declared = 'packages/demo/thing/tests/declared.e2e.ts'
const approved = 'packages/demo/thing/tests/declared.e2e.spec.ts'
const epic = { id: 'P9-99', files: [{ path: 'packages/demo/thing/src/declared.ts' }], stages: { C: { files: [declared] } } }
const patches = [{ epic: 'P9-99', stage: 'C', declaredPath: declared, approvedPath: approved }]

describe('realitySet', () => {
  it('adds the path a patch approves and keeps the declared one', () => {
    const paths = realitySet(epic, [], patches)
    expect(paths).toContain(declared)
    expect(paths).toContain(approved)
  })

  it('is the declaration plus the live freeze files of the same epic', () => {
    const freeze = [
      { epic: 'P9-99', files: ['packages/demo/thing/src/live.ts'] },
      { epic: 'P9-99', files: ['packages/demo/thing/src/replaced.ts'], supersededBy: 'P9-99.C.2' },
      { epic: 'P9-98', files: ['packages/other/thing/src/elsewhere.ts'] },
    ]
    expect(realitySet(epic, freeze, [])).toStrictEqual(['packages/demo/thing/src/declared.ts', declared, 'packages/demo/thing/src/live.ts'])
  })
})
