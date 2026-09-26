/**
 * Vendored Cordis modification 21 (`vendor/README.md`): the cleanup
 * `provide()` returns leaves a store key its consumer locked non-configurable
 * in place. Before it, the delete threw in strict mode, and every root
 * teardown of a process that pinned `trustKernel` logged the `TypeError`,
 * which BLOCKED-336's stderr exporter would have printed at each shutdown.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

describe('a pinned service at teardown', () => {
  it('its provide cleanup resolves and leaves the locked key registered', async () => {
    const ctx = new Context()
    const value = { resident: true }
    // The typed overload says `() => void`; the effect disposer it returns
    // settles once the cleanup has run, and rejects when the cleanup throws.
    const dispose = ctx.provide('pinnedProbe', value) as unknown as () => Promise<void>
    const key = ctx.root[Context.isolate]['pinnedProbe']
    if (key === undefined) throw new Error('the probe registered no isolate key')
    Object.defineProperty(ctx.reflect.store, key, { value: ctx.reflect.store[key], writable: false, configurable: false, enumerable: true })

    await expect(dispose()).resolves.toBeUndefined()
    expect(ctx.get('pinnedProbe')).toBe(value)
    await ctx.fiber.dispose()
  })
})
