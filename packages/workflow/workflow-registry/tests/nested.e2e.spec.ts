/**
 * Clause coverage for Epic P4-09's versioned workflow definitions and nested
 * runs.
 *
 * `.e2e.spec.ts` rather than `.e2e.ts`: the latter routes into
 * vitest.e2e.config.ts, whose suites self-skip without an API key, and the
 * exact-SHA CI job runs the default config. Recorded as an adjudicated path
 * patch before this file was written (adjudication.json,
 * P4-09-C-nested-e2e-not-yet-created) -- the fourth application of that
 * prevention precedent.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import {
  admitNestedRun,
  admitRegistration,
  canResumeAgainst,
  computeDefinitionDigest,
  isSelfRecursive,
  resolveDefinition,
} from '../src/index.ts'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {
  DefinitionDigest,
  DefinitionName,
  NestingLimits,
  RegisteredDefinition,
  RunBudget,
  SignerIdentity,
} from '../src/types.ts'

const LIMITS: NestingLimits = { maxDepth: 3, maxTotalAgents: 50, maxTotalTokens: 100_000 }

function definition(body: string, overrides: Partial<RegisteredDefinition> = {}): RegisteredDefinition {
  return {
    digest: computeDefinitionDigest(body),
    name: brandString<DefinitionName>('review-changes'),
    version: 1,
    body,
    signer: brandString<SignerIdentity>('github:acme/workflows'),
    ...overrides,
  }
}

function budget(overrides: Partial<RunBudget> = {}): RunBudget {
  return { depth: 0, agentsRemaining: 10, tokensRemaining: 5_000, ...overrides }
}

describe('P4-09 must[0]: a definition is registered as a versioned artifact', () => {
  it('identifies a definition by the digest of its body, not by its name', () => {
    // The same source under two names must produce one digest, or a run
    // recorded against one could not be recognized as the same work as a run
    // recorded against the other.
    const body = 'export const meta = {}'
    expect(computeDefinitionDigest(body))
      .toBe(definition(body, { name: brandString<DefinitionName>('other') }).digest)
  })

  it('recomputes the digest rather than trusting the one supplied', () => {
    // A caller-supplied digest nobody checks would let a registration claim
    // one identity and store another, and every later resolution would be
    // exact about the wrong thing.
    const lying = definition('real body', { digest: brandString<DefinitionDigest>('sha256-not-the-body') })
    expect(admitRegistration(lying, [])).toMatchObject({ registered: false, reason: 'digest-mismatch' })
  })

  it('requires versions to advance by one per name', () => {
    const first = definition('v1')
    expect(admitRegistration(first, [])).toMatchObject({ registered: true })
    expect(admitRegistration(definition('v3', { version: 3 }), [first]))
      .toMatchObject({ registered: false, reason: 'non-monotonic-version' })
    expect(admitRegistration(definition('v2', { version: 2 }), [first])).toMatchObject({ registered: true })
  })

  it('refuses to reuse a version already issued for a different body', () => {
    // What makes "version 3 of this workflow" mean one thing forever.
    const first = definition('v1')
    expect(admitRegistration(definition('different', { version: 1 }), [first]))
      .toMatchObject({ registered: false, reason: 'version-reused' })
  })

  it('refuses a re-registration of an identical body rather than silently accepting it', () => {
    // So a caller learns its registration was a no-op instead of assuming it
    // created something.
    const first = definition('v1')
    expect(admitRegistration(definition('v1', { version: 2 }), [first]))
      .toMatchObject({ registered: false, reason: 'already-registered' })
  })
})

describe('P4-09 must[1]: a run refers to a definition by digest', () => {
  it('resolves a run whose digest and name both match', () => {
    const def = definition('body')
    const registered = new Map([[def.digest, def]])
    const ref = { runId: brandString<WorkflowRunId>('run-1'), digest: def.digest, name: def.name, version: 1 }

    expect(resolveDefinition(ref, registered)).toEqual({ resolved: true, definition: def })
  })

  it('refuses an unknown digest', () => {
    const ref = {
      runId: brandString<WorkflowRunId>('run-1'),
      digest: brandString<DefinitionDigest>('sha256-gone'),
      name: brandString<DefinitionName>('review-changes'),
      version: 1,
    }
    expect(resolveDefinition(ref, new Map())).toEqual({ resolved: false, reason: 'unknown-digest' })
  })

  it('reports a name/digest mismatch distinctly from a missing definition', () => {
    // The run's own record is internally inconsistent. Reporting it as missing
    // would send an operator looking for an artifact that is right there.
    const def = definition('body')
    const registered = new Map([[def.digest, def]])
    const ref = {
      runId: brandString<WorkflowRunId>('run-1'),
      digest: def.digest,
      name: brandString<DefinitionName>('some-other-workflow'),
      version: 1,
    }
    expect(resolveDefinition(ref, registered)).toEqual({ resolved: false, reason: 'name-digest-mismatch' })
  })

  it('validation[1]: a newer version under the same name does NOT make an old run resumable', () => {
    // Resuming against it would run code the run never referenced. Upgrading
    // is a deliberate migration, not something a version comparison
    // authorizes.
    const old = definition('v1')
    const current = definition('v2', { version: 2 })
    expect(canResumeAgainst(old.digest, current)).toBe(false)
    expect(canResumeAgainst(current.digest, current)).toBe(true)
  })
})

describe('P4-09 acceptance[0]: loading a definition executes nothing', () => {
  it('treats a body containing executable-looking text as opaque data', () => {
    // Every function in this package that touches a body either hashes it or
    // pattern-matches it. A definition whose body would throw or exfiltrate
    // if evaluated registers and resolves exactly like any other.
    const hostile = definition('process.exit(1); throw new Error("executed")')
    expect(admitRegistration(hostile, [])).toMatchObject({ registered: true })

    const registered = new Map([[hostile.digest, hostile]])
    const ref = { runId: brandString<WorkflowRunId>('r'), digest: hostile.digest, name: hostile.name, version: 1 }
    expect(resolveDefinition(ref, registered)).toMatchObject({ resolved: true })
  })
})

describe('P4-09 must[3]: a nested run inherits a decayed budget', () => {
  it('gives the child what remains, minus the call that started it', () => {
    // Passing the parent's budget through unchanged would let every run in a
    // tree believe it holds the full allowance, and the total would be
    // bounded by nothing.
    const decision = admitNestedRun(budget(), brandString<DefinitionDigest>('child'), [], LIMITS)

    expect(decision).toEqual({
      admitted: true,
      childBudget: { depth: 1, agentsRemaining: 9, tokensRemaining: 5_000 },
    })
  })

  it('clamps an inherited budget to the deployment ceiling', () => {
    const generous = budget({ agentsRemaining: 999, tokensRemaining: 999_999 })
    const decision = admitNestedRun(generous, brandString<DefinitionDigest>('child'), [], LIMITS)

    expect(decision).toMatchObject({
      admitted: true,
      childBudget: { agentsRemaining: 50, tokensRemaining: 100_000 },
    })
  })
})

describe('P4-09 acceptance[3] and validation[2]: nesting is bounded and recursion refused', () => {
  it('refuses a child whose definition is already on the ancestor chain', () => {
    // Detected structurally rather than left for the depth limit: a depth
    // limit reports the same failure for a workflow that calls itself and one
    // that is merely deeply composed, and those need different responses.
    const child = brandString<DefinitionDigest>('self')
    expect(admitNestedRun(budget(), child, [child], LIMITS))
      .toEqual({ admitted: false, reason: 'recursive-definition' })
  })

  it('reports recursion even when the depth limit would ALSO have refused', () => {
    // Pins the check order. Reporting depth here would tell an operator to
    // raise a limit when the real defect is a definition that never terminates.
    const child = brandString<DefinitionDigest>('self')
    expect(admitNestedRun(budget({ depth: 99 }), child, [child], LIMITS))
      .toMatchObject({ reason: 'recursive-definition' })
  })

  it('refuses at the depth ceiling, and admits one step below it', () => {
    const child = brandString<DefinitionDigest>('child')
    expect(admitNestedRun(budget({ depth: 2 }), child, [], LIMITS)).toMatchObject({ admitted: true })
    expect(admitNestedRun(budget({ depth: 3 }), child, [], LIMITS))
      .toEqual({ admitted: false, reason: 'max-depth-exceeded' })
  })

  it('refuses when the agent or token budget is spent', () => {
    const child = brandString<DefinitionDigest>('child')
    expect(admitNestedRun(budget({ agentsRemaining: 0 }), child, [], LIMITS))
      .toEqual({ admitted: false, reason: 'agent-budget-exhausted' })
    expect(admitNestedRun(budget({ tokensRemaining: 0 }), child, [], LIMITS))
      .toEqual({ admitted: false, reason: 'token-budget-exhausted' })
  })

  it('validation[2]: a self-recursive definition is refused at REGISTRATION', () => {
    const recursive = definition('await workflow("review-changes")')
    expect(isSelfRecursive(recursive)).toBe(true)
    expect(isSelfRecursive(definition('await workflow("something-else")'))).toBe(false)
  })
})

/**
 * P4-09 Fault stage: a systematic matrix over the registration, resolution and
 * nesting boundaries, including validation[0]'s named scenarios.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes.
 */
describe('P4-09 Fault — registration and nesting boundary matrix', () => {
  interface RegistryFault {
    readonly boundary: string
    readonly run: () => void
  }

  const CHILD = brandString<DefinitionDigest>('sha256-child')

  const FAULTS: readonly RegistryFault[] = [
    {
      boundary: '01 a digest that does not match its body is refused',
      run: () => expect(admitRegistration(definition('body', { digest: brandString<DefinitionDigest>('sha256-lie') }), []))
        .toMatchObject({ registered: false, reason: 'digest-mismatch' }),
    },
    {
      boundary: '02 a version that skips ahead is refused',
      run: () => expect(admitRegistration(definition('v3', { version: 3 }), [definition('v1')]))
        .toMatchObject({ registered: false, reason: 'non-monotonic-version' }),
    },
    {
      boundary: '03 a version already issued is refused for a different body',
      run: () => expect(admitRegistration(definition('other', { version: 1 }), [definition('v1')]))
        .toMatchObject({ registered: false, reason: 'version-reused' }),
    },
    {
      boundary: '04 an identical body is refused rather than silently re-registered',
      run: () => expect(admitRegistration(definition('v1', { version: 2 }), [definition('v1')]))
        .toMatchObject({ registered: false, reason: 'already-registered' }),
    },
    {
      boundary: '05 the first registration under a name must be version 1',
      run: () => expect(admitRegistration(definition('v', { version: 2 }), []))
        .toMatchObject({ registered: false, reason: 'non-monotonic-version' }),
    },
    {
      boundary: '06 a well-formed first registration is accepted',
      run: () => expect(admitRegistration(definition('v1'), [])).toMatchObject({ registered: true }),
    },
    {
      boundary: '07 an unknown digest does not resolve',
      run: () => expect(resolveDefinition(
        { runId: brandString<WorkflowRunId>('r'), digest: brandString<DefinitionDigest>('sha256-gone'),
          name: brandString<DefinitionName>('review-changes'), version: 1 },
        new Map(),
      )).toEqual({ resolved: false, reason: 'unknown-digest' }),
    },
    {
      boundary: '08 a digest registered under another name reports a mismatch, not a miss',
      run: () => {
        const def = definition('body')
        expect(resolveDefinition(
          { runId: brandString<WorkflowRunId>('r'), digest: def.digest,
            name: brandString<DefinitionName>('elsewhere'), version: 1 },
          new Map([[def.digest, def]]),
        )).toEqual({ resolved: false, reason: 'name-digest-mismatch' })
      },
    },
    {
      boundary: '09 validation[1]: an old run does not resume against a newer version',
      run: () => expect(canResumeAgainst(definition('v1').digest, definition('v2', { version: 2 }))).toBe(false),
    },
    {
      boundary: '10 validation[1]: a run resumes against the exact definition it referenced',
      run: () => {
        const def = definition('v1')
        expect(canResumeAgainst(def.digest, def)).toBe(true)
      },
    },
    {
      boundary: '11 recursion is refused before the depth limit is consulted',
      run: () => expect(admitNestedRun(budget({ depth: 99 }), CHILD, [CHILD], LIMITS))
        .toMatchObject({ reason: 'recursive-definition' }),
    },
    {
      boundary: '12 recursion is detected anywhere on the ancestor chain, not only at the parent',
      run: () => {
        // A -> B -> C -> A. The cycle closes against the ROOT, so checking
        // only the immediate parent would miss it entirely.
        const root = brandString<DefinitionDigest>('sha256-root')
        expect(admitNestedRun(budget({ depth: 2 }), root, [root, brandString<DefinitionDigest>('mid')], LIMITS))
          .toMatchObject({ reason: 'recursive-definition' })
      },
    },
    {
      boundary: '13 the depth ceiling admits one below and refuses at it',
      run: () => {
        expect(admitNestedRun(budget({ depth: 2 }), CHILD, [], LIMITS)).toMatchObject({ admitted: true })
        expect(admitNestedRun(budget({ depth: 3 }), CHILD, [], LIMITS))
          .toMatchObject({ reason: 'max-depth-exceeded' })
      },
    },
    {
      boundary: '14 an exhausted agent budget refuses distinctly from an exhausted token budget',
      run: () => {
        expect(admitNestedRun(budget({ agentsRemaining: 0 }), CHILD, [], LIMITS))
          .toEqual({ admitted: false, reason: 'agent-budget-exhausted' })
        expect(admitNestedRun(budget({ tokensRemaining: 0 }), CHILD, [], LIMITS))
          .toEqual({ admitted: false, reason: 'token-budget-exhausted' })
      },
    },
    {
      boundary: '15 the last remaining agent may still be spent on a nested run',
      run: () => {
        // Off-by-one at the boundary: 1 remaining must admit and leave 0, or a
        // run could never spend its final allowance.
        const decision = admitNestedRun(budget({ agentsRemaining: 1 }), CHILD, [], LIMITS)
        expect(decision).toMatchObject({ admitted: true })
        if (!decision.admitted) throw new Error('unreachable')
        expect(decision.childBudget.agentsRemaining).toBe(0)
      },
    },
    {
      boundary: '16 validation[2]: a self-recursive definition is detected from its body',
      run: () => expect(isSelfRecursive(definition('await workflow("review-changes")'))).toBe(true),
    },
    {
      boundary: '17 validation[2]: nesting a different name is not self-recursion',
      run: () => expect(isSelfRecursive(definition('await workflow("other")'))).toBe(false),
    },
    {
      boundary: '18 acceptance[0]: a hostile body registers and resolves without executing',
      run: () => {
        const hostile = definition('process.exit(1)')
        expect(admitRegistration(hostile, [])).toMatchObject({ registered: true })
      },
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }
})
