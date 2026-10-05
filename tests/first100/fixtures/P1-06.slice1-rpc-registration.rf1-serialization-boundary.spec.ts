/**
 * RF1 — serialization boundary (must[2]). Assertions from the blind red-first
 * spec §RF1: a plugin registers over a real subprocess JSON-RPC; only JSON
 * crosses, pure data registers, and no plugin-provided callback reaches the
 * proxy. Driver/staging are the build lane's; the assertions are the red-first
 * author's, unchanged.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.rf1
 */

import { describe, expect, it } from 'vitest'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

describe('P1-06 slice 1 RF1: serialization boundary', () => {
  it('registers only pure JSON data and keeps every callback host-fixed; no plugin reference crosses', async () => {
    const h = await startHarness('rf1')
    try {
      await h.waitRegistered()
      // Assertion 2: the pure-data tool (valid name + two serializable schemas) registers and is visible in the host inventory.
      expect(h.toolNames()).toContain('echo')
      const def = h.ctx.tools.get('echo')
      expect(def).toBeDefined()
      // Assertion 1 + 3: the proxy carries host-fixed projections only. The plugin's smuggled
      // callback-named fields (finalizeContent / presentationMeta / isConcurrencySafe, which a
      // function cannot even be as JSON) did NOT become the tool's callbacks — what reached the
      // host is JSON, with no plugin-provided function or object reference wired in.
      expect(typeof def?.output.render).toBe('function')
      expect(def?.output.presentationMeta).toBeUndefined()
      expect(def?.finalizeContent).toBeUndefined()
      expect(def?.isConcurrencySafe).toBeUndefined()
    } finally {
      await h.stop()
    }
  })
})
