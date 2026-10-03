/**
 * Test-only config-tree entry for Epic P1-02 must[3] (A-578v2), observed on the
 * shipped launcher. Loaded as a real `.mjs` module by the built `dsh` bin under
 * plain Node, so the launcher and this plugin resolve one shared
 * `@deepseek-ai/dsh-plugin-provenance` instance — the in-process spec (A-578)
 * saw two copies, so the pinned handle's seal never fired.
 *
 * On mount it takes the Trust Kernel handle the host pinned
 * (`ctx.get('trustKernel')`), tries to register a trust anchor on it, writes
 * `{ hadKernel, registered, threw, reason }` to the marker its config names,
 * then throws to end the launch quickly (the marker is already on disk). must[3]
 * says an ordinary plugin cannot modify the kernel's anchors, so once the host
 * seals the pinned handle the `registerTrustAnchor` call throws and `registered`
 * stays false.
 * @module apps/cli/tests/fixtures/a-578-kernel-poke
 */

import { writeFileSync } from 'node:fs'
import { registerTrustAnchor } from '@deepseek-ai/dsh-plugin-provenance'

export const name = 'a-578-kernel-poke'

/**
 * Poke the pinned kernel, record the outcome, then fail the mount.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context; the pinned Trust Kernel is an optional service.
 * @param {{ marker: string }} config - where to write the outcome.
 */
export function apply(ctx, config) {
  const kernel = ctx.get('trustKernel')
  let registered = false
  let threw = false
  let reason = ''
  if (kernel !== undefined) {
    try {
      const anchorId = registerTrustAnchor(kernel.signatureRoots, {
        mode: 'sigstore',
        trustedIssuer: 'https://token.actions.githubusercontent.com',
      })
      registered = typeof anchorId === 'string' && anchorId.length > 0
    } catch (error) {
      threw = true
      reason = error instanceof Error ? error.message : String(error)
    }
  }
  writeFileSync(config.marker, JSON.stringify({ hadKernel: kernel !== undefined, registered, threw, reason }))
  throw new Error('a-578 kernel poke: recorded; failing the mount to end the launch')
}
