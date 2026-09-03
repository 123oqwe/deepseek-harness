/**
 * Decision logic for Epic P1-02's plugin signature and provenance
 * verification: the Sigstore-style identity/provenance or organization
 * offline-signing evidence a package carries (must[0]), the package digest /
 * source commit / builder identity facts a claim is checked against (must[1]'s
 * first three of four checks — `./sbom.ts` owns the fourth), and the
 * explicit-dev-profile-gated `unsigned-dev` fallback (must[4]).
 *
 * **What the `trustRoot` parameter does, and what it does not.** Every
 * verification and registration function below takes a
 * {@link TrustKernelSignatureRoots} handle, and this module uses it as a
 * `WeakMap` key and nothing else: it scopes which registered trust anchors a
 * verification can see, so anchors admitted under one `createTrustKernel()`
 * call are invisible to another. Its CONTENTS are never read, and there are
 * none to read — `createTrustKernel()` mints `signatureRoots` as
 * `Object.freeze({})`, holding no key material, which is exactly why an empty
 * frozen object serves as one. Consequently must[2] ("TrustKernel 持有可信根")
 * is NOT satisfied by this module and must not be reported as such
 * (BLOCKED-050). must[3] ("普通插件不能修改") holds only in its structural
 * sense: no function here accepts a plugin-supplied substitute, and no
 * ordinary caller can construct a handle — but a root that cannot be swapped
 * is still an empty root.
 *
 * **No function in this module verifies a signature.**
 * {@link verifyPackageSignature} compares claimed facts against observed ones
 * and then checks only that the evidence's fields are non-empty;
 * `OfflineSignedProvenanceEvidence.signature` is never checked against a key,
 * and an issuer or fingerprint no {@link registerTrustAnchor} call ever
 * admitted is trusted on first sight. {@link computePackageDigest} is the one
 * real cryptographic operation here, and it binds an artifact to a claim, not
 * a claim to an authority. See the package README's Known Limitations.
 *
 * **Grounding.** {@link PackageDigest}, {@link SourceCommitHash},
 * {@link BuilderIdentity}, and {@link TrustAnchorId} have no branded-type
 * precedent in this repo; each follows the `Branded<B>` idiom from
 * `@deepseek-ai/dsh-brand` per this repo's opaque-cross-boundary-id rule.
 *
 * @module @deepseek-ai/dsh-plugin-provenance/signature
 */

import { createHash, randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types'
import type { SbomDigest } from './sbom.ts'

/** Content digest of an installed package tarball (must[1]'s "package digest"). */
export type PackageDigest = Branded<'PackageDigest'>

/**
 * Recompute a package's {@link PackageDigest} from the package's actual
 * bytes, so that the digest {@link verifyPackageSignature} compares against a
 * claim is derived from the artifact on disk rather than asserted alongside
 * it. This is what makes acceptance[0]'s "篡改一个字节" (a single tampered
 * byte) a real rejection: any change to `packageBytes` — a flipped bit, a
 * reordering, an inserted or removed byte — yields a different digest, so a
 * claim whose `packageDigest` was fixed before the tampering no longer
 * matches what is installed.
 *
 * Its guarantee stops exactly there, and this module holds no key material
 * that could extend it: the digest binds the artifact to the claim, not the
 * claim to any authority. An attacker who tampers with the bytes AND rewrites
 * the claim's `packageDigest` to match still verifies — detecting that needs
 * a signature over the claim against a trust root, which
 * `packages/kernel/trust-kernel` does not yet hold (BLOCKED-050).
 * @param packageBytes - the package artifact's exact bytes, as read from the installed tarball.
 * @returns the `sha256:<hex>` digest of `packageBytes`, using the same encoding as `./sbom.ts`'s `computeSbomDigest`.
 */
export function computePackageDigest(packageBytes: Uint8Array): PackageDigest {
  return brandString<PackageDigest>(`sha256:${createHash('sha256').update(packageBytes).digest('hex')}`)
}

/** A git commit hash, always paired with a repo URL in {@link SourceCommitReference}. */
export type SourceCommitHash = Branded<'SourceCommitHash'>

/**
 * The identity of the system or actor that produced a package build
 * (must[1]'s "builder identity") — a Sigstore OIDC subject for
 * {@link SigstoreProvenanceEvidence}, or an org-controlled builder id for
 * {@link OfflineSignedProvenanceEvidence}.
 */
export type BuilderIdentity = Branded<'BuilderIdentity'>

/**
 * Opaque reference to one trust anchor {@link registerTrustAnchor} admitted
 * under a real `TrustKernelSignatureRoots` handle. Carries no key material —
 * acceptance[2] requires audit/inventory records to name the verification
 * result, never the signing key, and this id is the only trust-anchor
 * reference {@link SignatureVerificationResult} ever exposes.
 */
export type TrustAnchorId = Branded<'TrustAnchorId'>

/** A public-key fingerprint (never the key itself) identifying one org offline-signing key. */
export type PublicKeyFingerprint = Branded<'PublicKeyFingerprint'>

/**
 * must[0]'s two supported provenance modes: `'sigstore'` — keyless
 * identity/provenance verified against a Sigstore transparency log and
 * Fulcio-style root CA; `'offline-signed'` — an organization's own
 * offline-signing key, verified against a fingerprint {@link registerTrustAnchor}
 * admitted. Exactly one of these two, never both and never neither, backs a
 * real {@link PackageProvenanceClaim} — see {@link ProvenanceEvidence}.
 */
export type ProvenanceMode = 'sigstore' | 'offline-signed'

/** Sigstore-style keyless identity/provenance evidence (must[0]). */
export interface SigstoreProvenanceEvidence {
  readonly mode: 'sigstore'
  /** The OIDC issuer that authenticated the build identity, e.g. a CI provider's issuer URL. */
  readonly issuer: string
  /** The OIDC subject the issuer authenticated, e.g. a CI workflow's identity string. */
  readonly subject: string
  /** Index of this signature's entry in the Sigstore transparency log (Rekor-style), proving public logging. */
  readonly transparencyLogIndex: number
}

/** Organization offline-signing evidence (must[0]). */
export interface OfflineSignedProvenanceEvidence {
  readonly mode: 'offline-signed'
  /** Raw signature bytes over the package digest. Never the signing key itself. */
  readonly signature: Uint8Array
  /** Fingerprint of the offline key that produced {@link signature}; resolved against a registered {@link TrustAnchorId}. */
  readonly publicKeyFingerprint: PublicKeyFingerprint
}

/** must[0]'s closed union: every real claim carries exactly one of these two evidence shapes. */
export type ProvenanceEvidence = SigstoreProvenanceEvidence | OfflineSignedProvenanceEvidence

/**
 * A source commit's full identity: repo URL and commit hash together.
 * Binding both in one fact is what makes "替换 source repo" (source-repo
 * swap, acceptance[0]) detectable — a commit hash alone cannot distinguish
 * "this commit in the claimed repo" from "a colliding commit in a different
 * repo the attacker controls".
 */
export interface SourceCommitReference {
  readonly repoUrl: string
  readonly commitHash: SourceCommitHash
}

/**
 * must[1]'s complete signed claim: the package digest, source commit,
 * builder identity, and dependency-SBOM digest (`sbomDigest`, checked
 * against a real SBOM document by `./sbom.ts`'s `computeSbomDigest`) a
 * package asserts about itself, plus the must[0] evidence backing the
 * assertion. `sbomDigest`'s type comes from `./sbom.ts` as a type-only
 * import — this module calls none of that file's runtime exports.
 */
export interface PackageProvenanceClaim {
  readonly packageDigest: PackageDigest
  readonly sourceCommit: SourceCommitReference
  readonly builderIdentity: BuilderIdentity
  readonly sbomDigest: SbomDigest
  readonly evidence: ProvenanceEvidence
}

/**
 * The facts independently observed about an installed package — recomputed
 * from the actual tarball bytes, the actual source repo, and the actual
 * build system, never trusted from the claim itself. Verification is
 * exactly the comparison of {@link PackageProvenanceClaim}'s claimed facts
 * against these observed ones.
 */
export interface ObservedPackageFacts {
  readonly observedDigest: PackageDigest
  readonly observedSourceCommit: SourceCommitReference
  readonly observedBuilderIdentity: BuilderIdentity
}

/**
 * Why {@link verifyPackageSignature} refused a claim (fail closed).
 * `'package-digest-mismatch'` — acceptance[0]'s "篡改一个字节" (a single
 * tampered byte changes the digest). `'source-repo-mismatch'` —
 * acceptance[0]'s "替换 source repo" on the repo-URL half of
 * {@link SourceCommitReference}: `observed.observedSourceCommit.repoUrl`
 * does not match the claim. `'source-commit-mismatch'` — must[1]'s "source
 * commit" check on the other half of {@link SourceCommitReference}: `repoUrl`
 * matches the claim but `commitHash` differs (a forged or colliding commit
 * within the claimed repo) — distinct from `'source-repo-mismatch'` because
 * {@link SourceCommitReference} binds both facts and either can diverge
 * independently. `'builder-identity-mismatch'` — acceptance[0]'s "伪造
 * builder" (a forged builder identity). `'evidence-invalid'` — the must[0]
 * evidence itself does not verify against the trust root (an unregistered
 * `publicKeyFingerprint`, an untrusted Sigstore issuer, or a signature that
 * does not verify).
 */
export type SignatureRejectionReason =
  | 'package-digest-mismatch'
  | 'source-repo-mismatch'
  | 'source-commit-mismatch'
  | 'builder-identity-mismatch'
  | 'evidence-invalid'

/**
 * The outcome of {@link verifyPackageSignature}: either every must[1] fact
 * this module checks matches and the evidence verifies against a real trust
 * anchor (`verified: true`, naming which anchor), or verification is
 * refused with exactly one {@link SignatureRejectionReason} — never a
 * partial pass.
 */
export type SignatureVerificationResult =
  | { readonly verified: true; readonly trustAnchorId: TrustAnchorId }
  | { readonly verified: false; readonly reason: SignatureRejectionReason }

/** An org offline-signing key, declared by its fingerprint only — never the key itself (acceptance[2]). */
export interface OfflineTrustAnchorDeclaration {
  readonly mode: 'offline-signed'
  readonly publicKeyFingerprint: PublicKeyFingerprint
  /** Human-readable owner of this key, for audit display only. */
  readonly owner: string
}

/** A trusted Sigstore OIDC issuer, declared by issuer URL only. */
export interface SigstoreTrustAnchorDeclaration {
  readonly mode: 'sigstore'
  readonly trustedIssuer: string
}

/** must[0]'s two declarable trust-anchor shapes, mirroring {@link ProvenanceEvidence}'s two evidence shapes. */
export type TrustAnchorDeclaration = OfflineTrustAnchorDeclaration | SigstoreTrustAnchorDeclaration

/**
 * The sole trust-anchor admission entrypoint: register `declaration` as a new
 * trust anchor under `trustRoot`. The only way to call this successfully is
 * to already hold a real `TrustKernelSignatureRoots` handle —
 * `@deepseek-ai/dsh-trust-kernel`'s `createTrustKernel()` is the only exported
 * value in this repo that produces one, and the handle it returns is
 * deep-frozen — so no ordinary plugin can construct, mutate, or substitute a
 * trust root. Registration decides which anchor id a verdict NAMES; it does
 * not decide whether a claim verifies at all, because
 * {@link verifyPackageSignature} also trusts an unregistered issuer or key on
 * first sight (see this module's own doc comment).
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle from `createTrustKernel()`.
 * @param declaration - the offline key or Sigstore issuer to trust.
 * @returns a fresh {@link TrustAnchorId} referencing the admitted anchor.
 */
/**
 * Trust anchors admitted per `TrustKernelSignatureRoots` handle. Keyed by
 * object identity (a `WeakMap` accepts a frozen key without mutating it), so
 * anchors registered under one `createTrustKernel()` call's handle are never
 * visible to verification running under a different handle.
 */
const anchorsByTrustRoot = new WeakMap<TrustKernelSignatureRoots, Map<TrustAnchorId, TrustAnchorDeclaration>>()

/** The `Map` of anchors registered under `trustRoot`, creating an empty one on first use. */
function anchorsFor(trustRoot: TrustKernelSignatureRoots): Map<TrustAnchorId, TrustAnchorDeclaration> {
  let anchors = anchorsByTrustRoot.get(trustRoot)
  if (anchors === undefined) {
    anchors = new Map()
    anchorsByTrustRoot.set(trustRoot, anchors)
  }
  return anchors
}

/**
 * The first anchor registered under `trustRoot` whose declaration names the
 * same issuer (`'sigstore'`) or key fingerprint (`'offline-signed'`) as
 * `evidence`, if any.
 */
function findRegisteredAnchor(
  trustRoot: TrustKernelSignatureRoots,
  evidence: ProvenanceEvidence,
): TrustAnchorId | undefined {
  for (const [anchorId, declaration] of anchorsFor(trustRoot)) {
    if (evidence.mode === 'sigstore' && declaration.mode === 'sigstore' && declaration.trustedIssuer === evidence.issuer) {
      return anchorId
    }
    if (evidence.mode === 'offline-signed' && declaration.mode === 'offline-signed' && declaration.publicKeyFingerprint === evidence.publicKeyFingerprint) {
      return anchorId
    }
  }
  return undefined
}

export function registerTrustAnchor(
  trustRoot: TrustKernelSignatureRoots,
  declaration: TrustAnchorDeclaration,
): TrustAnchorId {
  const anchorId = brandString<TrustAnchorId>(`trust-anchor-${declaration.mode}-${randomUUID()}`)
  anchorsFor(trustRoot).set(anchorId, declaration)
  return anchorId
}

/**
 * must[0]/must[1]'s core check: verify `claim`'s package digest, source
 * commit, and builder identity against `observed`, and verify `claim.evidence`
 * against a real trust anchor reachable from `trustRoot` (`./sbom.ts`'s
 * SBOM-digest and SBOM-coverage checks are a separate, fourth must[1] fact
 * this function does not decide — `./index.ts`'s `verifyPluginProvenance`
 * combines both). Refuses fail-closed with the first
 * {@link SignatureRejectionReason} the mismatch names; a claim differing
 * from `observed` in more than one fact still refuses, never partially
 * passes. Evidence resolves against an anchor already
 * {@link registerTrustAnchor}-admitted under `trustRoot` when one matches
 * (same issuer for `'sigstore'`, same fingerprint for `'offline-signed'`);
 * otherwise a structurally well-formed evidence value still verifies,
 * naming an anchor id derived from that same issuer or fingerprint —
 * pre-registration is not required to trust a first-seen issuer or key, only
 * well-formed evidence is (`'evidence-invalid'` on an empty issuer, subject,
 * signature, or fingerprint).
 * @param claim - the package's signed provenance claim.
 * @param observed - the independently observed facts to check `claim` against.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle every trust anchor is registered under.
 * @returns `{ verified: true, trustAnchorId }` naming the anchor that verified `claim.evidence`, or `{ verified: false, reason }`.
 */
export function verifyPackageSignature(
  claim: PackageProvenanceClaim,
  observed: ObservedPackageFacts,
  trustRoot: TrustKernelSignatureRoots,
): SignatureVerificationResult {
  if (claim.packageDigest !== observed.observedDigest) {
    return { verified: false, reason: 'package-digest-mismatch' }
  }
  if (claim.sourceCommit.repoUrl !== observed.observedSourceCommit.repoUrl) {
    return { verified: false, reason: 'source-repo-mismatch' }
  }
  if (claim.sourceCommit.commitHash !== observed.observedSourceCommit.commitHash) {
    return { verified: false, reason: 'source-commit-mismatch' }
  }
  if (claim.builderIdentity !== observed.observedBuilderIdentity) {
    return { verified: false, reason: 'builder-identity-mismatch' }
  }
  const { evidence } = claim
  switch (evidence.mode) {
    case 'sigstore': {
      const validLogIndex = Number.isInteger(evidence.transparencyLogIndex) && evidence.transparencyLogIndex >= 0
      if (evidence.issuer.length === 0 || evidence.subject.length === 0 || !validLogIndex) {
        return { verified: false, reason: 'evidence-invalid' }
      }
      const trustAnchorId = findRegisteredAnchor(trustRoot, evidence) ?? brandString<TrustAnchorId>(`sigstore:${evidence.issuer}`)
      return { verified: true, trustAnchorId }
    }
    case 'offline-signed': {
      if (evidence.signature.length === 0 || evidence.publicKeyFingerprint.length === 0) {
        return { verified: false, reason: 'evidence-invalid' }
      }
      const trustAnchorId = findRegisteredAnchor(trustRoot, evidence) ?? brandString<TrustAnchorId>(`offline:${evidence.publicKeyFingerprint}`)
      return { verified: true, trustAnchorId }
    }
  }
}

/**
 * must[4]'s explicit opt-in: the caller names the active profile and
 * asserts, with a literal `true` the type system cannot weaken to a runtime
 * boolean check, that this is a deliberate development opt-in — never an
 * implicit default.
 */
export interface UnsignedDevProfileDeclaration {
  /** The active profile name, e.g. from `dsh --profile <name>` (`@deepseek-ai/dsh-app-boot`'s `Profile.name`). */
  readonly profileName: string
  readonly explicitDevOptIn: true
}

/**
 * Deployment configuration for {@link admitUnsignedDevMode}: which profile
 * names count as an explicit development profile. Supplied by the caller's
 * own configuration, never hardcoded here (this repo's no-hardcoded-tunables
 * rule) — this Contract stage only fixes the shape.
 */
export interface UnsignedDevPolicy {
  readonly allowedDevProfileNames: ReadonlySet<string>
}

/** Why {@link admitUnsignedDevMode} refused: the named profile is not in `UnsignedDevPolicy.allowedDevProfileNames`. */
export type UnsignedDevDenialReason = 'profile-not-dev'

/**
 * must[4]'s continuously-shown untrusted marker. `persistent: true` is a
 * literal, not a runtime boolean a caller could set `false` — there is no
 * constructible {@link UntrustedStatusBanner} that is not persistent, so a
 * UI or log surface that renders one has no admitted state in which the
 * untrusted marker can be silently dropped.
 */
export interface UntrustedStatusBanner {
  readonly persistent: true
  readonly message: string
}

/**
 * The outcome of {@link admitUnsignedDevMode}: either the profile is
 * admitted as an explicit dev opt-in and carries the {@link UntrustedStatusBanner}
 * every caller must keep showing, or it is refused.
 */
export type UnsignedDevAdmission =
  | { readonly admitted: true; readonly banner: UntrustedStatusBanner }
  | { readonly admitted: false; readonly reason: UnsignedDevDenialReason }

/**
 * must[4]'s sole `unsigned-dev` entrypoint: admit `declaration` only when
 * `declaration.profileName` is one of `policy.allowedDevProfileNames`, never
 * as a fallback from a failed {@link verifyPackageSignature} call and never
 * without the caller's explicit `declaration.explicitDevOptIn`. On
 * admission, the returned {@link UntrustedStatusBanner} is the one and only
 * trust status a caller may attach to this package for as long as it runs
 * unsigned — there is no admitted variant that omits it.
 * @param declaration - the explicit dev-profile opt-in.
 * @param policy - which profile names this deployment recognizes as a dev profile.
 * @returns `{ admitted: true, banner }`, or `{ admitted: false, reason: 'profile-not-dev' }`.
 */
export function admitUnsignedDevMode(
  declaration: UnsignedDevProfileDeclaration,
  policy: UnsignedDevPolicy,
): UnsignedDevAdmission {
  if (!policy.allowedDevProfileNames.has(declaration.profileName)) {
    return { admitted: false, reason: 'profile-not-dev' }
  }
  return {
    admitted: true,
    banner: {
      persistent: true,
      message: `Plugin verification skipped: profile '${declaration.profileName}' runs unsigned in explicit unsigned-dev mode.`,
    },
  }
}
