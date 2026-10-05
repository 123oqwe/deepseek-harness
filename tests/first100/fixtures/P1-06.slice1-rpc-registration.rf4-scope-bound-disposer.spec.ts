/**
 * RF4 — scope-bound disposer (acceptance[1]). Assertions from the blind
 * red-first spec §RF4: the plugin's registrations are bound to the host session
 * and revoked when it is disposed, with no zombie, and the disposal is the same
 * whether the host exited normally or its child was killed.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.rf4
 */

import { describe, expect, it } from 'vitest'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

describe('P1-06 slice 1 RF4: scope-bound disposer', () => {
  it('revokes the plugin registration on host disposal, with no zombie, identically across exit paths', async () => {
    // Normal / disposer path.
    const normal = await startHarness('rf4')
    try {
      await normal.waitRegistered()
      expect(normal.toolNames()).toContain('echo')
      normal.disposeHost()
      // Assertion 1 + 2: after the host disposes, the tool is gone from the inventory — no zombie registration remains.
      expect(normal.toolNames()).not.toContain('echo')
    } finally {
      await normal.stop()
    }

    // Assertion 3: the killed-child path disposes identically.
    const killed = await startHarness('rf4')
    try {
      await killed.waitRegistered()
      expect(killed.toolNames()).toContain('echo')
      killed.killChild()
      killed.disposeHost()
      expect(killed.toolNames()).not.toContain('echo')
    } finally {
      await killed.stop()
    }
  })
})
