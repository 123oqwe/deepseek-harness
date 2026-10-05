/**
 * RF3 — four-element invoke frame (acceptance[2]). Assertions from the blind
 * red-first spec §RF3: every host→plugin `tool.invoke` is host-stamped with
 * principal / capability (digest + resources + expiry, never a signed token) /
 * deadline / traceId, and the plugin cannot fill or override them. The staging
 * plugin echoes the received params back so the driver captures the frame.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.rf3
 */

import { describe, expect, it } from 'vitest'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

describe('P1-06 slice 1 RF3: four-element invoke frame', () => {
  it('host-stamps all four elements, keeps capability a digest, and ignores plugin-supplied overrides', async () => {
    const h = await startHarness('rf3')
    try {
      await h.waitRegistered()
      expect(h.toolNames()).toContain('echo')
      // Dispatch the proxy through the real ToolRuntime path; the args try to supply their own
      // principal/traceId, which the host must not honor.
      const result = await h.execute('echo', { principal: 'attacker', traceId: 'attacker-trace' })
      expect(result.isError).toBe(false)

      // Assertion 1: the captured tool.invoke frame carries all four host-stamped elements.
      expect(h.invokeFrames).toHaveLength(1)
      const frame = h.invokeFrames[0]!
      expect(frame.principal).toBe('test-principal')
      expect(frame.capability).toBeDefined()
      expect(typeof frame.deadlineMs).toBe('number')
      expect(typeof frame.traceId).toBe('string')
      expect(frame.traceId.length).toBeGreaterThan(0)

      // Assertion 2: capability is a digest view (digest + resources + expiry), with no signed token on the frame.
      expect(frame.capability.digest).toBe('test-capability-digest')
      expect(frame.capability.resources).toContain('echo')
      expect(typeof frame.capability.expiresAtMs).toBe('number')
      const capabilityKeys = Object.keys(frame.capability)
      expect(capabilityKeys.sort()).toEqual(['digest', 'expiresAtMs', 'resources'])

      // Assertion 3: the plugin's own args cannot fill or override the host-stamped identity.
      expect(frame.principal).not.toBe('attacker')
      expect(frame.traceId).not.toBe('attacker-trace')
    } finally {
      await h.stop()
    }
  })
})
