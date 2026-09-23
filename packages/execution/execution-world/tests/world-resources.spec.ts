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
 * four steps that make the answer real — a request that can carry ceilings, a
 * schema that validates them, a binding that reports them, and a provider that
 * REFUSES a ceiling it cannot enforce.
 *
 * **That last one is the guard this slice woke up.** `localUnsatisfiableDimensions`
 * has always declared `resources` unsatisfiable whenever any of the three is set
 * (`local-provider.ts:115-117`), and while `spec.resources` was `{}` on every
 * path the check had no input it could ever refuse. Which is also why the
 * ceiling-carrying case binds through the FAKE provider: the local one is RIGHT
 * to refuse, and asking it for a world with a ceiling is asking for exactly what
 * acceptance[1] forbids.
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
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import ExecutionWorldService, { digestWorldSpec, type WorldRequest } from '../src/plugin.ts'
import { createLocalWorldProvider } from '../src/local-provider.ts'
import type { WorldId } from '../src/types.ts'
import { createFakeWorldProvider } from './fake-provider.ts'

/** The tenant this host's worlds belong to; the provider refuses any other. */
const HOST_TENANT = brandString<TenantId>('local-host')

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
 * @param provider - which provider to register; `fake` satisfies every dimension.
 * @returns the mounted context and its service.
 */
async function mounted(
  request: WorldRequest,
  provider: 'local' | 'fake' = 'local',
): Promise<{ ctx: Context; service: ExecutionWorldService }> {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', sandbox() as never)
  await ctx.plugin(ExecutionWorldService, { tenant: 'local-host', request })
  const service = ctx.get('executionWorlds')
  if (service === undefined) throw new Error('the registry did not mount')
  // The provider's four options in full, the same shape `registry.spec.ts:92`
  // registers. An incomplete literal leaves `tenant` undefined, the provider
  // then reports `['tenant']` unsatisfiable against a spec whose tenant IS
  // `local-host`, and `bindingFor` returns `undefined` at `plugin.ts:308` --
  // the refusal branch, not the `create` catch below it. That reads exactly
  // like "the provider cannot satisfy this request", which is what these cases
  // are about, so the harness would have been indistinguishable from the
  // product being wrong.
  if (provider === 'local') {
    service.register(createLocalWorldProvider({
      tenant: HOST_TENANT,
      digest: digestWorldSpec,
      nextWorldId: ids,
      nowMs: () => 0,
    }))
  } else {
    // A provider that satisfies every dimension, which is the only way to see a
    // binding CARRY a ceiling: the local one refuses any world that states one
    // (`local-provider.ts:115-117`), deliberately and correctly -- it cannot
    // enforce cpu, memory or disk, and acceptance[1] forbids handing back a
    // weaker world than the one asked for.
    // `createFakeWorldProvider` returns CONTROLS, not the provider: the
    // settle hooks live beside it, so the provider is destructured out the
    // way `registry.spec.ts:115` does. Registering the controls object
    // itself fails at `lifecycle.ts:120` with `unsatisfiableDimensions is
    // not a function`.
    const { provider: fake } = createFakeWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids })
    service.register(fake)
  }
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
    }, 'fake')
    try {
      const binding = await service.bindingFor(agent('agent-with-ceilings'))
      expect(binding, 'a provider that satisfies every dimension must return a binding for this request').toBeDefined()
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

  it('REFUSES a world whose ceilings the provider cannot enforce, rather than handing back an unlimited one', async () => {
    // acceptance[1]'s own content, and its first reachable input. The local
    // provider has always declared `resources` unsatisfiable whenever any of
    // the three is set (`local-provider.ts:115-117`) -- but until a request
    // could carry them, `spec.resources` was `{}` on every path and that check
    // could never fire. R3 did not change the provider; it gave this guard
    // something to refuse.
    //
    // The alternative is the one the clause forbids: a world with no ceiling
    // handed to a deployment that asked for one, which looks identical to a
    // ceiling that is being honoured.
    const { ctx, service } = await mounted({
      network: 'unrestricted',
      spawn: true,
      ipc: 'unrestricted',
      secrets: 'inherited',
      resources: { memoryBytes: 536_870_912 },
    })
    try {
      expect(await service.bindingFor(agent('agent-the-local-provider-must-refuse')), 'a ceiling this provider cannot enforce must produce NO world, not an unlimited one')
        .toBeUndefined()
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
  it('reports the process ceiling this deployment configured, as its own field beside the resource ceilings', async () => {
    const { ctx, service } = await mounted({
      network: 'unrestricted',
      spawn: true,
      ipc: 'unrestricted',
      secrets: 'inherited',
      maxProcesses: 32,
      resources: { memoryBytes: 536_870_912 },
    }, 'fake')
    try {
      const binding = await service.bindingFor(agent('agent-with-a-process-ceiling'))
      expect(binding?.maxProcesses).toBe(32)
      expect(binding?.resources).toEqual({ memoryBytes: 536_870_912 })
      expect(Object.keys(binding ?? {}).sort()).toEqual(['maxProcesses', 'provider', 'resources', 'spec', 'world'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('carries no process ceiling when the deployment asked for none, rather than a default', async () => {
    const { ctx, service } = await mounted({ network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited' })
    try {
      const binding = await service.bindingFor(agent('agent-without-a-process-ceiling'))
      expect(binding).toBeDefined()
      expect(binding !== undefined && 'maxProcesses' in binding).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('REFUSES a world with a process ceiling the local provider cannot hold, rather than an unlimited one', async () => {
    const { ctx, service } = await mounted({
      network: 'unrestricted',
      spawn: true,
      ipc: 'unrestricted',
      secrets: 'inherited',
      maxProcesses: 32,
    })
    try {
      expect(await service.bindingFor(agent('agent-the-local-provider-must-refuse-for-processes'))).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([5, 15])('refuses a cpu ceiling of %s millicores, which no spawn can carry, at the config boundary', async (cpuMillicores) => {
    const ctx = new Context()
    ctx.provide('sandboxPolicy', sandbox() as never)
    await expect(ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', resources: { cpuMillicores } },
    })).rejects.toThrow()
    await ctx.fiber.dispose()
  })

  it.each([0, 1.5])('refuses a process ceiling of %s at the config boundary', async (maxProcesses) => {
    const ctx = new Context()
    ctx.provide('sandboxPolicy', sandbox() as never)
    await expect(ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', maxProcesses },
    })).rejects.toThrow()
    await ctx.fiber.dispose()
  })
})
