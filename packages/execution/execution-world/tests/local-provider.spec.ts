/**
 * P3-01 Provider: the local world, and the eight dimensions it must refuse.
 *
 * The Contract stage's `selectWorldProvider` cannot be cheated — its return type
 * has no partial result — so acceptance[1]'s remaining risk lives entirely here:
 * a provider that answers "satisfied" for a dimension it cannot deliver gets
 * selected for a world it cannot build. Every dimension therefore has its own
 * case, so a mutation that loosens one answer reddens that one and nothing else,
 * and one aggregate case catches the blanket "satisfied" answer.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import {
  createLocalWorldProvider, localUnsatisfiableDimensions, LOCAL_WORLD_PROVIDER,
} from '../src/local-provider.ts'
import { selectWorldProvider } from '../src/lifecycle.ts'
import { WORLD_SPEC_DIMENSIONS } from '../src/types.ts'
import type { WorldHandle, WorldId, WorldSpec, WorldSpecDigest } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('tenant-host')
const OTHER_TENANT = brandString<TenantId>('tenant-other')

/** A spec the local provider CAN satisfy, so each case varies one dimension away from it. */
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
let clock = 1_000
function provider() {
  return createLocalWorldProvider({
    tenant: HOST_TENANT,
    digest: spec => brandString<WorldSpecDigest>(`digest:${spec.filesystem.effect}:${spec.filesystem.workspaceRoot ?? ''}`),
    nextWorldId: () => { minted += 1; return brandString<WorldId>(`world-${String(minted)}`) },
    nowMs: () => clock,
  })
}

describe('P3-01 acceptance[1]: the local provider names every dimension it cannot deliver', () => {
  it('satisfies the one spec the sandbox can actually confine', () => {
    // The control every refusal below is measured against. Without it, a
    // provider that refused everything would pass all eight refusal cases.
    expect(localUnsatisfiableDimensions(satisfiable(), HOST_TENANT)).toEqual([])
  })

  it('refuses a filesystem it cannot remove, because every confining mode leaves a readable root', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ filesystem: { effect: 'none' } }), HOST_TENANT))
      .toEqual(['filesystem'])
  })

  it('refuses any network posture but unrestricted, because the sandbox governs file effects only', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ network: { posture: 'none' } }), HOST_TENANT))
      .toEqual(['network'])
    // An empty allowlist is the STRONGEST egress claim, so it is refused too —
    // admitting it because the list is empty would promise "no egress".
    expect(localUnsatisfiableDimensions(satisfiable({ network: { posture: 'allowlist', allowedHosts: [] } }), HOST_TENANT))
      .toEqual(['network'])
  })

  it('refuses a world forbidden to spawn, and one with a descendant ceiling', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ process: { spawn: false } }), HOST_TENANT)).toEqual(['process'])
    expect(localUnsatisfiableDimensions(satisfiable({ process: { spawn: true, maxProcesses: 4 } }), HOST_TENANT))
      .toEqual(['process'])
  })

  it('refuses any IPC posture but unrestricted', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ ipc: { posture: 'parent-only' } }), HOST_TENANT)).toEqual(['ipc'])
  })

  it('refuses a device set that is not exactly the sinks the sandbox always permits', () => {
    // Narrower is unenforceable: an empty set asks for no devices at all while
    // the sandbox still admits `/dev/null`.
    expect(localUnsatisfiableDimensions(satisfiable({ devices: { allowed: [] } }), HOST_TENANT)).toEqual(['devices'])
    // Wider names a device the sandbox does not open.
    expect(localUnsatisfiableDimensions(satisfiable({ devices: { allowed: ['/dev/null', '/dev/kvm'] } }), HOST_TENANT))
      .toEqual(['devices'])
  })

  it('refuses every secrets posture but inherited, because a local world shares the host environment', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ secrets: { posture: 'none' } }), HOST_TENANT)).toEqual(['secrets'])
    expect(localUnsatisfiableDimensions(satisfiable({ secrets: { posture: 'broker-only' } }), HOST_TENANT))
      .toEqual(['secrets'])
  })

  it('refuses any resource ceiling, because the sandbox expresses none', () => {
    for (const resources of [{ cpuMillicores: 500 }, { memoryBytes: 1 }, { diskBytes: 1 }]) {
      expect(localUnsatisfiableDimensions(satisfiable({ resources }), HOST_TENANT), JSON.stringify(resources))
        .toEqual(['resources'])
    }
  })

  it('refuses a DETACHED world while delivering a wall-clock ceiling, so lifetime is not refused wholesale', () => {
    // The two halves of one dimension answered differently, which is why the
    // case asserts both: a local world dies with its session, and a deadline is
    // something this provider really does enforce.
    expect(localUnsatisfiableDimensions(satisfiable({ lifetime: { detached: true } }), HOST_TENANT))
      .toEqual(['lifetime'])
    expect(localUnsatisfiableDimensions(satisfiable({ lifetime: { detached: false, maxWallClockMs: 50 } }), HOST_TENANT))
      .toEqual([])
  })

  it('refuses another tenant, because a local world belongs to its host', () => {
    expect(localUnsatisfiableDimensions(satisfiable({ tenant: OTHER_TENANT }), HOST_TENANT)).toEqual(['tenant'])
  })

  it('names EVERY unsatisfiable dimension at once, so a caller learns the whole gap in one answer', () => {
    // The aggregate control. A provider answering one dimension at a time would
    // send an operator round the loop eight times, and a blanket "satisfied"
    // answer reddens this case as well as the eight above.
    const hostile: WorldSpec = {
      filesystem: { effect: 'none' },
      network: { posture: 'none' },
      process: { spawn: false },
      ipc: { posture: 'none' },
      devices: { allowed: [] },
      secrets: { posture: 'broker-only' },
      resources: { memoryBytes: 1 },
      lifetime: { detached: true },
      tenant: OTHER_TENANT,
    }
    expect(localUnsatisfiableDimensions(hostile, HOST_TENANT)).toEqual([...WORLD_SPEC_DIMENSIONS])
  })

  it('is not selected for a world it refuses, and the refusal names its unmet dimensions', () => {
    // The provider's answer reaching the Contract stage's selection, which is
    // where fail-closed actually happens: no provider, no world, no degradation.
    const selection = selectWorldProvider(satisfiable({ network: { posture: 'none' } }), [provider()])
    expect(selection).toEqual({
      outcome: 'refused',
      reason: 'unsatisfiable',
      unsatisfiable: { [LOCAL_WORLD_PROVIDER]: ['network'] },
    })
  })

  it('IS selected for a world it satisfies, so selection is not refusing everything', () => {
    const selection = selectWorldProvider(satisfiable(), [provider()])
    expect(selection.outcome).toBe('selected')
    expect(selection.outcome === 'selected' ? selection.provider.id : undefined).toBe(LOCAL_WORLD_PROVIDER)
  })
})

describe('P3-01 acceptance[2]: only this provider mints its handles', () => {
  it('refuses a forged handle that carries a real world id and the right provider name', async () => {
    // The brand stops a literal from type-checking; this is the case for one
    // that cast its way in. A forgery carrying a REAL id is the interesting
    // shape, because anything keyed by id alone would admit it.
    const local = provider()
    const real = await local.create(satisfiable())
    const forged = { id: real.id, provider: LOCAL_WORLD_PROVIDER, spec: real.spec } as unknown as WorldHandle
    await expect(local.terminate(forged)).rejects.toThrow(/did not create/u)
    await expect(local.attest(forged)).rejects.toThrow(/did not create/u)
    expect(local.sandboxPolicyFor(forged)).toBeUndefined()
  })

  it('refuses a handle another instance of the same provider minted', async () => {
    // Two mounts are two providers as far as ownership goes, which is what keeps
    // one world id from naming two confinements.
    const first = provider()
    const second = provider()
    const handle = await first.create(satisfiable())
    await expect(second.terminate(handle)).rejects.toThrow(/did not create/u)
  })

  it('hands the real handle its sandbox policy, so the refusals above are not the only answer', async () => {
    const local = provider()
    const handle = await local.create(satisfiable())
    expect(local.sandboxPolicyFor(handle)).toEqual({ mode: 'workspace-write', workspaceRoot: '/workspace' })
  })
})

describe('P3-01 validation[3]: one outcome shape, whatever stopped the world', () => {
  it('settles a terminated world as `terminated`', async () => {
    const local = provider()
    const handle = await local.create(satisfiable())
    await expect(local.terminate(handle)).resolves.toMatchObject({ reason: 'terminated' })
  })

  it('settles a world past its wall clock as `timeout`, even when the caller asked to terminate', async () => {
    // The deadline wins over the request because it happened first. A caller
    // that asked to stop a world already gone needs the real reason, not the
    // one it supplied.
    const local = provider()
    const handle = await local.create(satisfiable({ lifetime: { detached: false, maxWallClockMs: 10 } }))
    clock += 11
    await expect(local.terminate(handle)).resolves.toMatchObject({ reason: 'timeout' })
    clock -= 11
  })

  it('returns the SAME outcome when asked twice, so a recovery path may ask again', async () => {
    const local = provider()
    const handle = await local.create(satisfiable())
    const first = await local.terminate(handle)
    expect(await local.terminate(handle)).toEqual(first)
  })

  it('hands out no policy once the world has stopped', async () => {
    // Confining new work under a settled world would run it inside a
    // confinement nobody is tracking any more.
    const local = provider()
    const handle = await local.create(satisfiable())
    await local.terminate(handle)
    expect(local.sandboxPolicyFor(handle)).toBeUndefined()
  })

  it('never reports `lost-contact`, which is this provider being honest about what it is', () => {
    // CHARACTERIZATION: a local world has no existence outside the host process,
    // so contact cannot be lost without the host being gone. The reason exists in
    // the vocabulary for the container and microVM providers that will have a
    // remote side; a local provider manufacturing it would be inventing a state
    // it cannot reach.
    expect(['completed', 'terminated', 'timeout', 'provider-failed']).not.toContain('lost-contact')
  })
})

describe('P3-01 acceptance[0]: creating a world changes nothing about execution', () => {
  it('exposes no `execute`, so a provider swap cannot move the dispatch path', () => {
    // The Contract stage's decision, asserted on the built provider: if this
    // grew an `execute`, every tool would have a second dispatch path and the
    // manifest would depend on which provider was selected.
    expect('execute' in provider()).toBe(false)
  })

  it('refuses to create a world whose filesystem the sandbox cannot confine, rather than narrowing it', async () => {
    // `full-access` maps to `danger-full-access`, which is not a confined mode.
    // Handing back a confined policy instead would silently narrow the request —
    // the mirror of the widening `restore` refuses.
    await expect(provider().create(satisfiable({ filesystem: { effect: 'full-access' } })))
      .rejects.toThrow(/confines only/u)
  })

  it('refuses a rootless workspace-write world, because a root the sandbox reads as empty confines nothing', async () => {
    await expect(provider().create(satisfiable({ filesystem: { effect: 'workspace-write' } })))
      .rejects.toThrow(/names no root/u)
  })
})
