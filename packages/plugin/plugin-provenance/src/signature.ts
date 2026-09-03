/**
 * Contract-stage type surface and stub decision logic for Epic P1-02's
 * plugin signature and provenance verification: the Sigstore-style
 * identity/provenance or organization offline-signing evidence a package
 * carries (must[0]), the package digest / source commit / builder identity
 * facts a claim is checked against (must[1]'s first three of four checks —
 * `./sbom.ts` owns the fourth), the `TrustKernel`-held trust root every
 * check runs against (must[2]/must[3]), and the explicit-dev-profile-gated
 * `unsigned-dev` fallback (must[4]).
 *
 * **Grounding.** {@link PackageDigest}, {@link SourceCommitHash},
 * {@link BuilderIdentity}, and {@link TrustAnchorId} have no branded-type
 * precedent in this repo; each follows the `Branded<B>` idiom from
 * `@deepseek-ai/dsh-brand` per this repo's opaque-cross-boundary-id rule.
 * The trust root itself is not a type this package defines: must[2]/must[3]
 * ("TrustKernel 持有可信根" / "普通插件不能修改" — the trust root lives in
 * TrustKernel, and an ordinary plugin cannot modify it) are satisfied by
 * requiring `@deepseek-ai/dsh-trust-kernel`'s own
 * {@link TrustKernelSignatureRoots} handle — a value opaque and frozen at
 * construction, with no exported constructor in this package or that one
 * besides `createTrustKernel()` — as the sole trust-root parameter every
 * verification and trust-anchor-registration function below accepts. No
 * function in this module accepts a plugin-supplied substitute.
 *
 * @module @deepseek-ai/dsh-plugin-provenance/signature
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel/types'
import type { SbomDigest } from './sbom.ts'

/** Content digest of an installed package tarball (must[1]'s "package digest"). */
export type PackageDigest = Branded<'PackageDigest'>

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
 * acceptance[0]'s "替换 source repo" (repo URL or commit hash observed does
 * not match the claim). `'builder-identity-mismatch'` — acceptance[0]'s
 * "伪造 builder" (a forged builder identity). `'evidence-invalid'` — the
 * must[0] evidence itself does not verify against the trust root (an
 * unregistered `publicKeyFingerprint`, an untrusted Sigstore issuer, or a
 * signature that does not verify).
 */
export type SignatureRejectionReason =
  | 'package-digest-mismatch'
  | 'source-repo-mismatch'
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
 * must[2]/must[3]'s sole trust-anchor admission entrypoint: register
 * `declaration` as a new trust anchor under `trustRoot`. The only way to
 * call this successfully is to already hold a real
 * `TrustKernelSignatureRoots` handle — `@deepseek-ai/dsh-trust-kernel`'s
 * `createTrustKernel()` is the only exported value in this repo that
 * produces one, and the handle it returns is deep-frozen — so no ordinary
 * plugin can construct, mutate, or substitute a trust root to smuggle in an
 * anchor {@link verifyPackageSignature} would then wrongly trust.
 * @param trustRoot - the real `TrustKernelSignatureRoots` handle from `createTrustKernel()`.
 * @param declaration - the offline key or Sigstore issuer to trust.
 * @returns a fresh {@link TrustAnchorId} referencing the admitted anchor.
 */
export function registerTrustAnchor(
  trustRoot: TrustKernelSignatureRoots,
  declaration: TrustAnchorDeclaration,
): TrustAnchorId {
  throw new Error(`not implemented: registerTrustAnchor(mode=${declaration.mode}, trustRootType=${typeof trustRoot})`)
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
 * passes.
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
  throw new Error(`not implemented: verifyPackageSignature(${String(claim.packageDigest)}, mode=${claim.evidence.mode}, observedDigest=${String(observed.observedDigest)}, trustRootType=${typeof trustRoot})`)
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
  throw new Error(`not implemented: admitUnsignedDevMode(${declaration.profileName}, ${String(policy.allowedDevProfileNames.size)} allowed dev profiles)`)
}
