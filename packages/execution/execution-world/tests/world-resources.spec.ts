/**
 * P3-10's R3: a deployment can state its worlds' resource ceilings, and the
 * registry can answer what they are without handing out a `WorldHandle`.
 *
 * **The field existed and nothing could fill it.** `WorldSpec.resources` has
 * carried `cpuMillicores`, `memoryBytes` and `diskBytes` since the Contract
 * stage, and `resolveWorldSpec` wrote `resources: {}` unconditionally: the
 * request type had no such field and the config schema validated no such key,
 * so every world in every deployment ran under no stated ceiling and a caller
 * asking for one would have been told `{}` forever. These cases are about the
 * three steps that make the answer real — a request that can carry ceilings, a
 * schema that validates them, and a binding that reports them.
 *
 * What is asserted is the BINDING, which is what a dispatch path holds. The
 * handle is never exposed and no provider's private table is read: the ceilings
 * come from the spec `bindingFor` already resolved, and the provider was
 * selected for that spec — one that could not satisfy it is refused rather than
 * allowed to weaken it.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import ExecutionWorldService, { type WorldRequest } from '../src/plugin.ts'
import { createLocalWorldProvider } from '../src/local-provider.ts'
import type { WorldId } from '../src/types.ts'

/** The file-effect boundary a real `sandboxPolicy` resolves, in ITS OWN vocabulary. */
function sandbox() {
  return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }) }
}

/** One agent, structurally, as `bindingFor` reads it. */
function agent(id: string) {
  return { id, session: { id } }
}

let minted = 0
/**
 * A fresh world id per creation, so two worlds are two worlds.
 * @returns the minted id.
 */
function ids(): WorldId {
  minted += 1
  return brandString<WorldId>(`resources-world-${String(minted)}`)
}

/**
 * Mount the registry with one real local provider over a given request.
 * @param request - the deployment's row, as a `cordis.yml` entry would carry it.
 * @returns the mounted context and its service.
 */
async function mounted(request: WorldRequest): Promise<{ ctx: Context; service: ExecutionWorldService }> {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', sandbox() as never)
  await ctx.plugin(ExecutionWorldService, { tenant: 'local-host', request })
  const service = ctx.get('executionWorlds')
  if (service === undefined) throw new Error('the registry did not mount')
  service.register(createLocalWorldProvider({ ids }))
  return { ctx, service }
}

describe('P3-10 R3: the registry answers what its worlds may use', () => {
  it('reports the ceilings this deployment configured, on the binding a dispatch path already holds', async () => {
    const { ctx, service } = await mounted({
      network: 'unrestricted',
      spawn: true,
      ipc: 'unrestricted',
      secrets: 'inherited',
      resources: { cpuMillicores: 1500, memoryBytes: 536_870_912, diskBytes: 2_147_483_648 },
    })
    try {
      const binding = await service.bindingFor(agent('agent-with-ceilings'))
      expect(binding, 'the local provider satisfies this request, so a binding must come back').toBeDefined()
      // The whole object, not a field at a time: a reader asking "how much may
      // this agent's world use" is asking for all three, and a partial answer
      // would be indistinguishable from a ceiling nobody set.
      expect(binding?.resources).toEqual({ cpuMillicores: 1500, memoryBytes: 536_870_912, diskBytes: 2_147_483_648 })
      // The handle is still not exposed: the binding names the world and the
      // provider, and carries no operating authority.
      expect(Object.keys(binding ?? {}).sort()).toEqual(['provider', 'resources', 'spec', 'world'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('answers an empty ceiling set when the deployment asked for none, rather than inventing a default', async () => {
    // The positive control, and the compatibility statement: every world before
    // this change ran with no stated ceiling, and a default here would impose a
    // limit nobody wrote on every deployment that never mentioned one.
    const { ctx, service } = await mounted({ network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited' })
    try {
      const binding = await service.bindingFor(agent('agent-without-ceilings'))
      expect(binding?.resources).toEqual({})
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses a ceiling that is not a whole positive count, at the config boundary rather than at a provider', async () => {
    // A zero or fractional ceiling is a misconfiguration, and the only place it
    // can be refused with the operator still holding the file that caused it is
    // load. Reaching a provider with it would turn "0 bytes of memory" into
    // whatever that provider decides it meant.
    const ctx = new Context()
    ctx.provide('sandboxPolicy', sandbox() as never)
    await expect(ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', resources: { memoryBytes: 0 } },
    })).rejects.toThrow()
    await ctx.fiber.dispose()
  })
})
