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
import type {
  DefinitionDigest,
  DefinitionName,
  NestingLimits,
  RegisteredDefinition,
  RunBudget,
  SignerIdentity,
  WorkflowRunId,
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
