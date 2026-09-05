/**
 * P4-09 Provider stage: the registry that holds definitions.
 *
 * This file exists because the pre-flight freeze-target list asked where P's
 * freeze would hang and found P declares one source file and no test file at
 * all -- the same gap the list caught on P6-02.U and P4-08.P.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { computeDefinitionDigest, DefinitionRegistry } from '../src/index.ts'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { DefinitionName, RegisteredDefinition, SignerIdentity } from '../src/types.ts'

const NAME = brandString<DefinitionName>('review-changes')

function definition(body: string, overrides: Partial<RegisteredDefinition> = {}): RegisteredDefinition {
  return {
    digest: computeDefinitionDigest(body),
    name: NAME,
    version: 1,
    body,
    signer: brandString<SignerIdentity>('github:acme/workflows'),
    ...overrides,
  }
}

function refFor(definition: RegisteredDefinition) {
  return {
    runId: brandString<WorkflowRunId>('run-1'),
    digest: definition.digest,
    name: definition.name,
    version: definition.version,
  }
}

describe('P4-09 must[0]: the registry holds versioned definitions', () => {
  it('registers a first definition and resolves a run against it', () => {
    const registry = new DefinitionRegistry()
    const first = definition('v1')

    expect(registry.register(first)).toMatchObject({ registered: true })
    expect(registry.resolve(refFor(first))).toEqual({ resolved: true, definition: first })
  })

  it('does not resolve a definition that was refused', () => {
    // The store must not retain a refused registration. If it did, a run could
    // resolve a definition the registry declined to accept.
    const registry = new DefinitionRegistry()
    const bad = definition('v3', { version: 3 })

    expect(registry.register(bad)).toMatchObject({ registered: false })
    expect(registry.resolve(refFor(bad))).toEqual({ resolved: false, reason: 'unknown-digest' })
  })

  it('reports the highest version as current, not the most recently registered', () => {
    // Versions are monotonic, so "current" has a defensible answer. Without
    // that guarantee this would return whichever arrived last by wall clock.
    const registry = new DefinitionRegistry()
    const v1 = definition('v1')
    const v2 = definition('v2', { version: 2 })
    registry.register(v1)
    registry.register(v2)

    expect(registry.current(NAME)).toEqual(v2)
  })

  it('reports no current definition for an unknown name', () => {
    expect(new DefinitionRegistry().current(brandString<DefinitionName>('never-registered'))).toBeUndefined()
  })

  it('keeps a version history, oldest first', () => {
    const registry = new DefinitionRegistry()
    const v1 = definition('v1')
    const v2 = definition('v2', { version: 2 })
    registry.register(v1)
    registry.register(v2)

    expect(registry.history(NAME)).toEqual([v1, v2])
  })

  it('returns a COPY of the history, so a caller cannot mutate the store', () => {
    // A caller holding the store's own array could reorder or truncate the
    // version history, and current() would then answer from a mutated list.
    const registry = new DefinitionRegistry()
    registry.register(definition('v1'))
    const history = registry.history(NAME) as RegisteredDefinition[]
    history.length = 0

    expect(registry.history(NAME)).toHaveLength(1)
    expect(registry.current(NAME)).toBeDefined()
  })

  it('keeps names independent: registering under one does not affect another', () => {
    const registry = new DefinitionRegistry()
    const other = brandString<DefinitionName>('other-workflow')
    registry.register(definition('v1'))
    registry.register(definition('other-v1', { name: other }))

    // A shared version counter would make the second registration version 2.
    expect(registry.current(other)?.version).toBe(1)
    expect(registry.history(NAME)).toHaveLength(1)
  })
})

describe('P4-09 validation[2]: a self-recursive definition never enters the registry', () => {
  it('refuses it at registration, before it can be stored or started', () => {
    // Catching it at run time would mean the definition had already been
    // stored, shipped, and started before anyone learned it cannot terminate.
    const registry = new DefinitionRegistry()
    const recursive = definition('await workflow("review-changes")')

    expect(registry.register(recursive))
      .toMatchObject({ registered: false, reason: 'self-recursive-definition' })
    expect(registry.resolve(refFor(recursive))).toEqual({ resolved: false, reason: 'unknown-digest' })
  })

  it('admits a definition that nests a DIFFERENT workflow', () => {
    // The positive control: without it, a registry refusing every body
    // containing the word `workflow` would satisfy the case above.
    const registry = new DefinitionRegistry()
    expect(registry.register(definition('await workflow("some-other-workflow")')))
      .toMatchObject({ registered: true })
  })
})

describe('P4-09 acceptance[0]: registering executes nothing', () => {
  it('stores and resolves a definition whose body would throw if evaluated', () => {
    const registry = new DefinitionRegistry()
    const hostile = definition('process.exit(1); throw new Error("executed")')

    expect(registry.register(hostile)).toMatchObject({ registered: true })
    expect(registry.resolve(refFor(hostile))).toMatchObject({ resolved: true })
  })
})
