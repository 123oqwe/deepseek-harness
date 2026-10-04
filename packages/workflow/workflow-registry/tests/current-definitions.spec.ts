/**
 * B-729: the registry lists every name's current definition, which is what a
 * nested run can name.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it } from 'vitest'
import { computeDefinitionDigest, DefinitionRegistry } from '../src/index.ts'
import type { DefinitionName, RegisteredDefinition, SignerIdentity } from '../src/types.ts'

/**
 * A definition under one name and version.
 * @param name - the definition's name.
 * @param body - its script body.
 * @param version - its version.
 * @returns the definition, with the digest of its body.
 */
function definition(name: string, body: string, version: number): RegisteredDefinition {
  return {
    digest: computeDefinitionDigest(body),
    name: brandString<DefinitionName>(name),
    version,
    body,
    signer: brandString<SignerIdentity>('github:acme/workflows'),
  }
}

describe('B-729: the registry lists the current definitions', () => {
  it('lists each name once, at its highest version, in the order the names were first registered', () => {
    const registry = new DefinitionRegistry()
    const alpha1 = definition('alpha', 'return 1', 1)
    const beta = definition('beta', 'return 2', 1)
    const alpha2 = definition('alpha', 'return 3', 2)
    for (const entry of [alpha1, beta, alpha2]) expect(registry.register(entry)).toMatchObject({ registered: true })

    expect(registry.currentDefinitions()).toEqual([alpha2, beta])
  })

  it('lists nothing before anything is registered', () => {
    expect(new DefinitionRegistry().currentDefinitions()).toEqual([])
  })
})
