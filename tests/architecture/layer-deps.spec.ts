/**
 * Epic P0-04 C-stage: the six-layer package sequence and the edge/cycle
 * classification rules (`scripts/architecture/layer-order.ts`). The real
 * repo-wide scan — walking every workspace `package.json`, resolving
 * tsconfig path aliases, and finding dynamic `require()`/`import()` calls
 * — is `scripts/architecture/check-layer-deps.mjs`, a later (U-stage)
 * slice; this suite exercises the classification and cycle-search logic
 * against already-resolved fixture edges, mirroring
 * `tests/architecture/capability-seams.spec.ts` (Epic P0-03).
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLayerDepsCheck } from '../../scripts/architecture/check-layer-deps.mjs'
import {
  CORDIS_PACKAGE_NAME,
  classifyEdge,
  findShortestCycle,
  layerRank,
  LAYER_ORDER,
  validateExemptedCycle,
  type ExemptedCycle,
  type LayerDependencyEdge,
} from '../../scripts/architecture/layer-order.ts'

const KERNEL = '@deepseek-ai/dsh-trust-kernel'
const LLM_DEFINITION = '@deepseek-ai/dsh-llm'
const SHELL_DEFINITION = '@deepseek-ai/dsh-shell'
const LLM_PROVIDER = '@deepseek-ai/dsh-llm-deepseek'
const AGENT_LOOP = '@deepseek-ai/dsh-agent-loop'
const CLIENT_WEB = '@deepseek-ai/dsh-client-web'

/** One resolved edge, `nature: 'value'` and `detectionMethod: 'package-graph'` unless overridden. */
function edge(
  fields: Pick<LayerDependencyEdge, 'fromPackage' | 'fromLayer' | 'toPackage' | 'toLayer'>
    & Partial<Pick<LayerDependencyEdge, 'detectionMethod' | 'nature'>>,
): LayerDependencyEdge {
  return { detectionMethod: 'package-graph', nature: 'value', ...fields }
}

/**
 * `findShortestCycle`'s 10-second production-scale budget (acceptance[2])
 * needs a graph large enough that a naive algorithm which enumerates every
 * simple cycle -- rather than searching for the shortest one directly, e.g.
 * BFS from each package -- would plausibly blow it. An N-package complete
 * digraph (every package depends on every other) has on the order of N!
 * simple cycles through all N packages alone, before counting every shorter
 * one; `DENSE_CYCLE_PACKAGE_COUNT` packages builds in milliseconds but
 * already puts a naive enumerator far outside the budget.
 */
const DENSE_CYCLE_PACKAGE_COUNT = 14

/** A complete digraph over `DENSE_CYCLE_PACKAGE_COUNT` synthetic packages: every pair has edges both ways, so its true shortest cycle is any single pair (length 2). */
function buildDenseOverlappingCyclesFixture(): LayerDependencyEdge[] {
  const packages = Array.from(
    { length: DENSE_CYCLE_PACKAGE_COUNT },
    (_, i) => `@deepseek-ai/dsh-dense-fixture-${i}`,
  )
  const edges: LayerDependencyEdge[] = []
  for (const fromPackage of packages) {
    for (const toPackage of packages) {
      if (fromPackage === toPackage) continue
      edges.push(edge({
        fromPackage, fromLayer: 'capability-definitions',
        toPackage, toLayer: 'capability-definitions',
      }))
    }
  }
  return edges
}

/**
 * A four-package cycle whose edges (and whose first package,
 * alphabetically and by order of appearance) come first, so a naive
 * first-encountered-cycle DFS rooted at the first package would close this
 * cycle and stop before ever visiting the disjoint, later-appearing
 * two-package cycle below -- unlike `must[3]`'s existing
 * "returns the shortest cycle when a longer cycle also exists" case, whose
 * shorter cycle is both real-shortest and first-encountered, so a
 * first-found (non-shortest-path) search would accidentally pass it too.
 */
const ORDER_TRAP_LONG_A = '@deepseek-ai/dsh-cycle-long-a'
const ORDER_TRAP_LONG_B = '@deepseek-ai/dsh-cycle-long-b'
const ORDER_TRAP_LONG_C = '@deepseek-ai/dsh-cycle-long-c'
const ORDER_TRAP_LONG_D = '@deepseek-ai/dsh-cycle-long-d'
/** The disjoint, later-appearing two-package cycle that is the true shortest cycle in {@link ORDER_TRAP_GRAPH}. */
const ORDER_TRAP_SHORT_E = '@deepseek-ai/dsh-cycle-short-e'
const ORDER_TRAP_SHORT_F = '@deepseek-ai/dsh-cycle-short-f'

const ORDER_TRAP_GRAPH: LayerDependencyEdge[] = [
  // The four-package cycle: first in array order and alphabetically first,
  // so it is what a naive first-encountered-cycle DFS would close on.
  edge({ fromPackage: ORDER_TRAP_LONG_A, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_LONG_B, toLayer: 'capability-definitions' }),
  edge({ fromPackage: ORDER_TRAP_LONG_B, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_LONG_C, toLayer: 'capability-definitions' }),
  edge({ fromPackage: ORDER_TRAP_LONG_C, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_LONG_D, toLayer: 'capability-definitions' }),
  edge({ fromPackage: ORDER_TRAP_LONG_D, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_LONG_A, toLayer: 'capability-definitions' }),
  // The disjoint, later-appearing two-package cycle -- the real shortest cycle.
  edge({ fromPackage: ORDER_TRAP_SHORT_E, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_SHORT_F, toLayer: 'capability-definitions' }),
  edge({ fromPackage: ORDER_TRAP_SHORT_F, fromLayer: 'capability-definitions', toPackage: ORDER_TRAP_SHORT_E, toLayer: 'capability-definitions' }),
]

describe('LAYER_ORDER (must[0])', () => {
  it('ranks the declared kernel -> protocol/types -> capability definitions -> providers -> orchestration/runtime -> surfaces/apps sequence strictly increasing', () => {
    const ranks = LAYER_ORDER.map(layer => layerRank(layer))
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('classifyEdge — ordinary layer direction (must[0])', () => {
  it('allows a downward dependency', () => {
    const downward = edge({
      fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions',
      toPackage: KERNEL, toLayer: 'kernel',
    })
    expect(classifyEdge(downward)).toBe('ok')
  })

  it('allows a same-layer dependency', () => {
    const sameLayer = edge({
      fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions',
      toPackage: SHELL_DEFINITION, toLayer: 'capability-definitions',
    })
    expect(classifyEdge(sameLayer)).toBe('ok')
  })

  it('rejects an ordinary upward dependency as a layer violation', () => {
    const upward = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: LLM_DEFINITION, toLayer: 'capability-definitions',
    })
    expect(classifyEdge(upward)).toBe('layer-violation')
  })
})

describe('classifyEdge — narrow event-type sharing allowed (must[1])', () => {
  it('allows an upward type-only EventMap edge as the one exception to the upward-dependency rule', () => {
    const upwardEventType = edge({
      fromPackage: AGENT_LOOP, fromLayer: 'orchestration-runtime',
      toPackage: CLIENT_WEB, toLayer: 'surfaces-apps',
      nature: 'event-type-only',
    })
    expect(classifyEdge(upwardEventType)).toBe('narrow-event-type-allowed')
  })

  it('does not grant the narrow exception to a downward type-only EventMap edge, since layer direction alone already permits it', () => {
    const downwardEventType = edge({
      fromPackage: CLIENT_WEB, fromLayer: 'surfaces-apps',
      toPackage: AGENT_LOOP, toLayer: 'orchestration-runtime',
      nature: 'event-type-only',
    })
    expect(classifyEdge(downwardEventType)).toBe('ok')
  })
})

describe('classifyEdge — global-singleton bypass forbidden regardless of direction (must[1])', () => {
  it('rejects a global-singleton edge that also runs upward', () => {
    const upwardSingleton = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: LLM_DEFINITION, toLayer: 'capability-definitions',
      nature: 'global-singleton',
    })
    expect(classifyEdge(upwardSingleton)).toBe('global-singleton-violation')
  })

  it('rejects a global-singleton edge that would otherwise be a legal downward dependency', () => {
    const downwardSingleton = edge({
      fromPackage: CLIENT_WEB, fromLayer: 'surfaces-apps',
      toPackage: AGENT_LOOP, toLayer: 'orchestration-runtime',
      nature: 'global-singleton',
    })
    expect(classifyEdge(downwardSingleton)).toBe('global-singleton-violation')
  })

  it('rejects a global-singleton edge within the same layer', () => {
    const sameLayerSingleton = edge({
      fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions',
      toPackage: SHELL_DEFINITION, toLayer: 'capability-definitions',
      nature: 'global-singleton',
    })
    expect(classifyEdge(sameLayerSingleton)).toBe('global-singleton-violation')
  })
})

describe('classifyEdge — detection method never changes the verdict (must[2])', () => {
  const detectionMethods = ['package-graph', 'path-alias', 'dynamic-require'] as const

  it.each(detectionMethods)('classifies the same upward violation identically when found via %s', (detectionMethod) => {
    const upward = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: LLM_DEFINITION, toLayer: 'capability-definitions',
      detectionMethod,
    })
    expect(classifyEdge(upward)).toBe('layer-violation')
  })
})

describe('classifyEdge — kernel isolation (acceptance[1])', () => {
  it('fails a kernel dependency on the vendored Cordis runtime', () => {
    const kernelToCordis = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: CORDIS_PACKAGE_NAME, toLayer: undefined,
    })
    expect(classifyEdge(kernelToCordis)).toBe('layer-violation')
  })

  it('fails a kernel dependency on a surfaces-apps (UI) package', () => {
    const kernelToUi = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: CLIENT_WEB, toLayer: 'surfaces-apps',
    })
    expect(classifyEdge(kernelToUi)).toBe('layer-violation')
  })

  it('fails a kernel dependency on a concrete model provider', () => {
    const kernelToProvider = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: LLM_PROVIDER, toLayer: 'providers',
    })
    expect(classifyEdge(kernelToProvider)).toBe('layer-violation')
  })

  it('does not grant the narrow event-type exception to a kernel dependency on a surfaces-apps (UI) package', () => {
    const kernelToUiEventType = edge({
      fromPackage: KERNEL, fromLayer: 'kernel',
      toPackage: CLIENT_WEB, toLayer: 'surfaces-apps',
      nature: 'event-type-only',
    })
    expect(classifyEdge(kernelToUiEventType)).toBe('layer-violation')
  })

  it('does not constrain a non-kernel package depending on the vendored Cordis runtime', () => {
    const orchestrationToCordis = edge({
      fromPackage: AGENT_LOOP, fromLayer: 'orchestration-runtime',
      toPackage: CORDIS_PACKAGE_NAME, toLayer: undefined,
    })
    expect(classifyEdge(orchestrationToCordis)).toBe('ok')
  })
})

describe('validateExemptedCycle (must[3])', () => {
  const wellFormed: ExemptedCycle = {
    cycle: [LLM_DEFINITION, SHELL_DEFINITION],
    reason: 'shared narrow type re-export pending a package split (tracked)',
    owner: 'harryqiao59@gmail.com',
    adrNote: '.agents/notes/implemented/architecture/2026-08-01-example-cycle.md',
    recordedDate: '2026-08-01',
  }

  it('accepts a well-formed exemption', () => {
    expect(validateExemptedCycle(wellFormed)).toEqual([])
  })

  it('rejects an exemption whose cycle has fewer than two packages', () => {
    expect(validateExemptedCycle({ ...wellFormed, cycle: [LLM_DEFINITION] }))
      .toContain('cycle must name at least two packages')
  })

  it('rejects an exemption with a malformed recordedDate', () => {
    expect(validateExemptedCycle({ ...wellFormed, recordedDate: '08/01/2026' }))
      .toContain('recordedDate must be an ISO calendar date (YYYY-MM-DD), got "08/01/2026"')
  })

  it('rejects an exemption with an empty owner', () => {
    expect(validateExemptedCycle({ ...wellFormed, owner: '' }))
      .toContain('owner must not be empty')
  })

  it('rejects an exemption with an empty adrNote', () => {
    expect(validateExemptedCycle({ ...wellFormed, adrNote: '' }))
      .toContain('adrNote must not be empty')
  })
})

describe('findShortestCycle (must[3], acceptance[0], acceptance[2])', () => {
  it('reports no cycle and no exemption for an acyclic graph', () => {
    const acyclic = [
      edge({ fromPackage: AGENT_LOOP, fromLayer: 'orchestration-runtime', toPackage: LLM_DEFINITION, toLayer: 'capability-definitions' }),
    ]
    const result = findShortestCycle(acyclic, [])
    expect(result.shortestCycle).toBeUndefined()
    expect(result.isExempted).toBe(false)
  })

  it('finds an unexempted two-package cycle', () => {
    const twoCycle = [
      edge({ fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions', toPackage: SHELL_DEFINITION, toLayer: 'capability-definitions' }),
      edge({ fromPackage: SHELL_DEFINITION, fromLayer: 'capability-definitions', toPackage: LLM_DEFINITION, toLayer: 'capability-definitions' }),
    ]
    const result = findShortestCycle(twoCycle, [])
    expect(result.shortestCycle).toHaveLength(2)
    expect(new Set(result.shortestCycle)).toEqual(new Set([LLM_DEFINITION, SHELL_DEFINITION]))
    expect(result.isExempted).toBe(false)
  })

  it('marks a cycle exempted when it matches a declared ExemptedCycle entry', () => {
    const twoCycle = [
      edge({ fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions', toPackage: SHELL_DEFINITION, toLayer: 'capability-definitions' }),
      edge({ fromPackage: SHELL_DEFINITION, fromLayer: 'capability-definitions', toPackage: LLM_DEFINITION, toLayer: 'capability-definitions' }),
    ]
    const exemption: ExemptedCycle = {
      cycle: [LLM_DEFINITION, SHELL_DEFINITION],
      reason: 'shared narrow type re-export pending a package split (tracked)',
      owner: 'harryqiao59@gmail.com',
      adrNote: '.agents/notes/implemented/architecture/2026-08-01-example-cycle.md',
      recordedDate: '2026-08-01',
    }
    const result = findShortestCycle(twoCycle, [exemption])
    expect(result.isExempted).toBe(true)
  })

  it('returns the shortest cycle when a longer cycle also exists in the graph', () => {
    const twoAndThreeCycle = [
      // The two-package cycle.
      edge({ fromPackage: LLM_DEFINITION, fromLayer: 'capability-definitions', toPackage: SHELL_DEFINITION, toLayer: 'capability-definitions' }),
      edge({ fromPackage: SHELL_DEFINITION, fromLayer: 'capability-definitions', toPackage: LLM_DEFINITION, toLayer: 'capability-definitions' }),
      // A separate, longer three-package cycle.
      edge({ fromPackage: AGENT_LOOP, fromLayer: 'orchestration-runtime', toPackage: LLM_PROVIDER, toLayer: 'providers' }),
      edge({ fromPackage: LLM_PROVIDER, fromLayer: 'providers', toPackage: CLIENT_WEB, toLayer: 'surfaces-apps' }),
      edge({ fromPackage: CLIENT_WEB, fromLayer: 'surfaces-apps', toPackage: AGENT_LOOP, toLayer: 'orchestration-runtime' }),
    ]
    const result = findShortestCycle(twoAndThreeCycle, [])
    expect(result.shortestCycle).toHaveLength(2)
    expect(new Set(result.shortestCycle)).toEqual(new Set([LLM_DEFINITION, SHELL_DEFINITION]))
  })

  it('finds the real shortest cycle even when a longer, disjoint cycle is encountered first in construction order', () => {
    const result = findShortestCycle(ORDER_TRAP_GRAPH, [])
    expect(result.shortestCycle).toHaveLength(2)
    expect(new Set(result.shortestCycle)).toEqual(new Set([ORDER_TRAP_SHORT_E, ORDER_TRAP_SHORT_F]))
  })

  it('completes within the 10-second production-scale budget on a dense, many-overlapping-cycle graph (acceptance[2])', () => {
    const denseGraph = buildDenseOverlappingCyclesFixture()
    const startedAt = Date.now()
    const result = findShortestCycle(denseGraph, [])
    const elapsedMs = Date.now() - startedAt
    expect(elapsedMs).toBeLessThan(10_000)
    expect(result.shortestCycle).toHaveLength(2)
  })
})

describe('P0-04 Fault: the escape hatch\'s own validator (must[3], layering.md rule 5)', () => {
  // layering.md rule 5 calls the exemption store "a data store the checker
  // reads and never writes, so a gate cannot widen its own escape hatch." That
  // holds for who may write it. It does not hold for what it accepts: every
  // case below records an exemption that satisfies `validateExemptedCycle`
  // while recording nothing a reader could act on.
  //
  // DEFECT cases are green because the defect is present. The fix belongs in
  // `scripts/architecture/layer-order.ts`, which is the Contract stage's
  // declared file, not this stage's — so these are recorded, not repaired.
  const wellFormed: ExemptedCycle = {
    cycle: ['@deepseek-ai/dsh-a', '@deepseek-ai/dsh-b'],
    reason: 'a real reason',
    owner: 'a real owner',
    adrNote: '.agents/notes/implemented/architecture/2026-01-01-note.md',
    recordedDate: '2026-01-01',
  }

  it('control: a well-formed exemption validates, so the refusals below measure a decision', () => {
    expect(validateExemptedCycle(wellFormed)).toEqual([])
  })

  it('enforcement: an empty reason, owner, or adrNote is refused', () => {
    expect(validateExemptedCycle({ ...wellFormed, reason: '' })).toContain('reason must not be empty')
    expect(validateExemptedCycle({ ...wellFormed, owner: '' })).toContain('owner must not be empty')
    expect(validateExemptedCycle({ ...wellFormed, adrNote: '' })).toContain('adrNote must not be empty')
  })

  it('DEFECT: a whitespace-only reason, owner, or adrNote is accepted, so an exemption can record nothing while passing', () => {
    // `entry.reason === ''` tests one exact value. A single space defeats it,
    // and the resulting entry suppresses a real cycle with no stated reason,
    // no reachable owner, and no note to read.
    expect(validateExemptedCycle({ ...wellFormed, reason: '   ' })).toEqual([])
    expect(validateExemptedCycle({ ...wellFormed, owner: '\t' })).toEqual([])
    expect(validateExemptedCycle({ ...wellFormed, adrNote: ' ' })).toEqual([])
  })

  it('DEFECT: a cycle naming one package twice is accepted as a two-package cycle', () => {
    // `cycle.length < 2` counts entries, not distinct packages, so a
    // degenerate self-edge satisfies the check that exists to require a real
    // cycle between real packages.
    expect(validateExemptedCycle({ ...wellFormed, cycle: ['@deepseek-ai/dsh-a', '@deepseek-ai/dsh-a'] })).toEqual([])
  })

  it('DEFECT: adrNote is documented as a repo-relative path to an Agent Note, and any non-empty string passes', () => {
    // Nothing checks the shape of the path, and nothing checks the note
    // exists — so the ADR requirement must[3] states is satisfied by prose.
    expect(validateExemptedCycle({ ...wellFormed, adrNote: 'we talked about it' })).toEqual([])
  })

  it('DEFECT: an impossible calendar date validates, because Date.parse rolls it over', () => {
    // 2026-02-31 matches the ISO shape and `Date.parse` returns a number for
    // it (rolling to March 3) rather than NaN, so the NaN guard never fires.
    expect(validateExemptedCycle({ ...wellFormed, recordedDate: '2026-02-31' })).toEqual([])
  })

  it('enforcement: a malformed date shape is still refused', () => {
    expect(validateExemptedCycle({ ...wellFormed, recordedDate: 'last Tuesday' }).join(' ')).toContain('ISO calendar date')
  })
})

describe('P0-04 Fault: classifyEdge refuses the kernel every way an exception could be claimed', () => {
  it('enforcement: a kernel upward edge is a violation even when it is the narrow event-type kind', () => {
    // acceptance[1] grants the kernel no exception. This is the one place the
    // must[1] allowance must NOT apply, so it is asserted rather than assumed.
    const edge: LayerDependencyEdge = {
      fromPackage: KERNEL,
      toPackage: AGENT_LOOP,
      fromLayer: 'kernel',
      toLayer: 'orchestration-runtime',
      detectionMethod: 'package-graph',
      nature: 'event-type-only',
    }
    expect(classifyEdge(edge)).toBe('layer-violation')
  })

  it('control: the same narrow event-type edge from a non-kernel layer IS allowed, proving the case above measures the kernel rule', () => {
    const edge: LayerDependencyEdge = {
      fromPackage: LLM_DEFINITION,
      toPackage: AGENT_LOOP,
      fromLayer: 'capability-definitions',
      toLayer: 'orchestration-runtime',
      detectionMethod: 'package-graph',
      nature: 'event-type-only',
    }
    expect(classifyEdge(edge)).toBe('narrow-event-type-allowed')
  })

  it('enforcement: a global-singleton edge outranks every other consideration, including a downward direction', () => {
    const edge: LayerDependencyEdge = {
      fromPackage: CLIENT_WEB,
      toPackage: LLM_DEFINITION,
      fromLayer: 'surfaces-apps',
      toLayer: 'capability-definitions',
      detectionMethod: 'package-graph',
      nature: 'global-singleton',
    }
    expect(classifyEdge(edge)).toBe('global-singleton-violation')
  })
})

describe('P0-04 Fault: calibrating the real-repository verdict before trusting its zero', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  // The Usage stage asserts the real repository reports zero violations. A
  // verdict that is always zero and a verdict that is broken produce the same
  // report, so that assertion carries no weight until something shows the
  // machinery actually ran against real input and could have reported more.
  // These cases are that calibration, applied to the real scan rather than to
  // a fixture: a fixture proves the code path exists, not that it engages with
  // this repository.

  it('calibration: the real scan reaches real input — hundreds of packages, thousands of edges', () => {
    const result = runLayerDepsCheck(root)
    expect(result.scanned.packages).toBeGreaterThan(200)
    expect(result.scanned.edges).toBeGreaterThan(1000)
    expect(result.unclassified).toEqual([])
  })

  it('calibration: the reporting path is live on real input, so an empty violations list is a measurement and not a dead path', () => {
    const result = runLayerDepsCheck(root)
    // `findings` and `violations` are produced by the same edge walk and the
    // same classification; only the verdict differs. A non-empty findings list
    // therefore proves the walk ran, classified real edges, and populated its
    // output — which is exactly what a zero violations count cannot show on
    // its own.
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.violations).toEqual([])
  })

  it('calibration: the same entry point reports a violation when one exists, so zero distinguishes this repository from a broken check', () => {
    // Same function, same code path, different root. Without this, the case
    // above cannot tell "this repository is clean" from "this function never
    // reports anything".
    const fixture = join(root, 'tests/architecture/__fixtures__/p0-04-calibration')
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.length).toBeGreaterThan(0)
  })
})

describe('P0-04 Fault: rule 8, the spawn-target exception, and the condition that closes it', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  it('the real spawn-target edge is admitted: dsh-sdk-client resolves dsh to spawn it and imports none of its symbols', () => {
    // This edge is real and cannot be removed: `import.meta.resolve` fails
    // without the declaration. Rule 8 admits it because no symbol crosses.
    const result = runLayerDepsCheck(root)
    expect(result.violations.map(v => v.rule)).not.toContain('composition-root-inbound-dependency')
  })

  it('control: the exception is withdrawn the moment a symbol is imported, so condition (i) is a criterion and not a declaration', () => {
    // The whole safety of rule 8 rests on "zero imported bindings". A rule
    // stated but never shown to close is indistinguishable from a name-based
    // exemption list. This builds a fixture whose ranked package BOTH declares
    // the unranked dependency AND imports a symbol from it, and requires the
    // violation to come back.
    const fixture = join(root, 'tests/architecture/__fixtures__/p0-04-spawn-and-import')
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.map(v => v.rule)).toContain('composition-root-inbound-dependency')
  })

  it('control: the same fixture WITHOUT the symbol import is admitted, isolating the import as the deciding fact', () => {
    // Identical package graph and identical declaration; the only difference is
    // whether a symbol is imported. Without this pair, the case above could be
    // passing for any other reason the fixture happens to carry.
    const fixture = join(root, 'tests/architecture/__fixtures__/p0-04-spawn-only')
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.map(v => v.rule)).not.toContain('composition-root-inbound-dependency')
  })
})
