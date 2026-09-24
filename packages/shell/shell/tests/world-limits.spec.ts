/**
 * P3-10 R4: the ceilings a shell spawn carries are the bound world's, read
 * once per call from the world registry, and nothing when there is none. A
 * deployment that states a ceiling no world here can hold refuses the call
 * instead of running it unbounded (delegate ruling B-479).
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { readWorldLimits, WorldCeilingsRefusedError } from '@deepseek-ai/dsh-shell'

const agent = { id: 'agent-1', session: { id: 'agent-1' } }

/** What the fake composition around the reader answers. */
interface Composition {
  /** The registry's binding for every agent. */
  readonly binding: unknown
  /** The ceilings the deployment's request states. */
  readonly stated?: Readonly<Record<string, number>>
  /** The session's sandbox mode, when a policy service is mounted. */
  readonly mode?: string
  /** What the subprocess runtime holds, when one is mounted. */
  readonly held?: readonly string[]
}

/** A context whose world registry answers `binding` for every agent. */
function withBinding(binding: unknown): Context {
  return composed({ binding })
}

/** A context carrying the registry, and the policy service and runtime when named. */
function composed({ binding, stated = {}, mode, held }: Composition): Context {
  const ctx = new Context()
  ctx.provide('executionWorlds', { bindingFor: () => Promise.resolve(binding), requestedCeilings: () => stated } as never)
  if (mode !== undefined) ctx.provide('sandboxPolicy', { resolve: () => ({ mode, workspaceRoot: '/work' }) } as never)
  if (held !== undefined) ctx.provide('subprocess', { enforceableLimits: () => held } as never)
  return ctx
}

/** The refusal `readWorldLimits` throws for `composition`. */
async function refusal(composition: Composition): Promise<WorldCeilingsRefusedError> {
  const error: unknown = await readWorldLimits(composed(composition), agent).then(() => undefined, (thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(WorldCeilingsRefusedError)
  return error as WorldCeilingsRefusedError
}

describe('P3-10 R4 — a shell spawn carries its world\'s ceilings', () => {
  it('reads no ceiling where no world registry is mounted, or for a call with no agent', async () => {
    await expect(readWorldLimits(new Context(), agent)).resolves.toBeUndefined()
    await expect(readWorldLimits(withBinding({ resources: { memoryBytes: 1024 } }), undefined)).resolves.toBeUndefined()
  })

  it('reads no ceiling when the registry binds no world, or a world with none', async () => {
    await expect(readWorldLimits(withBinding(undefined), agent)).resolves.toBeUndefined()
    await expect(readWorldLimits(withBinding({ resources: {} }), agent)).resolves.toBeUndefined()
    // The control for the refusals below: no ceiling stated, so an unbound
    // call runs as before, in danger-full-access and on a runtime holding nothing.
    await expect(readWorldLimits(composed({ binding: undefined, mode: 'danger-full-access', held: [] }), agent)).resolves.toBeUndefined()
  })

  it('carries the cpu, memory and process ceilings of the bound world, and only those it states', async () => {
    await expect(readWorldLimits(withBinding({ resources: { cpuMillicores: 500, memoryBytes: 268_435_456 }, maxProcesses: 32 }), agent))
      .resolves.toEqual({ cpuMillicores: 500, memoryBytes: 268_435_456, maxProcesses: 32 })
    await expect(readWorldLimits(withBinding({ resources: {}, maxProcesses: 8 }), agent)).resolves.toEqual({ maxProcesses: 8 })
  })

  it('REFUSES a world that states a disk ceiling, which no spawn can carry yet, rather than running unbounded on disk', async () => {
    await expect(readWorldLimits(withBinding({ resources: { diskBytes: 1_073_741_824 } }), agent))
      .rejects.toThrow(/disk ceiling, which a spawn cannot carry yet/u)
  })

  it('REFUSES a call whose deployment states a ceiling this machine cannot hold, naming only that ceiling and why', async () => {
    const stated = { maxProcesses: 64, memoryBytes: 268_435_456 }
    const partial = await refusal({ binding: undefined, stated, mode: 'workspace-write', held: ['memory'] })
    expect(partial.ceilings).toEqual(['maxProcesses'])
    expect(partial.refusal).toEqual({ kind: 'not-held', platform: process.platform, held: ['memory'] })
    expect(partial.message).toContain('maxProcesses 64')
    expect(partial.message).not.toContain('memoryBytes')
    // No runtime mounted holds nothing, so both stated ceilings are named.
    const none = await refusal({ binding: undefined, stated, mode: 'workspace-write' })
    expect(none.ceilings).toEqual(['memoryBytes', 'maxProcesses'])
    expect(none.refusal).toEqual({ kind: 'not-held', platform: process.platform, held: [] })
  })

  it('REFUSES a call in danger-full-access when the deployment states a ceiling, whatever this machine can hold', async () => {
    const error = await refusal({
      binding: undefined,
      stated: { maxProcesses: 64, memoryBytes: 268_435_456 },
      mode: 'danger-full-access',
      held: ['cpu', 'memory', 'processes'],
    })
    expect(error.ceilings).toEqual(['memoryBytes', 'maxProcesses'])
    expect(error.refusal).toEqual({ kind: 'full-access' })
    expect(error.message).toContain('danger-full-access')
  })

  it('REFUSES a stated disk ceiling as one no machine holds yet, and a held ceiling no provider accepted as that', async () => {
    const disk = await refusal({ binding: undefined, stated: { diskBytes: 1_073_741_824 }, held: ['cpu', 'memory', 'processes'] })
    expect(disk.ceilings).toEqual(['diskBytes'])
    expect(disk.refusal).toMatchObject({ kind: 'not-held' })
    const held = await refusal({ binding: undefined, stated: { maxProcesses: 8 }, held: ['processes'] })
    expect(held.ceilings).toEqual(['maxProcesses'])
    expect(held.refusal).toEqual({ kind: 'no-world' })
  })
})
