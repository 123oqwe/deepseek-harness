/**
 * P3-10 R2: the fenced world provider claims a ceiling exactly when the
 * mounted subprocess runtime can hold it, and otherwise answers as the local
 * provider does.
 *
 * Each dimension the rule adds has its own case, so a mutation that loosens
 * one answer reddens that one. The mounted case boots the registry with both
 * providers in the shipped bundle's order and a stand-in subprocess runtime,
 * which is also the positive control for the service the plugin reads: a
 * misspelt service name would leave the provider without an answer and fail
 * here.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import {
  createFencedWorldProvider, fencedUnsatisfiableDimensions, FENCED_WORLD_PROVIDER,
} from '../src/fenced-provider.ts'
import type { FencedLimitDimension } from '../src/fenced-provider.ts'
import { createLocalWorldProvider, localUnsatisfiableDimensions } from '../src/local-provider.ts'
import * as fencedPlugin from '../src/fenced.ts'
import * as localPlugin from '../src/local.ts'
import ExecutionWorldService, { selectionOrder } from '../src/plugin.ts'
import type { WorldRequest } from '../src/plugin.ts'
import type { WorldHandle, WorldId, WorldSpec, WorldSpecDigest } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('tenant-host')
const ALL: readonly FencedLimitDimension[] = ['cpu', 'memory', 'processes']

/** A spec both providers can satisfy, so each case varies one dimension away from it. */
function satisfiable(over: Partial<WorldSpec> = {}): WorldSpec {
  return {
    filesystem: { effect: 'workspace-write', workspaceRoot: '/workspace' },
    network: { posture: 'unrestricted' },
    process: { spawn: true },
    ipc: { posture: 'unrestricted' },
    devices: { allowed: ['/dev/null'] },
    secrets: { posture: 'inherited' },
    resources: {},
    lifetime: { detached: false },
    tenant: HOST_TENANT,
    ...over,
  }
}

let minted = 0
/** Options both providers share, with the subprocess runtime's answer supplied by `enforceable`. */
function options(enforceable: () => readonly FencedLimitDimension[] = () => ALL) {
  return {
    tenant: HOST_TENANT,
    digest: (spec: WorldSpec) => brandString<WorldSpecDigest>(`digest:${JSON.stringify(spec.resources)}:${String(spec.process.maxProcesses)}`),
    nextWorldId: () => { minted += 1; return brandString<WorldId>(`fenced-world-${String(minted)}`) },
    nowMs: () => 0,
    enforceableLimits: enforceable,
  }
}

describe('P3-10 R2 — the fenced provider claims what the subprocess runtime can hold', () => {
  it('delivers a world with cpu, memory and process ceilings when the runtime holds all three', () => {
    const spec = satisfiable({ process: { spawn: true, maxProcesses: 32 }, resources: { cpuMillicores: 500, memoryBytes: 268_435_456 } })
    expect(fencedUnsatisfiableDimensions(spec, HOST_TENANT, ALL)).toEqual([])
    // The local provider refuses the same spec, which is why the fenced one exists.
    expect(localUnsatisfiableDimensions(spec, HOST_TENANT)).toEqual(['process', 'resources'])
  })

  it('REFUSES a process ceiling the runtime cannot hold', () => {
    const spec = satisfiable({ process: { spawn: true, maxProcesses: 32 } })
    expect(fencedUnsatisfiableDimensions(spec, HOST_TENANT, ['cpu', 'memory'])).toEqual(['process'])
  })

  it('REFUSES a cpu ceiling the runtime cannot hold', () => {
    const spec = satisfiable({ resources: { cpuMillicores: 500 } })
    expect(fencedUnsatisfiableDimensions(spec, HOST_TENANT, ['memory', 'processes'])).toEqual(['resources'])
  })

  it('REFUSES a memory ceiling the runtime cannot hold, even when it holds the cpu one asked beside it', () => {
    const spec = satisfiable({ resources: { cpuMillicores: 500, memoryBytes: 268_435_456 } })
    expect(fencedUnsatisfiableDimensions(spec, HOST_TENANT, ['cpu', 'processes'])).toEqual(['resources'])
  })

  it('REFUSES a disk ceiling on every host, because no spawn can carry one yet', () => {
    expect(fencedUnsatisfiableDimensions(satisfiable({ resources: { diskBytes: 1_073_741_824 } }), HOST_TENANT, ALL)).toEqual(['resources'])
  })

  it('REFUSES a world that may not spawn at all, because the launch runner is itself a task', () => {
    expect(fencedUnsatisfiableDimensions(satisfiable({ process: { spawn: false } }), HOST_TENANT, ALL)).toEqual(['process'])
  })

  it('refuses every ceiling on a host where the runtime holds nothing, and still answers a world with none', () => {
    const limited = satisfiable({ process: { spawn: true, maxProcesses: 32 }, resources: { memoryBytes: 268_435_456 } })
    expect(fencedUnsatisfiableDimensions(limited, HOST_TENANT, [])).toEqual(['process', 'resources'])
    expect(fencedUnsatisfiableDimensions(satisfiable(), HOST_TENANT, [])).toEqual([])
  })

  it('keeps every refusal of the local provider that is not a ceiling, in declaration order', () => {
    const spec = satisfiable({ network: { posture: 'none' }, secrets: { posture: 'none' }, resources: { diskBytes: 1 } })
    expect(fencedUnsatisfiableDimensions(spec, HOST_TENANT, ALL)).toEqual(['network', 'secrets', 'resources'])
  })

  it('asks the runtime at every question, not once when it was created', async () => {
    let enforceable: readonly FencedLimitDimension[] = ALL
    const fenced = createFencedWorldProvider(options(() => enforceable))
    const spec = satisfiable({ process: { spawn: true, maxProcesses: 32 } })
    expect(fenced.unsatisfiableDimensions(spec)).toEqual([])
    enforceable = []
    expect(fenced.unsatisfiableDimensions(spec)).toEqual(['process'])
    await expect(fenced.create(spec)).rejects.toThrow(/fenced world provider cannot satisfy process/u)
  })

  it('declares only the filesystem dimension to a policy, as the local provider does', () => {
    expect(createFencedWorldProvider(options()).supportedPolicyFeatures).toEqual({ dimensions: ['filesystem'] })
  })

  it('mints handles in its own name, and neither provider operates a world the other minted', async () => {
    const fenced = createFencedWorldProvider(options())
    const local = createLocalWorldProvider(options())
    const fencedWorld: WorldHandle = await fenced.create(satisfiable({ process: { spawn: true, maxProcesses: 32 } }))
    const localWorld: WorldHandle = await local.create(satisfiable())
    expect(fencedWorld.provider).toBe(FENCED_WORLD_PROVIDER)
    await expect(fenced.attest(fencedWorld)).resolves.toMatchObject({ provider: FENCED_WORLD_PROVIDER, evidence: { kind: 'fenced-sandbox' } })
    await expect(local.terminate(fencedWorld)).rejects.toThrow(/local world provider was handed a world it did not create/u)
    await expect(fenced.terminate(localWorld)).rejects.toThrow(/fenced world provider was handed a world it did not create/u)
  })
})

describe('P3-10 R2 — mounted beside the local provider, whichever mounts first', () => {
  /**
   * Mount the registry, then the provider plugins in `order`, over a stand-in
   * subprocess runtime answering `enforceable`.
   * @param request - the deployment's world request.
   * @param enforceable - what the stand-in runtime says it can hold.
   * @param order - which provider plugins mount, and in which order.
   * @returns the mounted context and registry.
   */
  async function mounted(
    request: WorldRequest,
    enforceable: readonly FencedLimitDimension[],
    order: 'local-first' | 'fenced-first' | 'fenced-only' = 'local-first',
  ) {
    const ctx = new Context()
    ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }) } as never)
    ctx.provide('subprocess', { enforceableLimits: () => enforceable } as never)
    await ctx.plugin(ExecutionWorldService, { tenant: 'local-host', request })
    if (order === 'local-first') await ctx.plugin(localPlugin, { tenant: 'local-host' })
    await ctx.plugin(fencedPlugin, { tenant: 'local-host' })
    if (order === 'fenced-first') await ctx.plugin(localPlugin, { tenant: 'local-host' })
    const service = ctx.get('executionWorlds')
    if (service === undefined) throw new Error('the registry did not mount')
    return { ctx, service }
  }

  const agent = (id: string) => ({ id, session: { id } })

  it('leaves a world with no ceiling to the local provider, so nothing a deployment already runs changes', async () => {
    const { ctx, service } = await mounted({}, ALL)
    try {
      expect((await service.bindingFor(agent('agent-without-ceilings')))?.provider).toBe('local')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('binds a world with a process ceiling through the fenced provider when the runtime holds it', async () => {
    const { ctx, service } = await mounted({ maxProcesses: 32 }, ALL)
    try {
      const binding = await service.bindingFor(agent('agent-with-a-process-ceiling'))
      expect(binding?.provider).toBe(FENCED_WORLD_PROVIDER)
      expect(binding?.maxProcesses).toBe(32)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('binds NO world for that ceiling where the runtime holds nothing, rather than an unlimited one', async () => {
    const { ctx, service } = await mounted({ maxProcesses: 32 }, [])
    try {
      expect(await service.bindingFor(agent('agent-the-runtime-cannot-fence'))).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still leaves a world with no ceiling to the local provider when the fenced one registered FIRST', async () => {
    const { ctx, service } = await mounted({}, ALL, 'fenced-first')
    try {
      expect((await service.bindingFor(agent('agent-without-ceilings-fenced-first')))?.provider).toBe('local')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still binds a process ceiling through the fenced provider when it registered first', async () => {
    const { ctx, service } = await mounted({ maxProcesses: 32 }, ALL, 'fenced-first')
    try {
      expect((await service.bindingFor(agent('agent-with-a-ceiling-fenced-first')))?.provider).toBe(FENCED_WORLD_PROVIDER)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serves a world with no ceiling itself when it is the only provider mounted', async () => {
    const { ctx, service } = await mounted({}, ALL, 'fenced-only')
    try {
      expect((await service.bindingFor(agent('agent-on-a-fenced-only-host')))?.provider).toBe(FENCED_WORLD_PROVIDER)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('P3-10 R2 — the order selection consults providers in', () => {
  const fenced = createFencedWorldProvider(options())
  const local = createLocalWorldProvider(options())

  it('puts a provider after the providers it yields to, and otherwise keeps registration order', () => {
    expect(selectionOrder([fenced, local], new Map([[fenced, [local.id]]]))).toEqual([local, fenced])
    expect(selectionOrder([local, fenced], new Map([[fenced, [local.id]]]))).toEqual([local, fenced])
    expect(selectionOrder([fenced, local], new Map())).toEqual([fenced, local])
  })

  it('ignores a yield to a provider that is not registered', () => {
    expect(selectionOrder([fenced], new Map([[fenced, [local.id]]]))).toEqual([fenced])
  })

  it('REFUSES providers that yield to each other, which leaves no order to choose', () => {
    expect(() => selectionOrder([fenced, local], new Map([[fenced, [local.id]], [local, [fenced.id]]])))
      .toThrow(/yield to each other in a cycle: fenced, local/u)
  })
})
