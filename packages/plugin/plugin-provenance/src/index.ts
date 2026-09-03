/**
 * Package entry point. Contract-stage RED scaffold for Epic P1-02's plugin
 * signature, source provenance, and dependency SBOM verification: this
 * module combines `./signature.ts`'s digest/source-commit/builder-identity
 * checks with `./sbom.ts`'s SBOM-digest/coverage checks into the complete
 * must[1] verification (`verifyPluginProvenance`), adds the offline replay
 * path acceptance[1] requires (`verifyLockedPackageOffline`), and the
 * key-free audit/inventory record acceptance[2] requires
 * (`recordProvenanceAudit`). Every exported function has a real,
 * epic-accurate signature but a placeholder body (`'not implemented'`) —
 * the pure decision logic is this epic's Contract-stage deliverable to a
 * later fix-round, not this scaffold's.
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
 * decides, plus the two SBOM-specific failures `./sbom.ts`'s checks decide.
 * `'sbom-digest-mismatch'` — `claim.sbomDigest` does not equal
 * `computeSbomDigest(input.sbom)` (the SBOM was swapped after signing).
 * `'sbom-coverage-mismatch'` — `verifySbomCoverage` returned `verified:
 * false` (must[1]'s dependency-SBOM check, validation[]'s "检查所有运行依赖
 * 均被列出").
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
  throw new Error(`not implemented: verifyPluginProvenance(${String(input.claim.packageDigest)}, trustRootType=${typeof trustRoot})`)
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
  throw new Error(`not implemented: verifyLockedPackageOffline(${String(locked.claim.packageDigest)}, trustRootType=${typeof trustRoot})`)
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
  readonly packageDigest: PackageDigest
  readonly trust: 'trusted' | 'rejected'
  readonly reason?: ProvenanceRejectionReason
  readonly trustAnchorId?: TrustAnchorId
  /** ISO 8601 timestamp of when `verification` was decided. */
  readonly verifiedAt: string
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
  throw new Error(`not implemented: recordProvenanceAudit(${String(packageDigest)}, trust=${verification.trust}, verifiedAt=${verifiedAt})`)
}
