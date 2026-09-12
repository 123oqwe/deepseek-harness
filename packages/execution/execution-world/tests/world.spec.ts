import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { TenantId } from '@deepseek-ai/dsh-principal'
import {
  isLegalWorldTransition,
  lifetimeExceededReason,
  mayRestoreInto,
  missingWorldSpecDimensions,
  selectWorldProvider,
  WORLD_SPEC_DIMENSIONS,
  WORLD_STATES,
  type WorldProvider,
  type WorldProviderId,
  type WorldSpec,
  type WorldSpecDimension,
  type WorldState,
} from '@deepseek-ai/dsh-execution-world'

/** A complete spec: every one of the nine dimensions answered. */
function completeSpec(): WorldSpec {
  return {
    filesystem: { effect: 'workspace-write', workspaceRoot: '/w' },
    network: { posture: 'none' },
    process: { spawn: true, maxProcesses: 8 },
    ipc: { posture: 'parent-only' },
    devices: { allowed: [] },
    secrets: { posture: 'broker-only' },
    resources: { memoryBytes: 512 * 1024 * 1024 },
    lifetime: { detached: false, maxWallClockMs: 60_000 },
    tenant: TenantId('t-1'),
  }
}

/** A provider that refuses exactly the named dimensions and nothing else. */
function providerRefusing(id: string, unmet: readonly WorldSpecDimension[]): WorldProvider {
  return {
    id: brandString<WorldProviderId>(id),
    unsatisfiableDimensions: () => unmet,
    create: () => { throw new Error('contract stage: no provider creates worlds') },
    terminate: () => { throw new Error('contract stage') },
    snapshot: () => { throw new Error('contract stage') },
    restore: () => { throw new Error('contract stage') },
    attest: () => { throw new Error('contract stage') },
  }
}

describe('P3-01 must[1]: a WorldSpec decides all nine confinement dimensions', () => {
  it('names exactly the nine dimensions the epic requires, so a tenth cannot arrive unnoticed', () => {
    expect([...WORLD_SPEC_DIMENSIONS]).toEqual([
      'filesystem', 'network', 'process', 'ipc', 'devices', 'secrets', 'resources', 'lifetime', 'tenant',
    ])
  })

  it('reports every unanswered dimension, not just the first', () => {
    // The count matters: a check that stopped at the first gap would let a
    // caller fix one dimension at a time and believe each fix was the last.
    expect(missingWorldSpecDimensions({})).toEqual([...WORLD_SPEC_DIMENSIONS])
  })

  it('accepts a complete spec, which is the control a reject-everything check would fail', () => {
    expect(missingWorldSpecDimensions(completeSpec())).toEqual([])
  })

  it('treats a deliberate `none` as answered, so refusing a capability is not the same as forgetting it', () => {
    const spec = { ...completeSpec(), network: { posture: 'none' } as const }
    expect(missingWorldSpecDimensions(spec)).toEqual([])
  })
})

describe('P3-01 must[0]: the lifecycle states are the OCI ordering, and `stopped` is terminal', () => {
  it('declares the four adapted states and not OCI `paused`, which nothing here can enter', () => {
    expect([...WORLD_STATES]).toEqual(['creating', 'created', 'running', 'stopped'])
  })

  it('admits the forward edges a real world walks', () => {
    expect(isLegalWorldTransition('creating', 'created')).toBe(true)
    expect(isLegalWorldTransition('created', 'running')).toBe(true)
    expect(isLegalWorldTransition('running', 'stopped')).toBe(true)
  })

  it('admits stopping from every non-terminal state, because a world can fail before it runs', () => {
    expect(isLegalWorldTransition('creating', 'stopped')).toBe(true)
    expect(isLegalWorldTransition('created', 'stopped')).toBe(true)
  })

  it('refuses every edge out of `stopped`, so one WorldId never names two confinements', () => {
    for (const to of WORLD_STATES) {
      expect(isLegalWorldTransition('stopped', to), `stopped -> ${to}`).toBe(false)
    }
  })

  it('refuses backward and skipping edges, which is what makes the table a decision', () => {
    const illegal: readonly (readonly [WorldState, WorldState])[] = [
      ['created', 'creating'], ['running', 'created'], ['running', 'creating'],
      ['creating', 'running'], ['creating', 'creating'], ['running', 'running'],
    ]
    for (const [from, to] of illegal) {
      expect(isLegalWorldTransition(from, to), `${from} -> ${to}`).toBe(false)
    }
  })
})

describe('P3-01 acceptance[1]: no provider satisfying the policy fails closed, never degrades', () => {
  it('selects the first satisfying provider in the deployment’s own order', () => {
    const chosen = providerRefusing('p-ok', [])
    const result = selectWorldProvider(completeSpec(), [chosen, providerRefusing('p-also', [])])
    expect(result.outcome).toBe('selected')
    expect(result.outcome === 'selected' && result.provider.id).toBe('p-ok')
  })

  it('refuses when every provider misses a dimension, and names what each missed', () => {
    const result = selectWorldProvider(completeSpec(), [
      providerRefusing('p-a', ['network']),
      providerRefusing('p-b', ['devices', 'secrets']),
    ])
    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' && result.reason).toBe('unsatisfiable')
    expect(result.outcome === 'refused' && result.unsatisfiable).toEqual({
      'p-a': ['network'],
      'p-b': ['devices', 'secrets'],
    })
  })

  it('does NOT fall back to a provider that misses fewer dimensions, which is the degradation acceptance[1] forbids', () => {
    // p-b misses one dimension and p-a misses three. A "closest provider"
    // selector would pick p-b and hand back a world with no secrets broker.
    const result = selectWorldProvider(completeSpec(), [
      providerRefusing('p-a', ['network', 'devices', 'secrets']),
      providerRefusing('p-b', ['secrets']),
    ])
    expect(result.outcome).toBe('refused')
  })

  it('refuses with `no-provider` when none is registered, distinct from every-provider-unsatisfiable', () => {
    const result = selectWorldProvider(completeSpec(), [])
    expect(result.outcome === 'refused' && result.reason).toBe('no-provider')
  })

  it('refuses an incomplete spec before any provider is consulted, so no provider fills the gap', () => {
    // Built without `secrets` rather than deleted from a complete spec: the
    // field is readonly, and a delete would need a cast that hides the very
    // shape this case is about.
    const { secrets: _omitted, ...partial } = completeSpec()
    let asked = false
    const watcher: WorldProvider = {
      ...providerRefusing('p-watch', []),
      unsatisfiableDimensions: () => { asked = true; return [] },
    }
    const result = selectWorldProvider(partial, [watcher])
    expect(result.outcome === 'refused' && result.reason).toBe('incomplete-spec')
    expect(asked, 'a provider must not be consulted about an incomplete spec').toBe(false)
  })
})

describe('P3-01 must[0]: a restore may narrow and never widen', () => {
  it('admits a restore into the same confinement', () => {
    expect(mayRestoreInto('digest-a', 'digest-a')).toBe(true)
  })

  it('refuses a restore into a different confinement, which is how a weaker snapshot would widen one', () => {
    expect(mayRestoreInto('full-access-digest', 'read-only-digest')).toBe(false)
  })
})

describe('P3-01 validation[3]: a stopped world settles to one typed outcome whatever stopped it', () => {
  it('names an expired lifetime `timeout`, distinct from `provider-failed`', () => {
    // An operator retries a timeout and investigates a provider failure, so
    // collapsing them into one reason would make the outcome unactionable.
    expect(lifetimeExceededReason()).toBe('timeout')
    expect(lifetimeExceededReason()).not.toBe('provider-failed')
  })
})
