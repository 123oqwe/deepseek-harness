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
  it('installs a `workflow` global, and it is GATED rather than merely present', async () => {
    // Supersedes the tripwire this case used to be. That one asserted
    // `typeof workflow === 'undefined'` and said so plainly: the vacuum was
    // recorded rather than dressed up, and it was written to fail on the day
    // the hook appeared. This is that day, and the replacement asserts the
    // thing the tripwire was protecting — that the hook, once present, cannot
    // start a nested run the host did not admit.
    const refusals: string[] = []
    const execution = new WorkflowExecution(
      { name: 'gated', description: 'calls the nesting hook' },
      "try { return await workflow({ name: 'x', digest: 'deadbeef' }) } catch (error) { return 'REFUSED: ' + error.message }",
      undefined,
      { maxConcurrentAgents: 1, maxTotalAgents: 1, maxItemsPerCall: 1, syncTimeoutMs: 5_000 },
      { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} },
      {
        startAgent: () => Promise.reject(new Error('no children in this case')),
        startNested: (request) => {
          refusals.push(`${request.name}:${request.digest}`)
          return Promise.reject(new Error('unknown-digest'))
        },
      },
    )

    const result = await execution.drive()

    // The hook exists, it asked the HOST, and the host's refusal reached the
    // script as a throw rather than as a null value — a `workflow()` returning
    // undefined for "recursive definition" would be indistinguishable from one
    // whose nested run returned nothing.
    expect(refusals).toEqual(['x:deadbeef'])
    expect(result.value).toBe('REFUSED: unknown-digest')
  })

  it('REFUSES a bare name, because a name alone cannot pin the version a run used', async () => {
    // must[1]: the run references the digest. Admitting `workflow('name')`
    // would make a run reproducible only against whatever happened to be
    // registered under that name at the time.
    const execution = new WorkflowExecution(
      { name: 'bare-name', description: 'calls the hook with a bare name' },
      "try { return await workflow('just-a-name') } catch (error) { return 'REFUSED: ' + error.message }",
      undefined,
      { maxConcurrentAgents: 1, maxTotalAgents: 1, maxItemsPerCall: 1, syncTimeoutMs: 5_000 },
      { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} },
      {
        startAgent: () => Promise.reject(new Error('no children in this case')),
        startNested: () => Promise.reject(new Error('the host must not be asked')),
      },
    )

    const result = await execution.drive()
    expect(result.value).toContain('REFUSED: workflow() requires { name, digest }')
  })
})

describe('P4-05 acceptance[1] (§12.59): a waiting run holds no concurrency slot', () => {
  it('lets B start while A waits, and gives A its slot back BEFORE a new start C', async () => {
    // §12.59's frozen case at `maxConcurrentAgents: 1`. Two properties, both
    // required: releasing the slot is what lets B run at all, and resume
    // priority is what stops that release from costing A its place — queued
    // behind every new start, a run that yielded to wait could finish later
    // than one that never released, which would make releasing a pessimisation.
    //
    // The slot machinery is driven directly because the clause is about the
    // slot; going through `agent()` would test the script scheduler's timing
    // instead of the policy.
    const execution = new WorkflowExecution(
      { name: 'slots', description: 'exercises the slot policy' },
      "return 'unused'",
      undefined,
      { maxConcurrentAgents: 1, maxTotalAgents: 5, maxItemsPerCall: 10, syncTimeoutMs: 5_000 },
      { phase: () => {}, log: () => {}, agentStart: () => {}, agentEnd: () => {} },
      {
        startAgent: () => Promise.reject(new Error('no children in this case')),
        startNested: () => Promise.reject(new Error('not used')),
      },
    )
    const runtime = execution as unknown as {
      acquireSlot(priority?: 'new-start' | 'resume'): Promise<void>
      releaseSlot(): void
      whileNotConsuming<T>(body: () => Promise<T>): Promise<T>
      slotWaiters: readonly unknown[]
    }

    const order: string[] = []
    let queueC!: Promise<void>
    // An explicit barrier rather than a tick count: the body suspends on its
    // own acquire, so a test that released B's slot "a microtask later" would
    // depend on how many awaits the implementation happens to take.
    let queued!: () => void
    const cIsQueued = new Promise<void>((resolve) => { queued = resolve })

    await runtime.acquireSlot()

    const waited = runtime.whileNotConsuming(async () => {
      // Only reachable because A released: at a limit of one, this acquire
      // would never settle otherwise, and the case would time out rather than
      // report a wrong order.
      await runtime.acquireSlot()
      order.push('B:ran-while-A-waited')
      // C asks while A is still waiting, so A's resume has to overtake it.
      queueC = runtime.acquireSlot('new-start').then(() => { order.push('C:started') })
      queued()
    })

    await cIsQueued
    // Wait for the QUEUE STATE, not for a number of ticks: C is queued by the
    // body and A by `whileNotConsuming`'s own finally, which lands a microtask
    // later. Releasing between the two would hand the slot to C and prove the
    // opposite of the property under test.
    while (runtime.slotWaiters.length < 2) await Promise.resolve()

    // A is now queued for its slot back, at the head. Freeing B's slot must
    // hand it to A rather than to C.
    runtime.releaseSlot()
    await waited
    order.push('A:resumed')

    // Let C through so the case leaves nothing pending.
    runtime.releaseSlot()
    await queueC

    expect(order).toEqual(['B:ran-while-A-waited', 'A:resumed', 'C:started'])
  })
})
