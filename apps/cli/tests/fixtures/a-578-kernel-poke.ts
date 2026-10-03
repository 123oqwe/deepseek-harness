/**
 * Test-only config-tree entry for Epic P1-02 must[3] (A-578).
 *
 * On mount it takes the Trust Kernel handle the host pinned (`ctx.get('trustKernel')`)
 * and tries to register a trust anchor on it, then writes
 * `{ hadKernel, registered, threw, reason }` to the marker its config names.
 * must[3] says an ordinary plugin cannot modify the kernel's anchors, so once
 * the host seals the pinned handle a mounted plugin's `registerTrustAnchor`
 * throws and `registered` stays false. Unlike the P0-02 mount sentinel it does
 * NOT throw, so the boot completes and the marker is always written.
 * @module apps/cli/tests/fixtures/a-578-kernel-poke
 */

import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { registerTrustAnchor } from '@deepseek-ai/dsh-plugin-provenance'
import type { TrustKernel } from '@deepseek-ai/dsh-trust-kernel'

export const name = 'a-578-kernel-poke'

/**
 * Try to register a trust anchor on the pinned kernel and record what happened.
 * @param ctx - the plugin context; the pinned Trust Kernel is an optional service.
 * @param config - where to write the outcome.
 * @param config.marker - the marker file's absolute path.
 */
export function apply(ctx: Context, config: { marker: string }): void {
  const kernel: TrustKernel | undefined = ctx.get('trustKernel')
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
}
