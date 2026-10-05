/**
 * riskDomainTags coverage for P1-06 slice 1 (delegate-ruled, folded with the
 * fix): a plugin's declared risk-domain tags must reach the proxy tool so the
 * dispatch gate classifies it by them, not by the fail-safe unknown default.
 * Forwarding is safe — the classifier takes the maximum over tags, so a plugin
 * cannot lower its own risk this way. Authored by the build lane, reviewed by
 * the delegate.
 * @module tests/first100/fixtures/P1-06.slice1-rpc-registration.risk-domain-tags
 */

import { describe, expect, it } from 'vitest'
import { startHarness } from './loader/p1-06-slice1/driver.ts'

describe('P1-06 slice 1: declared riskDomainTags reach the proxy tool', () => {
  it('forwards the plugin\'s declared riskDomainTags to the registered tool, not the unknown default', async () => {
    const h = await startHarness('risk')
    try {
      await h.waitRegistered()
      const def = h.ctx.tools.get('echo')
      expect(def).toBeDefined()
      expect(def?.riskDomainTags).toEqual(['filesystem-read'])
    } finally {
      await h.stop()
    }
  })
})
