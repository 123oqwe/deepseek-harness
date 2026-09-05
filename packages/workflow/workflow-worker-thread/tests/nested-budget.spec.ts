/**
 * P4-09 Usage stage: a nested run's worker limits derive from its parent.
 *
 * This file lives in workflow-worker-thread rather than the registry package
 * because U's subject is the nested-run wiring -- a placement the pre-flight
 * freeze-target list produced, as it did for P4-08.U.
 *
 * WHAT IS NOT HERE, stated rather than left to be discovered: `runtime.ts` has
 * no nested `workflow()` hook. Nesting is not implemented in the worker, so
 * these cases compose the decision with the worker's REAL limit type
 * (`WorkerLimits`) without a call site to attach to. That gap is recorded in
 * the U freeze note.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  applyChildFailure,
  cancelPropagationForNested,
  planNestedRun,
} from '@deepseek-ai/dsh-workflow-registry'
import type { DefinitionDigest, NestingLimits, RunBudget } from '@deepseek-ai/dsh-workflow-registry'
import { WorkflowExecution } from '../src/runtime.ts'
import type { WorkerLimits } from '../src/types.ts'

const LIMITS: NestingLimits = { maxDepth: 3, maxTotalAgents: 50, maxTotalTokens: 100_000 }
const CHILD = brandString<DefinitionDigest>('sha256-child')

function parentWorkerLimits(overrides: Partial<WorkerLimits> = {}): WorkerLimits {
  return { maxConcurrentAgents: 4, maxTotalAgents: 20, maxItemsPerCall: 100, syncTimeoutMs: 5_000, ...overrides }
}

function budget(overrides: Partial<RunBudget> = {}): RunBudget {
  return { depth: 0, agentsRemaining: 10, tokensRemaining: 5_000, ...overrides }
}

describe('P4-09 must[3]: a nested run inherits decayed limits', () => {
  it('caps the child at its decayed agent budget, not at the deployment ceiling', () => {
    // Spawning with the ceiling would let a tree of nested runs each start a
    // full allowance, and the total would exceed every limit meant to bound it.
    const plan = planNestedRun(budget(), CHILD, [], LIMITS, parentWorkerLimits())

    expect(plan).toMatchObject({ admitted: true })
    if (!plan.admitted) throw new Error('unreachable')
    expect(plan.workerLimits.maxTotalAgents).toBe(9)
    expect(plan.budget).toEqual({ depth: 1, agentsRemaining: 9, tokensRemaining: 5_000 })
  })

  it('never raises the child above the parent worker\'s own total', () => {
    const generous = budget({ agentsRemaining: 999 })
    const plan = planNestedRun(generous, CHILD, [], LIMITS, parentWorkerLimits({ maxTotalAgents: 6 }))

    if (!plan.admitted) throw new Error('unreachable')
    expect(plan.workerLimits.maxTotalAgents).toBe(6)
  })

  it('inherits concurrency unchanged rather than dividing it', () => {
    // Concurrency bounds how much runs AT ONCE, not how much runs in total. A
    // child allowed fewer agents overall is not thereby entitled to less
    // parallelism among them.
    const plan = planNestedRun(budget(), CHILD, [], LIMITS, parentWorkerLimits({ maxConcurrentAgents: 4 }))

    if (!plan.admitted) throw new Error('unreachable')
    expect(plan.workerLimits.maxConcurrentAgents).toBe(4)
  })

  it('refuses to plan a run it would not admit, so limits cannot be derived without admission', () => {
    // The only way to obtain child limits is to have been admitted, so a
    // caller cannot spawn a refused run with plausible-looking limits.
    expect(planNestedRun(budget(), CHILD, [CHILD], LIMITS, parentWorkerLimits()))
      .toEqual({ admitted: false, reason: 'recursive-definition' })
    expect(planNestedRun(budget({ depth: 3 }), CHILD, [], LIMITS, parentWorkerLimits()))
      .toEqual({ admitted: false, reason: 'max-depth-exceeded' })
  })
})

describe('P4-09 acceptance[1]: a parent\'s cancellation reaches its nested child', () => {
  it('propagates to the child', () => {
    // A child that outlived a cancelled parent would keep spending an
    // allowance nobody is watching, and no later accounting could attribute it.
    expect(cancelPropagationForNested()).toBe('cancel-child')
  })
})

describe('P4-09 acceptance[2]: a child failure is handled by its declared policy', () => {
  it('fails the parent when the policy says so', () => {
    expect(applyChildFailure('fail-parent')).toEqual({ parentContinues: false })
  })

  it('continues the parent but still RECORDS the failure', () => {
    // A parent reporting success while a declared child failed silently is the
    // outcome this clause exists to prevent: an ignored failure is
    // indistinguishable from work that never ran.
    expect(applyChildFailure('continue-parent')).toEqual({ parentContinues: true, recordedFailure: true })
  })
})

describe('P4-09 must[3]: the nesting vacuum is pinned, not merely noted', () => {
  /**
   * A tripwire, not a feature test.
   *
   * `runtime.ts` installs exactly `agent`, `parallel`, `pipeline`, `phase`,
   * `log` and `args` as script globals. A script therefore cannot start a
   * nested workflow at all, which is why must[3] has nothing to violate
   * today -- and why the decayed-budget and recursion logic above, though
   * real and covered, is wired to nothing.
   *
   * A note saying so would be prose that no gate reads. The moment someone
   * adds `workflow:` beside those five hooks -- one line, in an obvious place
   * -- must[3] becomes live, while this epic is long since accepted and green
   * and nothing would send anyone back to it. **The danger is created by the
   * logic being good**: a future reader finds tested machinery for budget
   * decay and recursion and reasonably assumes it is connected.
   *
   * So the vacuum is asserted. This case fails on the day the hook appears,
   * and whoever adds it must confront must[3] then rather than inherit a
   * silent gap.
   */
  it('TRIPWIRE: a script has no `workflow` global, so nesting cannot be started', async () => {
    const observed: string[] = []
    const execution = new WorkflowExecution(
      { name: 'tripwire', description: 'observes the installed globals' },
      'return typeof workflow',
      undefined,
      { maxConcurrentAgents: 1, maxTotalAgents: 1, maxItemsPerCall: 1, syncTimeoutMs: 5_000 },
      {
        phase: () => {},
        log: message => void observed.push(message),
        agentStart: () => {},
        agentEnd: () => {},
      },
      { startAgent: () => Promise.reject(new Error('no children in this tripwire')) },
    )

    const result = await execution.drive()

    // 'function' means someone installed a nesting hook. When that happens,
    // P4-09 must[3] stops being vacuous and this epic's nested-budget logic
    // must actually be wired to it -- see the U-stage freeze note.
    expect(result.value).toBe('undefined')
    expect(result.stopReason).toBe('completed')
  })
})
