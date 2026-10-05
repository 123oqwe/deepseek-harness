/**
 * RF2 — manifest-declared + fail-closed (m1 + §10d). Assertions from the blind
 * red-first spec §RF2: an undeclared tool name is refused and the whole host is
 * closed, revoking the plugin's prior registrations. The rf2 staging registers
 * a valid declared tool first so the fail-closed close has a prior registration
 * to revoke.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.rf2
 */

import { describe, expect, it } from 'vitest'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 25))

describe('P1-06 slice 1 RF2: manifest-declared + fail-closed', () => {
  it('refuses an undeclared tool name, closes the host, and revokes the prior registration', async () => {
    const h = await startHarness('rf2')
    try {
      await h.waitRegistered()
      await settle() // let the fail-closed close() and its registration disposal complete
      // Assertion 1: the undeclared name is refused — it never enters the inventory.
      expect(h.toolNames()).not.toContain('not-declared')
      // Assertion 2 + 3: the host is judged in protocol violation and closed (fail-closed), so the
      // plugin's prior 'echo' registration is revoked — no tool from this host survives (no zombie).
      expect(h.toolNames()).not.toContain('echo')
    } finally {
      await h.stop()
    }
  })
})
