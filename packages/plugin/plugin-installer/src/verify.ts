/**
 * Provenance verification of the quarantined package (P1-02, already ACCEPTED).
 * The observed package digest is recomputed from the tarball bytes here — never
 * trusted from the assertion beside them — so a tampered byte is a real
 * rejection (acceptance[0]). The source commit and builder identity are the
 * caller's independent observations (the registry and build system), not read
 * from the untrusted package.
 * @module @deepseek-ai/dsh-plugin-installer/verify
 */

import { computePackageDigest, verifyPluginProvenance } from '@deepseek-ai/dsh-plugin-provenance'
import type { PluginProvenanceInput, TrustAnchorId } from '@deepseek-ai/dsh-plugin-provenance'
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types'
import { PluginInstallError } from './errors.ts'
import type { ProvenanceAssertion } from './types.ts'

/**
 * Verify the untrusted package bytes against their provenance.
 * @param tarball - the untrusted package bytes; its digest is recomputed here.
 * @param assertion - the signed claim, SBOM, dependency set, and observed source/builder facts.
 * @param trustRoot - the trust kernel's signature roots every admitted anchor is registered under.
 * @returns the trust anchor id the package verified against.
 * @throws PluginInstallError('provenance-rejected') carrying the P1-02 reason when verification fails.
 */
export function verifyPackage(
  tarball: Uint8Array,
  assertion: ProvenanceAssertion,
  trustRoot: TrustKernelSignatureRoots,
): TrustAnchorId {
  const input: PluginProvenanceInput = {
    claim: assertion.claim,
    observed: {
      observedDigest: computePackageDigest(tarball),
      observedSourceCommit: assertion.observedSourceCommit,
      observedBuilderIdentity: assertion.observedBuilderIdentity,
    },
    sbom: assertion.sbom,
    installedDependencyNames: assertion.installedDependencyNames,
  }
  const verification = verifyPluginProvenance(input, trustRoot)
  if (verification.trust === 'rejected') {
    throw new PluginInstallError('provenance-rejected', `provenance rejected: ${verification.reason}`)
  }
  return verification.trustAnchorId
}
