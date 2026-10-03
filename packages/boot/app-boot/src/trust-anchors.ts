/**
 * The Trust-Kernel launch posture shared by the app bins: the profile's own
 * `dsh.trustAnchors` (Epic P1-02 must[2]), the insecure-boot opt-in, and the
 * fail-closed/insecure-opt-in posture check (Epic P0-02 must[1], acceptance
 * clause 3). The `dsh` launcher and the Electron Desktop Host build their Trust
 * Kernel from this one copy, so a project boots the same way through either
 * entry; the error text is the entry's own name so each refusal names the
 * launcher that raised it.
 * @module @deepseek-ai/dsh-app-boot/trust-anchors
 */

import { join } from 'node:path'
import type { TrustKernelTrustAnchor } from '@deepseek-ai/dsh-trust-kernel'
import { readProfileManifest } from './profile.ts'

const NAME = 'dsh'

/** Env var whose non-empty value opts a development boot into skipping Trust Kernel initialization. */
export const TRUST_KERNEL_INSECURE_ENV = 'DSH_TRUST_KERNEL_INSECURE'

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

/**
 * Resolve the Trust Kernel insecure-boot opt-in (Epic P0-02 acceptance
 * clause 3). ANY non-empty value opts in: the deliberate value is presence,
 * not absence, because skipping a security control must be an explicit
 * developer choice, never an accidental empty-string default.
 * @param raw - the raw DSH_TRUST_KERNEL_INSECURE value.
 * @returns whether this boot may proceed without a pinned Trust Kernel.
 */
export function resolveTrustKernelInsecureOptIn(raw: string | undefined): boolean {
  return (raw ?? '') !== ''
}

/**
 * Enforce Epic P0-02's fail-closed/insecure-opt-in split (must[1],
 * acceptance clause 3) once host preparation has had its chance to pin
 * `trustKernel`. A production boot (no opt-in) with no pinned kernel
 * refuses to continue; an opted-in development boot prints a permanent
 * warning -- every boot while the opt-in is set, not once -- and proceeds.
 * @param initialized - whether `ctx.get('trustKernel')` returned a value after preparation.
 * @param insecureOptIn - the resolved {@link resolveTrustKernelInsecureOptIn} value.
 * @param warn - sink for the permanent insecure-mode warning; defaults to a stderr write.
 * @param name - the launcher name the refusal and warning name; defaults to the `dsh` bin.
 * @throws when uninitialized without the insecure opt-in.
 */
export function enforceTrustKernelPosture(
  initialized: boolean,
  insecureOptIn: boolean,
  warn: (message: string) => void = (message) => { process.stderr.write(message) },
  name: string = NAME,
): void {
  if (initialized) return
  if (!insecureOptIn) {
    throw new Error(`${name}: Trust Kernel not initialized -- refusing to boot (set ${TRUST_KERNEL_INSECURE_ENV} to explicitly opt into an insecure development boot)`)
  }
  warn(`${name}: WARNING: booting with no Trust Kernel (${TRUST_KERNEL_INSECURE_ENV} set) -- root identity, signature roots, policy enforcement, audit append, secret broker, and sandbox attestation are all unavailable; never use in production.\n`)
}
