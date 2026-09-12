/**
 * The provider conformance table (P3-01 validation[1]).
 *
 * Five obligations every `WorldProvider` owes regardless of what it confines,
 * run against every provider this repository ships plus the fake. **Two
 * providers passing one table is what makes it a contract**; one provider
 * passing it would only describe that provider.
 *
 * There is deliberately no per-provider exception hook. A table with an
 * exception is a table admitting it describes one implementation, so a provider
 * that fails a row is a defect in the row or in the provider — never a reason to
 * widen the table (the delegate's ruling on this epic's F preFlight).
 *
 * What is NOT here: anything about which dimensions a provider satisfies. That
 * is each provider's own honest answer and is covered by its own cases; this
 * table asks only that the answer be total, that handles be owned, and that a
 * stop settle once.
 * @module
 */

import { expect, it } from 'vitest'
import { isLegalWorldTransition } from '../src/lifecycle.ts'
import type { WorldHandle, WorldProvider, WorldSpec } from '../src/types.ts'

/** One provider under test, and the two specs the table needs from it. */
export interface ConformanceSubject {
  /** How the provider is named in case titles. */
  readonly name: string
  /** A fresh provider instance; called per case so no state leaks between them. */
  provider(): WorldProvider
  /** A second instance, for the foreign-handle obligation. */
  other(): WorldProvider
  /** A spec this provider satisfies. */
  satisfiable(): WorldSpec
  /** A spec this provider refuses, so the total-answer obligation has both sides. */
  refused(): WorldSpec
}

/**
 * Register the five obligations for one provider.
 *
 * Called inside a `describe` by each provider's own spec file, so a failure
 * names the provider rather than a shared suite.
 * @param subject - the provider and the two specs the table drives it with.
 */
export function runWorldProviderConformance(subject: ConformanceSubject): void {
  it('answers the dimension question for a spec it accepts AND one it refuses, so the answer is total', () => {
    const provider = subject.provider()
    expect(provider.unsatisfiableDimensions(subject.satisfiable())).toEqual([])
    // A provider that answered only for what it accepts would let selection
    // read "no unmet dimensions" as "satisfiable" for a spec it cannot build.
    expect(provider.unsatisfiableDimensions(subject.refused()).length).toBeGreaterThan(0)
  })

  it('accepts the handle it minted and refuses one another INSTANCE minted', async () => {
    const provider = subject.provider()
    const foreign = await subject.other().create(subject.satisfiable())
    const mine = await provider.create(subject.satisfiable())
    await expect(provider.terminate(mine)).resolves.toMatchObject({ world: mine.id })
    // Same provider id, same shape, different minting instance: ownership is by
    // identity, not by what the handle says about itself.
    await expect(provider.terminate(foreign)).rejects.toThrow()
  })

  it('settles ONE outcome however many times it is asked to stop', async () => {
    const provider = subject.provider()
    const handle = await provider.create(subject.satisfiable())
    const first = await provider.terminate(handle)
    const second = await provider.terminate(handle)
    // Not merely "both succeeded": the SAME outcome. A second stop that
    // produced a second outcome would give one world two endings, and a
    // recovery path that retries would record the later one.
    expect(second).toEqual(first)
  })

  it('never admits a transition out of `stopped`, which is the lifecycle table both providers share', () => {
    // The table is the seam's, not the provider's, so this row asserts the
    // provider has no private opinion about it.
    expect(isLegalWorldTransition('stopped', 'running')).toBe(false)
    expect(isLegalWorldTransition('stopped', 'created')).toBe(false)
    expect(isLegalWorldTransition('stopped', 'creating')).toBe(false)
  })

  it('reports a stopped world\'s snapshot AS stopped, and refuses another provider\'s snapshot outright', async () => {
    // A first draft asserted that snapshotting a stopped world is refused. It
    // is not, and the contract is right: `restore` mints a NEW world from a
    // snapshot, so a point taken after the world stopped is exactly what a
    // caller restores from. What the snapshot must not do is claim the world is
    // still running.
    const provider = subject.provider()
    const handle = await provider.create(subject.satisfiable())
    const live = await provider.snapshot(handle)
    expect(live.state).not.toBe('stopped')
    await provider.terminate(handle)
    expect((await provider.snapshot(handle)).state).toBe('stopped')
    // A snapshot naming another provider is refused whatever it contains:
    // restoring it would put this provider's confinement on someone else's
    // world.
    await expect(provider.restore({ ...live, provider: foreignProviderId(live.provider) })).rejects.toThrow()
  })
}

/** A provider id that is certainly not the one given, for the foreign-snapshot obligation. */
function foreignProviderId(mine: WorldHandle['provider']): WorldHandle['provider'] {
  return `${mine}-from-somewhere-else` as WorldHandle['provider']
}
