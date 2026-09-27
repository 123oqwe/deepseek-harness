/**
 * P3-01 Usage: the mounted registry, where a dispatch path gets a world without
 * naming a provider (must[2]), and where a refusal stays a refusal
 * (acceptance[1]).
 *
 * The registry is the piece that decides whether `local` appears in the dispatch
 * path. These cases are about the two answers it can give and the one it must
 * never give: a world the deployment did not ask for.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import ExecutionWorldService, { digestWorldSpec, filesystemForSandboxMode, nextWorldId, resolveWorldSpec } from '../src/plugin.ts'
import { createLocalWorldProvider, LOCAL_WORLD_PROVIDER } from '../src/local-provider.ts'
import { FENCED_WORLD_PROVIDER } from '../src/fenced-provider.ts'
import { createFakeWorldProvider, FAKE_WORLD_PROVIDER } from './fake-provider.ts'
import type { WorldHandle, WorldId, WorldProvider, WorldProviderId, WorldSpec, WorldSpecDigest } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('local-host')

/** The file-effect boundary a real `sandboxPolicy` resolves, in ITS OWN vocabulary. */
function sandbox(mode = 'workspace-write') {
  return { resolve: () => ({ mode, workspaceRoot: '/workspace' }) }
}

/** Two agents so a per-session binding can be told from a per-process one. */
function agent(id: string) {
  return { id, session: { id } }
}

let minted = 0
function ids(): WorldId {
  minted += 1
  return brandString<WorldId>(`world-${String(minted)}`)
}

/**
 * One mounted registry over a provided `sandboxPolicy`.
 * @param options - the file-effect boundary and the row's request.
 * @returns the context and the service.
 */
async function mounted(options: {
  readonly mode?: string
  readonly request?: { network?: 'none' | 'allowlist' | 'unrestricted' }
} = {}): Promise<{ ctx: Context; service: ExecutionWorldService }> {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', sandbox(options.mode) as never)
  await ctx.plugin(ExecutionWorldService, {
    tenant: 'local-host',
    request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', ...options.request },
  })
  const service = ctx.get('executionWorlds')
  if (service === undefined) throw new Error('the registry did not mount')
  return { ctx, service }
}

describe('P3-01 must[1]: the request becomes a complete spec, with every default stated once', () => {
  it('answers all nine dimensions from a request that states none', () => {
    const spec = resolveWorldSpec({}, { effect: 'read-only' }, HOST_TENANT)
    expect(spec).toEqual({
      filesystem: { effect: 'read-only' },
      network: { posture: 'unrestricted' },
      process: { spawn: true },
      ipc: { posture: 'unrestricted' },
      devices: { allowed: ['/dev/null'] },
      secrets: { posture: 'inherited' },
      resources: {},
      lifetime: { detached: false },
      tenant: HOST_TENANT,
    })
  })

  it('carries a stated request through instead of the default, which is what makes a refusal reachable', () => {
    // Without this, every deployment would ask for exactly what the local host
    // already is, and acceptance[1]'s refusal could never fire in production.
    expect(resolveWorldSpec({ network: 'none', spawn: false }, { effect: 'read-only' }, HOST_TENANT))
      .toMatchObject({ network: { posture: 'none' }, process: { spawn: false } })
  })

  it('digests two equal specs equally and two different specs differently', () => {
    const left = resolveWorldSpec({}, { effect: 'read-only' }, HOST_TENANT)
    const right = resolveWorldSpec({}, { effect: 'read-only' }, HOST_TENANT)
    expect(digestWorldSpec(left)).toBe(digestWorldSpec(right))
    expect(digestWorldSpec(left)).not.toBe(digestWorldSpec(resolveWorldSpec({}, { effect: 'full-access' }, HOST_TENANT)))
  })
})

describe('P3-01 must[2]: a dispatch path gets its world from the registry, never by naming a provider', () => {
  it('binds the local provider when it satisfies the requested confinement', async () => {
    const { service } = await mounted()
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    const binding = await service.bindingFor(agent('agent-1'))
    expect(binding?.provider).toBe(LOCAL_WORLD_PROVIDER)
  })

  it('binds ONE world per session, so two dispatches in one session name the same world', async () => {
    const { service } = await mounted()
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    const first = await service.bindingFor(agent('agent-1'))
    const second = await service.bindingFor(agent('agent-1'))
    expect(second).toEqual(first)
  })

  it('gives a DIFFERENT session its own world, so the binding is not a process-wide singleton', async () => {
    const { service } = await mounted()
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    const first = await service.bindingFor(agent('agent-1'))
    const second = await service.bindingFor(agent('agent-2'))
    expect(second?.world).not.toBe(first?.world)
  })

  it('prefers the provider registered FIRST, which is the deployment order and not this service\'s taste', async () => {
    const { service } = await mounted()
    const { provider: fake } = createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids })
    service.register(fake)
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect((await service.bindingFor(agent('agent-1')))?.provider).toBe(FAKE_WORLD_PROVIDER)
  })

  it('removes the provider when the registering fiber is disposed, rather than outliving it', async () => {
    const { ctx, service } = await mounted()
    const fiber = await ctx.plugin({
      inject: ['executionWorlds'],
      apply: (scope: Context) => {
        scope.executionWorlds.register(createLocalWorldProvider({
          tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0,
        }))
      },
    })
    expect(await service.bindingFor(agent('agent-1'))).not.toBeUndefined()
    await fiber.dispose()
    // A fresh session, because the first one's binding is already made: the
    // question is whether a LATER session can still reach a disposed provider.
    expect(await service.bindingFor(agent('agent-2'))).toBeUndefined()
  })
})

describe('P3-01 acceptance[1]: a registry with nothing to offer refuses instead of degrading', () => {
  it('answers undefined when no provider is registered at all', async () => {
    const { service } = await mounted()
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('answers undefined when every provider refuses the requested confinement, naming no weaker world', async () => {
    // The deployment asks for a world with NO network. The local provider cannot
    // deliver that, and the registry must not hand back the unrestricted world
    // it could build — that substitution is the degradation the clause forbids.
    const { service } = await mounted({ request: { network: 'none' } })
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('binds the provider that CAN deliver the stricter request, so the refusal above is about capability', async () => {
    const { service } = await mounted({ request: { network: 'none' } })
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    const { provider: fake } = createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids })
    service.register(fake)
    expect((await service.bindingFor(agent('agent-1')))?.provider).toBe(FAKE_WORLD_PROVIDER)
  })

  it('refuses on the SELECTION, not on the provider\'s create, which is what "never degrades" means', async () => {
    // Measured gap: with only the local provider registered, a mutation that
    // made the registry fall back to "the closest provider" reddened NOTHING,
    // because the local provider's own `create` refuses the same spec
    // independently. Every refusal case here would have passed for the wrong
    // reason. This provider refuses the dimension and would happily create
    // anyway — the disagreement is the point — so only a registry that honours
    // SELECTION answers undefined.
    const willing: WorldProvider = {
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      unsatisfiableDimensions: () => ['network'],
    }
    const { service } = await mounted()
    service.register(willing)
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('answers undefined when no file-effect boundary is mounted, because the spec would be invented', async () => {
    const ctx = new Context()
    await ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited' },
    })
    const service = ctx.get('executionWorlds')
    service?.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect(await service?.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('answers undefined when the chosen provider REJECTS the create, rather than reporting a world it does not have', async () => {
    // `danger-full-access` maps to the `full-access` effect, which the local
    // provider refuses by dimension: the sandbox confines nothing at that mode,
    // so there is no world for it to build.
    const { service } = await mounted({ mode: 'danger-full-access' })
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })
})

describe('P3-01 must[1]: the sandbox vocabulary is translated, never passed through', () => {
  it('maps each of the three sandbox modes onto the filesystem dimension, renaming the widest one', () => {
    expect(filesystemForSandboxMode('read-only', '/w')).toEqual({ effect: 'read-only' })
    expect(filesystemForSandboxMode('workspace-write', '/w')).toEqual({ effect: 'workspace-write', workspaceRoot: '/w' })
    // `dsh-sandbox` says `danger-full-access`; a spec says `full-access`.
    expect(filesystemForSandboxMode('danger-full-access', '/w')).toEqual({ effect: 'full-access' })
  })

  it('refuses a mode it does not know, rather than building a spec with an unrecognised effect', () => {
    // Measured the hard way: passing the sandbox's spelling straight through
    // produced `effect: 'danger-full-access'`, which no dimension rule has a
    // case for — the provider answered "satisfiable", `create` then refused,
    // and an entire profile silently bound no world while looking like an
    // honest refusal.
    expect(filesystemForSandboxMode('something-else', '/w')).toBeUndefined()
  })
})

describe('P3-01 acceptance[0]: two providers, one action, the same confinement digest', () => {
  it('digests the SAME spec identically whichever provider builds the world, which is what a swap must not change', async () => {
    const local = await mounted()
    local.service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    const localBinding = await local.service.bindingFor(agent('agent-1'))

    const container = await mounted()
    const { provider: fake, created } = createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids })
    container.service.register(fake)
    const fakeBinding = await container.service.bindingFor(agent('agent-1'))

    // Different providers, different world ids — and the SAME spec digest,
    // because the digest names the confinement and not who built it. A policy
    // comparing confinement therefore sees one answer across the swap.
    expect(fakeBinding?.provider).not.toBe(localBinding?.provider)
    expect(fakeBinding?.world).not.toBe(localBinding?.world)
    expect(fakeBinding?.spec).toBe(localBinding?.spec)
    expect(created).toHaveLength(1)
  })

  it('mints a world id nothing else produces, so two bindings are never confused', () => {
    expect(nextWorldId()).not.toBe(nextWorldId())
  })
})

describe('P3-01 acceptance[2] (BLOCKED-316): the registry checks who built a world instead of taking its handle\'s word', () => {
  /**
   * A provider whose handles name `claimed` instead of its own id, with the
   * digest the registry computes for the spec.
   * @param claimed - the provider id its handles name.
   * @returns the provider.
   */
  function claiming(claimed: WorldProviderId): WorldProvider {
    return {
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      create: spec => Promise.resolve({ id: ids(), provider: claimed, spec: digestWorldSpec(spec) } as unknown as WorldHandle),
    }
  }

  it('refuses to register a provider it did not build under the reserved id local, naming the id', async () => {
    const { service } = await mounted()
    const lookalike: WorldProvider = {
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      id: LOCAL_WORLD_PROVIDER,
    }
    expect(() => service.register(lookalike)).toThrow('"local" is reserved')
    // A copy of the real local provider is a look-alike too: the reservation
    // is by object identity, as a handle's authority is.
    const copy = { ...createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }) }
    expect(() => service.register(copy)).toThrow('"local" is reserved')
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('refuses to register a provider it did not build under the reserved id fenced, naming the id', async () => {
    const { service } = await mounted()
    const lookalike: WorldProvider = {
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      id: FENCED_WORLD_PROVIDER,
    }
    expect(() => service.register(lookalike)).toThrow('"fenced" is reserved')
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
  })

  it('binds nothing when the handle names a provider other than the one selected, and says which', async () => {
    const { service } = await mounted()
    service.register(claiming(LOCAL_WORLD_PROVIDER))
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(service.refusalFor(agent('agent-1'))).toEqual({ kind: 'identity-mismatch', provider: FAKE_WORLD_PROVIDER, claimed: LOCAL_WORLD_PROVIDER })
  })

  it('binds nothing when the handle carries a digest other than that of the spec it was asked to create', async () => {
    const { service } = await mounted()
    service.register(createFakeWorldProvider({ digest: () => brandString<WorldSpecDigest>('0'.repeat(64)), nextWorldId: ids }).provider)
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(service.refusalFor(agent('agent-1'))).toEqual({ kind: 'digest-mismatch', provider: FAKE_WORLD_PROVIDER })
  })

  it('reports a requested world no provider can hold as unavailable, with the selection\'s refusal', async () => {
    const { service } = await mounted({ request: { network: 'none' } })
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(service.refusalFor(agent('agent-1'))).toEqual({
      kind: 'unavailable',
      selection: { outcome: 'refused', reason: 'unsatisfiable', unsatisfiable: { [LOCAL_WORLD_PROVIDER]: ['network'] } },
    })
  })

  it('reports nothing once a later attempt binds, so a refusal does not outlive the attempt that made it', async () => {
    const { service } = await mounted()
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(service.refusalFor(agent('agent-1'))).toMatchObject({ kind: 'unavailable', selection: { reason: 'no-provider' } })
    service.register(createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }))
    expect((await service.bindingFor(agent('agent-1')))?.provider).toBe(LOCAL_WORLD_PROVIDER)
    expect(service.refusalFor(agent('agent-1'))).toBeUndefined()
  })

  describe('where a tool runtime is composed, a call in a session whose handle failed the check does not run', () => {
    /** The guard as the registry registers it, captured from a stand-in tool runtime. */
    type CapturedGuard = (execution: { readonly name: string; readonly agent?: { readonly id: string } }) => string | undefined

    /**
     * Mount the registry beside a stand-in tool runtime, register `provider`,
     * and attempt one binding for `agent-1`.
     * @param provider - the provider to register.
     * @param request - the row's request.
     * @returns the guard the registry registered.
     */
    async function guardAfterBinding(provider: WorldProvider, request: { network?: 'none' } = {}): Promise<CapturedGuard> {
      const ctx = new Context()
      let captured: CapturedGuard | undefined
      ctx.provide('tools', { guard: (guard: CapturedGuard) => { captured = guard; return () => undefined } } as never)
      ctx.provide('sandboxPolicy', sandbox() as never)
      await ctx.plugin(ExecutionWorldService, {
        tenant: 'local-host',
        request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', ...request },
      })
      // The guard child mounts once `tools` resolves.
      await new Promise(resolve => setImmediate(resolve))
      const service = ctx.get('executionWorlds')
      if (service === undefined || captured === undefined) throw new Error('the registry registered no guard')
      service.register(provider)
      await service.bindingFor(agent('agent-1'))
      return captured
    }

    it('denies an identity mismatch, naming the selected provider and the one its handle claims', async () => {
      const guard = await guardAfterBinding(claiming(LOCAL_WORLD_PROVIDER))
      const reason = guard({ name: 'read', agent: { id: 'agent-1' } })
      expect(reason).toContain('provider identity does not match')
      expect(reason).toContain(`"${FAKE_WORLD_PROVIDER}" was selected, and its handle claims to be "${LOCAL_WORLD_PROVIDER}"`)
    })

    it('denies a digest mismatch, naming it as one', async () => {
      const guard = await guardAfterBinding(createFakeWorldProvider({ digest: () => brandString<WorldSpecDigest>('0'.repeat(64)), nextWorldId: ids }).provider)
      expect(guard({ name: 'read', agent: { id: 'agent-1' } })).toContain('spec digest does not match')
    })

    it('leaves alone a session whose world is unavailable, another session, and a call with no agent', async () => {
      const guard = await guardAfterBinding(
        createLocalWorldProvider({ tenant: HOST_TENANT, digest: digestWorldSpec, nextWorldId: ids, nowMs: () => 0 }),
        { network: 'none' },
      )
      expect(guard({ name: 'read', agent: { id: 'agent-1' } })).toBeUndefined()
      expect(guard({ name: 'read', agent: { id: 'agent-2' } })).toBeUndefined()
      expect(guard({ name: 'read' })).toBeUndefined()
    })
  })
})

describe('P3-01 acceptance[2] (BLOCKED-316, B-673): a provider cannot change what the registry checks once it is registered', () => {
  it('checks a handle against the id its provider registered under, so a provider that renames itself to local afterwards binds nothing', async () => {
    const { service } = await mounted()
    const renamed: WorldProvider = {
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      create: spec => Promise.resolve({ id: ids(), provider: renamed.id, spec: digestWorldSpec(spec) } as unknown as WorldHandle),
    }
    service.register(renamed)
    ;(renamed as { id: WorldProviderId }).id = LOCAL_WORLD_PROVIDER
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(service.refusalFor(agent('agent-1'))).toEqual({ kind: 'identity-mismatch', provider: FAKE_WORLD_PROVIDER, claimed: LOCAL_WORLD_PROVIDER })
  })

  it('hands a provider a frozen copy of the spec, so a create that writes to it binds nothing and the request keeps its ceilings', async () => {
    const ctx = new Context()
    ctx.provide('sandboxPolicy', sandbox() as never)
    await ctx.plugin(ExecutionWorldService, {
      tenant: 'local-host',
      request: { network: 'unrestricted', spawn: true, ipc: 'unrestricted', secrets: 'inherited', maxProcesses: 2, resources: { memoryBytes: 536870912 } },
    })
    const service = ctx.get('executionWorlds')
    if (service === undefined) throw new Error('the registry did not mount')
    const handed: WorldSpec[] = []
    service.register({
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      create: (spec) => {
        handed.push(spec)
        ;(spec as { resources: WorldSpec['resources'] }).resources = {}
        return Promise.resolve({ id: ids(), provider: FAKE_WORLD_PROVIDER, spec: digestWorldSpec(spec) } as unknown as WorldHandle)
      },
    })
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(Object.isFrozen(handed[0]?.resources)).toBe(true)
    expect(service.requestedCeilings()).toEqual({ memoryBytes: 536870912, maxProcesses: 2 })
  })

  it('runs one create for concurrent binding requests of the same agent, so no dispatch reads a half-made attempt', async () => {
    const { service } = await mounted()
    let creates = 0
    service.register({
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      create: (spec) => {
        creates += 1
        return Promise.resolve({ id: ids(), provider: FAKE_WORLD_PROVIDER, spec: digestWorldSpec(spec) } as unknown as WorldHandle)
      },
    })
    const [first, second] = await Promise.all([service.bindingFor(agent('agent-1')), service.bindingFor(agent('agent-1'))])
    expect(creates).toBe(1)
    expect(second).toBe(first)
  })

  it('keeps a recorded mismatch when a later attempt\'s create fails, so the session stays refused until a world binds', async () => {
    const { service } = await mounted()
    let creates = 0
    service.register({
      ...createFakeWorldProvider({ digest: digestWorldSpec, nextWorldId: ids }).provider,
      create: (spec) => {
        creates += 1
        return creates === 1
          ? Promise.resolve({ id: ids(), provider: LOCAL_WORLD_PROVIDER, spec: digestWorldSpec(spec) } as unknown as WorldHandle)
          : Promise.reject(new Error('the backing runtime is gone'))
      },
    })
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(await service.bindingFor(agent('agent-1'))).toBeUndefined()
    expect(creates).toBe(2)
    expect(service.refusalFor(agent('agent-1'))).toEqual({ kind: 'identity-mismatch', provider: FAKE_WORLD_PROVIDER, claimed: LOCAL_WORLD_PROVIDER })
  })
})
