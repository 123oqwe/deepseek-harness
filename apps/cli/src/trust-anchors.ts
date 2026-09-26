/**
 * The trust anchors a profile admits for plugin provenance (Epic P1-02
 * must[2]): read from the profile's own `package.json` `dsh.trustAnchors`, so
 * `dsh plugin add` and the profile's boot build their trust kernel from the
 * same field. An absent field is zero anchors; a malformed one fails loud.
 * @module @deepseek-ai/dsh/trust-anchors
 */

import { join } from 'node:path'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import type { TrustKernelTrustAnchor } from '@deepseek-ai/dsh-trust-kernel'

const NAME = 'dsh'

/**
 * Read and validate one profile's trust anchors.
 * @param profileDir - the profile directory whose `package.json` declares them.
 * @returns the anchors, in declaration order; empty when the profile declares none.
 * @throws when `dsh.trustAnchors` is present but not an array of complete anchors.
 */
export function readProfileTrustAnchors(profileDir: string): readonly TrustKernelTrustAnchor[] {
  const declared = readProfileManifest(NAME, profileDir).dsh?.trustAnchors
  if (declared === undefined) return []
  const where = `${join(profileDir, 'package.json')} dsh.trustAnchors`
  if (!Array.isArray(declared)) throw new Error(`${NAME}: ${where} must be an array of trust anchors`)
  return declared.map((anchor: unknown, index) => toTrustAnchor(anchor, `${where}[${index}]`))
}

/**
 * Validate one declared anchor.
 * @param anchor - the parsed JSON value.
 * @param where - the file and field path, for the error.
 * @returns the anchor, carrying public material only.
 * @throws when a required field is missing or not a non-empty string.
 */
function toTrustAnchor(anchor: unknown, where: string): TrustKernelTrustAnchor {
  const fields = typeof anchor === 'object' && anchor !== null ? anchor as Record<string, unknown> : {}
  const text = (field: string): string => {
    const value = fields[field]
    if (typeof value !== 'string' || value === '') throw new Error(`${NAME}: ${where}.${field} must be a non-empty string`)
    return value
  }
  if (fields.mode === 'offline-signed') {
    return {
      mode: 'offline-signed',
      publicKeyFingerprint: text('publicKeyFingerprint'),
      owner: text('owner'),
      publicKeyPem: text('publicKeyPem'),
    }
  }
  if (fields.mode === 'sigstore') {
    return {
      mode: 'sigstore',
      trustedIssuer: text('trustedIssuer'),
      ...fields.trustedRoot === undefined ? {} : { trustedRoot: fields.trustedRoot },
    }
  }
  throw new Error(`${NAME}: ${where}.mode must be "offline-signed" or "sigstore"`)
}
