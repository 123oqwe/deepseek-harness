/**
 * P3-01 Fault: every member of the closed stop-reason union has a producer, and
 * the two operations that must settle NOTHING settle nothing.
 *
 * Organised around `WorldStopReason` rather than around a list of faults, because
 * the defect this stage exists to prevent is a union member no test ever
 * produces: a caller writing a `switch` over five reasons has no way to learn
 * that one of them never happens.
 *
 * `lost-contact`, `completed` and `provider-failed` are driven through the fake
 * provider on purpose. They are things that HAPPEN to a world, and the local
 * provider is honest that they cannot happen to it — a local world cannot lose
 * contact with itself — so a matrix that could only ask the local provider to
 * terminate would leave three members unproduced.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { TenantId } from '@deepseek-ai/dsh-principal/types'
import { createLocalWorldProvider, LOCAL_WORLD_PROVIDER } from '../src/local-provider.ts'
import { lifetimeExceededReason } from '../src/lifecycle.ts'
import { createFakeWorldProvider, FAKE_WORLD_PROVIDER } from './fake-provider.ts'
import { runWorldProviderConformance } from './conformance.ts'
import { WORLD_STATES } from '../src/types.ts'
import type { WorldHandle, WorldId, WorldSpec, WorldSpecDigest, WorldStopReason } from '../src/types.ts'

const HOST_TENANT = brandString<TenantId>('tenant-host')

/** Every reason the union declares; the matrix below must produce each one. */
const ALL_REASONS: readonly WorldStopReason[] = [
  'completed', 'terminated', 'timeout', 'lost-contact', 'provider-failed',
]

let minted = 0
function ids(): WorldId {
  minted += 1
  return brandString<WorldId>(`world-${String(minted)}`)
}

function digest(spec: WorldSpec): WorldSpecDigest {
  return brandString<WorldSpecDigest>(`digest:${spec.filesystem.effect}:${spec.filesystem.workspaceRoot ?? ''}`)
}

/** A spec the local provider satisfies; the fake satisfies everything. */
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

let clock = 1_000
function local() {
  return createLocalWorldProvider({ tenant: HOST_TENANT, digest, nextWorldId: ids, nowMs: () => clock })
}

function fake(options: { failCreate?: boolean; tenant?: TenantId } = {}) {
  return createFakeWorldProvider({ digest, nextWorldId: ids, ...options })
}

describe('P3-01 validation[3]: every stop reason has a producer', () => {
  const produced = new Set<WorldStopReason>()

  it('settles `terminated` when the CALLER stops a live world', async () => {
    const provider = local()
    const handle = await provider.create(satisfiable())
    const outcome = await provider.terminate(handle)
    expect(outcome.reason).toBe('terminated')
    produced.add(outcome.reason)
  })

  it('settles `timeout` when the lifetime ceiling passes, OUTRANKING the caller\'s own reason', async () => {
    // An expired world is not a failed world, and it is not a terminated one
    // either: the operator who reads `terminated` goes looking for who asked.
    clock = 1_000
    const provider = local()
    const handle = await provider.create(satisfiable({ lifetime: { detached: false, maxWallClockMs: 10 } }))
    clock += 50
    const outcome = await provider.terminate(handle)
    expect(outcome.reason).toBe('timeout')
    expect(outcome.reason).toBe(lifetimeExceededReason())
    produced.add(outcome.reason)
  })

  it('settles `provider-failed` for a failure underneath, which an operator investigates rather than retries', () => {
    const controls = fake()
    return controls.provider.create(satisfiable()).then(async (handle) => {
      const outcome = controls.settleAs(handle, 'provider-failed')
      expect(outcome?.reason).toBe('provider-failed')
      produced.add('provider-failed')
      // The distinction the vocabulary exists for: a timeout and a provider
      // failure are different operator actions, so they must not collapse.
      const other = await controls.provider.create(satisfiable())
      expect(controls.settleAs(other, 'timeout')?.reason).not.toBe(outcome?.reason)
    })
  })

  it('settles `lost-contact` through a provider that CAN lose contact', async () => {
    const controls = fake()
    const handle = await controls.provider.create(satisfiable())
    expect(controls.settleAs(handle, 'lost-contact')?.reason).toBe('lost-contact')
    produced.add('lost-contact')
  })

  it('settles `completed` for a world that finished on its own, the union\'s only non-fault member', async () => {
    const controls = fake()
    const handle = await controls.provider.create(satisfiable())
    expect(controls.settleAs(handle, 'completed')?.reason).toBe('completed')
    produced.add('completed')
  })

  it('leaves NO member of the closed union unproduced, which is what this whole block is for', () => {
    // The case that makes the five above a matrix rather than five unrelated
    // assertions: if a reason is added to the union and nothing produces it,
    // this fails and names it.
    expect([...ALL_REASONS].filter(reason => !produced.has(reason))).toEqual([])
  })

  it('keeps the local provider honest about `lost-contact`, which is the contrast the row above needs', async () => {
    const provider = local()
    const handle = await provider.create(satisfiable())
    const outcome = await provider.terminate(handle)
    expect(outcome.reason).not.toBe('lost-contact')
  })
})

describe('P3-01 acceptance[2]: a refused handle settles nothing at all', () => {
  it('refuses a forged handle WITHOUT producing an outcome, because an outcome would mean it was admitted', async () => {
    const provider = local()
    const real = await provider.create(satisfiable())
    const forged = { id: real.id, provider: LOCAL_WORLD_PROVIDER, spec: real.spec } as unknown as WorldHandle
    await expect(provider.terminate(forged)).rejects.toThrow()
    // And the real world is untouched: a refused operation must not settle the
    // world it was aimed at either.
    await expect(provider.terminate(real)).resolves.toMatchObject({ reason: 'terminated' })
  })

  it('refuses a handle another INSTANCE of the same provider minted, and settles nothing', async () => {
    const mine = local()
    const theirs = local()
    const foreign = await theirs.create(satisfiable())
    await expect(mine.terminate(foreign)).rejects.toThrow()
    // The other instance's world is still live, so the refusal cost nothing.
    await expect(theirs.terminate(foreign)).resolves.toMatchObject({ reason: 'terminated' })
  })
})

describe('P3-01 acceptance[2]: attestation is a READ, and only the provider half is provable here', () => {
  it('produces evidence without stopping the world, so a verifier outage is not an outage', async () => {
    const provider = local()
    const handle = await provider.create(satisfiable())
    const attestation = await provider.attest(handle)
    expect(attestation).toMatchObject({ world: handle.id, provider: LOCAL_WORLD_PROVIDER })
    // The world is still operable afterwards — the whole point of the row.
    await expect(provider.terminate(handle)).resolves.toMatchObject({ reason: 'terminated' })
  })

  it('refuses to attest a handle it did not mint, rather than producing evidence about someone else\'s world', async () => {
    const provider = local()
    const foreign = await fake().provider.create(satisfiable())
    await expect(provider.attest(foreign)).rejects.toThrow()
  })

  // The VERIFIER half is deliberately absent. `sandboxAttestationVerifier`
  // returns false unconditionally (P0-02's inert slot), so a case asserting
  // "the kernel refused this attestation" would pass because the kernel refuses
  // everything — green on an inert slot is the failed-probe shape this program
  // keeps catching. Recorded as open in preflight-P3-01-F.md.
})

describe('P3-01 validation[3]: the state vocabulary is closed, and `stopped` is its only terminal', () => {
  it('declares exactly the four adapted OCI states', () => {
    expect([...WORLD_STATES]).toEqual(['creating', 'created', 'running', 'stopped'])
  })
})

describe('P3-01 validation[1]: the conformance table, against the LOCAL provider', () => {
  runWorldProviderConformance({
    name: 'local',
    provider: local,
    other: local,
    satisfiable: () => satisfiable(),
    refused: () => satisfiable({ network: { posture: 'none' } }),
  })
})

describe('P3-01 validation[1]: the same table, against the FAKE provider', () => {
  runWorldProviderConformance({
    name: 'fake-container',
    provider: () => fake({ tenant: HOST_TENANT }).provider,
    other: () => fake({ tenant: HOST_TENANT }).provider,
    satisfiable: () => satisfiable(),
    // The fake is given a tenant so it HAS something to refuse. A fake that
    // satisfies everything cannot answer "answer for a spec you refuse", and
    // passing a satisfiable spec twice would make the row unable to fail for
    // this subject — the per-provider exception this table does not grant.
    refused: () => satisfiable({ tenant: brandString<TenantId>('tenant-other') }),
  })
})

describe('P3-01: the two providers are distinguishable, which every row above depends on', () => {
  it('names two different providers, so a foreign handle is really foreign', () => {
    expect(FAKE_WORLD_PROVIDER).not.toBe(LOCAL_WORLD_PROVIDER)
  })
})
