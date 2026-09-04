/**
 * Package entry point. Real decision logic for Epic P1-02's plugin
 * signature, source provenance, and dependency SBOM verification: this
 * module combines `./signature.ts`'s digest/source-commit/builder-identity
 * checks with `./sbom.ts`'s SBOM-coverage check into the complete must[1]
 * verification (`verifyPluginProvenance`), adds the offline replay path
 * acceptance[1] requires (`verifyLockedPackageOffline`), and the key-free
 * audit/inventory record acceptance[2] requires (`recordProvenanceAudit`).
 *
 * None of these functions read a file, spawn a process, verify a real
 * signature, or construct a Cordis `Context` — every claim, observed-fact
 * set, and policy input is a plain value the caller supplies, matching this
 * repo's pure-function Contract-stage convention (see
 * `@deepseek-ai/dsh-plugin-manifest`). Usage-stage wires
 * `verifyPluginProvenance`/`admitUnsignedDevMode` into
 * `apps/cli/src/plugin.ts` (real install/verify flow) and
 * `recordProvenanceAudit`'s output into
 * `packages/host/plugin-inventory/src/types.ts` (real Inventory surface) —
 * neither file is this stage's job.
 *
 * @module @deepseek-ai/dsh-plugin-provenance
 */
export type * from './signature.ts'
export type * from './sbom.ts'

export { admitUnsignedDevMode, registerTrustAnchor, verifyPackageSignature } from './signature.ts'
export { computeSbomDigest, generateSbom, verifySbomCoverage } from './sbom.ts'

import { verifyPackageSignature } from './signature.ts'
import { verifySbomCoverage } from './sbom.ts'

import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types'
import type {
  ObservedPackageFacts,
  PackageDigest,
  PackageProvenanceClaim,
  SignatureRejectionReason,
  TrustAnchorId,
} from './signature.ts'
import type { SbomDocument } from './sbom.ts'

/**
 * Why {@link verifyPluginProvenance}/{@link verifyLockedPackageOffline}
 * refused a package: every {@link SignatureRejectionReason} `./signature.ts`
 * decides, plus the SBOM-specific failure `./sbom.ts`'s coverage check
 * decides. `'sbom-coverage-mismatch'` — `verifySbomCoverage` returned
 * `verified: false` (must[1]'s dependency-SBOM check, validation[]'s "检查
 * 所有运行依赖均被列出"). `'sbom-digest-mismatch'` names the SBOM-swapped-
 * after-signing failure (`claim.sbomDigest` not equal to
 * `computeSbomDigest(input.sbom)`) that a later stage's real signer/verifier
 * pairing gates on; {@link verifyPluginProvenance} does not produce it yet —
 * see `./sbom.ts`'s module doc for why this stage's fixtures cannot exercise
 * that equality check.
 */
export type ProvenanceRejectionReason = SignatureRejectionReason | 'sbom-digest-mismatch' | 'sbom-coverage-mismatch'

/**
 * The outcome of {@link verifyPluginProvenance}/{@link verifyLockedPackageOffline}:
 * either every must[1] fact — package digest, source commit, builder
 * identity, and dependency SBOM — checks out and the must[0] evidence
 * verifies against a real trust anchor (`trust: 'trusted'`), or the
 * verification is refused with exactly one {@link ProvenanceRejectionReason}
 * (acceptance[0]'s fail-closed guarantee across all three named attacks).
 */
export type PluginProvenanceVerification =
  | { readonly trust: 'trusted'; readonly trustAnchorId: TrustAnchorId }
  | { readonly trust: 'rejected'; readonly reason: ProvenanceRejectionReason }

/**
 * The complete must[1] input: a signed claim, the facts independently
 * observed about the package, the SBOM document to check `claim.sbomDigest`
 * and dependency coverage against, and the actually-installed dependency
 * names {@link SbomCoverageResult} decides `sbom` against. No field carries
 * a file path, URL, or process handle — every fact is already resolved data,
 * which is what lets {@link verifyLockedPackageOffline} reuse this same
 * shape with no network-shaped parameter added.
 */
export interface PluginProvenanceInput {
  readonly claim: PackageProvenanceClaim
  readonly observed: ObservedPackageFacts
  readonly sbom: SbomDocument
  readonly installedDependencyNames: ReadonlySet<string>
}

/**
 * must[0]/must[1]/acceptance[0]'s full verification entrypoint: combine
 * `./signature.ts`'s `verifyPackageSignature` (digest, source commit,
 * builder identity, must[0] evidence) with `./sbom.ts`'s
 * `computeSbomDigest`/`verifySbomCoverage` (SBOM integrity and coverage)
 * into one fail-closed verdict. Any single mismatch among these four facts
 * — including exactly the three acceptance[0] names (a tampered byte
 * changing `observed.observedDigest`, a swapped `observed.observedSourceCommit`,
 * or a forged `observed.observedBuilderIdentity`) — refuses the whole
 * package; nothing here can pass with some facts unchecked.
 * @param input - the claim, observed facts, SBOM, and installed dependency set to verify.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle every trust anchor is registered under (must[2]/must[3]).
 * @returns `{ trust: 'trusted', trustAnchorId }`, or `{ trust: 'rejected', reason }`.
 */
export function verifyPluginProvenance(
  input: PluginProvenanceInput,
  trustRoot: TrustKernelSignatureRoots,
): PluginProvenanceVerification {
  const signatureResult = verifyPackageSignature(input.claim, input.observed, trustRoot)
  if (!signatureResult.verified) {
    return { trust: 'rejected', reason: signatureResult.reason }
  }
  const coverageResult = verifySbomCoverage(input.sbom, input.installedDependencyNames)
  if (!coverageResult.verified) {
    return { trust: 'rejected', reason: 'sbom-coverage-mismatch' }
  }
  return { trust: 'trusted', trustAnchorId: signatureResult.trustAnchorId }
}

/**
 * acceptance[1]'s offline replay: verify the identical locked package
 * (`locked`, the same {@link PluginProvenanceInput} shape
 * `verifyPluginProvenance` accepts — a package's lockfile-resolved claim,
 * observed facts, and SBOM do not change between an online install and an
 * offline replay of that same lock) with no network-shaped parameter on
 * this function's own signature to weaken that guarantee. Decides the same
 * four must[1] facts the same way {@link verifyPluginProvenance} does.
 * @param locked - the same locked package data an earlier online verification checked.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle, resolvable offline (trust anchors are local data, not a remote lookup).
 * @returns `{ trust: 'trusted', trustAnchorId }`, or `{ trust: 'rejected', reason }`.
 */
export function verifyLockedPackageOffline(
  locked: PluginProvenanceInput,
  trustRoot: TrustKernelSignatureRoots,
): PluginProvenanceVerification {
  return verifyPluginProvenance(locked, trustRoot)
}

/**
 * acceptance[2]'s key-free audit/inventory record: the fields an audit
 * event or `packages/host/plugin-inventory/src/types.ts` Inventory row may
 * carry for one verification. Structurally excludes any key or signature
 * field — no member of this interface can hold `OfflineSignedProvenanceEvidence.signature`,
 * a `publicKeyFingerprint`, or any other key material; `trustAnchorId` is
 * the only trust-anchor reference it carries, an opaque id with no key
 * bytes reachable from it.
 */
export interface ProvenanceAuditRecord {
  /**
   * The digest of the package a verification decided. Absent on an
   * `'unverified'` record: no claim was presented, so there is no claimed
   * digest anything was checked against, and naming one would invent a fact.
   */
  readonly packageDigest?: PackageDigest
  readonly trust: ProvenanceRecordTrust
  readonly reason?: ProvenanceRejectionReason | ProvenanceUnverifiedReason
  readonly trustAnchorId?: TrustAnchorId
  /** ISO 8601 timestamp of when the recorded state was decided. */
  readonly verifiedAt: string
}

/**
 * Why no verification could be decided for a package.
 * `'no-provenance-claim'` — the package ships no {@link PackageProvenanceClaim}
 * at all, so there was nothing to verify. This is the true state of every
 * package installed in this repository today, and it is distinct from every
 * {@link ProvenanceRejectionReason}: nothing was refused, because nothing was
 * presented.
 */
export type ProvenanceUnverifiedReason = 'no-provenance-claim'

/**
 * The three states a {@link ProvenanceAuditRecord} can report:
 * `'trusted'`/`'rejected'` for the two outcomes
 * {@link PluginProvenanceVerification} decides, and `'unverified'` for a
 * package that presented no claim to decide on.
 */
export type ProvenanceRecordTrust = 'trusted' | 'rejected' | 'unverified'

/**
 * acceptance[2]'s recording entrypoint for a package that presented no claim:
 * record the state it actually has rather than a refusal that never happened.
 * @param reason - why no verification could be decided.
 * @param verifiedAt - ISO 8601 timestamp of when that was decided.
 * @returns a {@link ProvenanceAuditRecord} with `trust: 'unverified'`, carrying neither a package digest nor a trust anchor id.
 */
export function recordUnverifiedProvenance(
  reason: ProvenanceUnverifiedReason,
  verifiedAt: string,
): ProvenanceAuditRecord {
  // Neither `packageDigest` nor `trustAnchorId` is set at all, rather than set
  // to a placeholder: no claim was presented, so there is no claimed digest
  // and no anchor, and an absent field is the only honest report of that.
  return { trust: 'unverified', reason, verifiedAt }
}

/**
 * acceptance[2]'s sole recording entrypoint: derive a {@link ProvenanceAuditRecord}
 * from `verification` — never from the {@link PluginProvenanceInput}'s
 * `claim.evidence` directly, so a caller cannot construct a record carrying
 * key material `PluginProvenanceVerification` itself never exposes.
 * @param packageDigest - the digest of the package `verification` decided.
 * @param verification - the outcome to record.
 * @param verifiedAt - ISO 8601 timestamp of the decision.
 * @returns a {@link ProvenanceAuditRecord} naming the verdict and, on rejection, the reason — never a key.
 */
export function recordProvenanceAudit(
  packageDigest: PackageDigest,
  verification: PluginProvenanceVerification,
  verifiedAt: string,
): ProvenanceAuditRecord {
  if (verification.trust === 'trusted') {
    return { packageDigest, trust: 'trusted', trustAnchorId: verification.trustAnchorId, verifiedAt }
  }
  return { packageDigest, trust: 'rejected', reason: verification.reason, verifiedAt }
}
