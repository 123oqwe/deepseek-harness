/**
 * Contract-stage type surface of the Release Evidence Package (Epic P0-07):
 * the shape of a per-gate evidence record (must[0]), the shape of the
 * aggregate evidence package that binds a baseline fingerprint, a Git diff,
 * and build-artifact digests together (must[1]), and the structural
 * guarantee that `accepted` cannot type-check as `true` while any required
 * gate is skipped/missing or any required build artifact is absent
 * (must[2]). See `docs/testing.md#boot-time-baseline-preflight` for this
 * repo's existing baseline-fingerprint precedent
 * (`@deepseek-ai/dsh-baseline-preflight`, Epic P0-01) that
 * {@link BaselineFingerprintBinding} binds by digest rather than
 * duplicating.
 *
 * This module has only a type-only import of `Branded` from
 * `@deepseek-ai/dsh-brand` — no other import, no `Config` schema, and no
 * `apply(ctx, config)` plugin export, so nothing here can be mounted with
 * `ctx.plugin(...)`. Unlike `@deepseek-ai/dsh-trust-kernel`'s capability
 * handles, every identifier and digest type below is deliberately NOT
 * branded by an un-exported `unique symbol`: an evidence package is written
 * to disk and verified fully offline (Epic P0-07 acceptance[1]), so it must
 * round-trip through `JSON.stringify`/`JSON.parse` — a symbol-keyed
 * property is dropped silently by `JSON.stringify`, which would make an
 * opaque handle unrepresentable in the persisted JSON this package's data
 * is FOR. Every id/digest below is instead a `Branded<B>` plain string (see
 * `@deepseek-ai/dsh-brand`'s own module doc, and
 * `@deepseek-ai/dsh-trust-kernel/types`'s doc comment for the same
 * distinction drawn the other way): correct for a nominal identifier of
 * content, wrong for an in-memory-only capability.
 *
 * **What this type surface structurally proves, and what it cannot.**
 * {@link AcceptedEvidencePackage}'s `requiredGates` and
 * `requiredBuildArtifacts` are complete `Record<K, V>` maps keyed by the
 * release's real required-id literal unions (`RequiredGateId`,
 * `RequiredArtifactPath`): a caller cannot type-check an
 * `AcceptedEvidencePackage` literal that omits a required key, or that
 * assigns a {@link SkippedGateEvidence}/{@link MissingGateEvidence} value
 * where a {@link CompletedGateEvidence} is required — a genuine compile-time
 * proof, not a runtime check standing in for one (see
 * `tests/release/evidence-package.spec.ts`'s real `tsc` diagnostic
 * assertions). It cannot, and structurally never could, prove the VALUES
 * inside a well-shaped `CompletedGateEvidence` are truthful: nothing stops a
 * caller from hand-writing `{ outcome: 'completed', exitCode: 0, ... }` for
 * a gate that never ran. TypeScript's structural type system checks shape,
 * not provenance. Closing that gap is `signature`'s job (an opaque detached
 * attestation this Contract-stage slice only reserves a field for) and
 * `scripts/release/verify-evidence.mjs`'s job (P-stage, out of scope here)
 * — offline signature verification against a pinned trust anchor, not a
 * TypeScript compile-time guarantee. Likewise, when `RequiredGateId`/
 * `RequiredArtifactPath` are left at their `string` defaults (the shape a
 * `JSON.parse`-loaded, dynamically-typed package necessarily has), the
 * completeness check degrades to "every present value is
 * `CompletedGateEvidence`-shaped", not "every required id is present": an
 * `AcceptedEvidencePackage<string, string>` literal with an EMPTY
 * `requiredGates` map still type-checks, vacuously. Membership in the real
 * release's configured blocking-gate manifest is a P-stage runtime check
 * (`verify-evidence.mjs` cross-referencing that manifest), never a static
 * one; this module's own test file proves and documents this degraded case
 * rather than hiding it.
 *
 * @module @deepseek-ai/dsh-evidence-format/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Digest of some canonical content (a raw log, a build artifact, a
 * canonical JSON record). Opaque to everything but equality; the hash
 * algorithm is a P-stage/runtime choice, not part of this type.
 */
export type Digest = Branded<'EvidenceDigest'>

/**
 * Detached cryptographic attestation over an {@link EvidencePackage}'s
 * canonical serialization. Producing and verifying one is
 * `scripts/release/collect-evidence.mjs`/`verify-evidence.mjs`'s job
 * (P-stage); this Contract-stage slice only reserves the field.
 */
export type Signature = Branded<'EvidenceSignature'>

/** Full 40-character hexadecimal Git commit SHA. */
export type CommitSha = Branded<'CommitSha'>

/**
 * Stable identifier for one gate a release runs (for example `"typecheck"`,
 * `"lint"`, `"test:coverage"`). Deployment-defined: this package owns no
 * fixed enum of gate names.
 */
export type GateId = Branded<'GateId'>

/** One file a gate or the release build produced, paired with its content digest. */
export interface ArtifactDigestEntry {
  /** Repo-relative path, POSIX separators, never absolute. */
  readonly path: string
  readonly digest: Digest
}

/** must[0]'s test-count fields: parsed from a gate's own real output, never fabricated. */
export interface GateTestCounts {
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly skipped: number
}

/** must[0]'s environment field: the process environment a gate actually ran under. */
export interface GateEnvironment {
  readonly platform: string
  readonly arch: string
  readonly nodeVersion: string
  readonly ci: boolean
}

/** Fields every {@link GateEvidence} outcome carries, regardless of whether the gate ran. */
interface GateEvidenceBase {
  readonly gateId: GateId
  /** Exact command invoked, verbatim. */
  readonly command: string
  readonly startedAt: string
  readonly endedAt: string
  readonly environment: GateEnvironment
  /**
   * must[0]'s "输出带哈希的 JSON 结果" (outputs a hashed JSON result): digest
   * of this record's own canonical JSON (every other field, sorted keys),
   * computed by the producer before this field is attached. Detects a
   * record edited after collection, independent of
   * {@link EvidencePackage.signature}'s package-wide coverage.
   */
  readonly recordDigest: Digest
}

/** A gate that ran to completion and reported a real exit code. */
export interface CompletedGateEvidence extends GateEvidenceBase {
  readonly outcome: 'completed'
  readonly exitCode: number
  readonly logDigest: Digest
  readonly artifacts: readonly ArtifactDigestEntry[]
  /** `null` for a gate with no pass/fail/skip notion of its own (for example `typecheck`, `lint`, `build`). */
  readonly testCounts: GateTestCounts | null
  /** Always empty on a completed gate — a nonempty reason belongs to {@link SkippedGateEvidence}/{@link MissingGateEvidence}. */
  readonly skipReasons: readonly []
}

/** A gate deliberately not run this release (for example platform-gated), with at least one real reason. */
export interface SkippedGateEvidence extends GateEvidenceBase {
  readonly outcome: 'skipped'
  readonly exitCode: null
  readonly logDigest: null
  readonly artifacts: readonly []
  readonly testCounts: null
  readonly skipReasons: readonly [string, ...string[]]
}

/** A gate the collector expected to run but has no evidence for at all (crash, timeout before start, misconfiguration). */
export interface MissingGateEvidence extends GateEvidenceBase {
  readonly outcome: 'missing'
  readonly exitCode: null
  readonly logDigest: null
  readonly artifacts: readonly []
  readonly testCounts: null
  readonly skipReasons: readonly [string, ...string[]]
}

/** must[0]'s per-gate evidence record: exactly one of the three real outcomes a gate run can have. */
export type GateEvidence = CompletedGateEvidence | SkippedGateEvidence | MissingGateEvidence

/**
 * must[1]'s baseline-fingerprint binding: identifies the captured
 * `.dsh/baseline.json` (`@deepseek-ai/dsh-baseline-preflight`, Epic P0-01)
 * this evidence package was collected against, by commit and content
 * digest — never by re-embedding the whole captured document.
 */
export interface BaselineFingerprintBinding {
  readonly gitSha: CommitSha
  readonly digest: Digest
}

/** must[1]'s Git-diff binding: the working-tree change this evidence package covers. */
export interface GitDiffBinding {
  readonly baseSha: CommitSha
  readonly headSha: CommitSha
  readonly digest: Digest
}

/** Fields every {@link EvidencePackage}, accepted or not, carries. */
interface EvidencePackageBase {
  readonly formatVersion: 1
  readonly baselineFingerprint: BaselineFingerprintBinding
  readonly gitDiff: GitDiffBinding
  /** Gates run this release beyond `requiredGates` — any {@link GateEvidence} outcome is legal; never gates acceptance. */
  readonly additionalGates: readonly GateEvidence[]
  /**
   * Detached attestation over this package's canonical serialization
   * (`baselineFingerprint`, `gitDiff`, every required and additional gate,
   * every required build artifact) — must[1]'s "binds … together" and
   * acceptance[0]'s tamper-detection. Producing and verifying it is
   * P-stage's job; this Contract-stage slice only reserves the field.
   */
  readonly signature: Signature
}

/**
 * `accepted: true`: every required gate id and every required build
 * artifact path is present, and every required gate's evidence is the
 * {@link CompletedGateEvidence} variant. `Record<K, V>` requires every key
 * of `K` and rejects a `SkippedGateEvidence`/`MissingGateEvidence` value at
 * any of those keys, so must[2] holds by construction whenever
 * `RequiredGateId`/`RequiredArtifactPath` are instantiated as the release's
 * real literal union (see this module's own doc comment for the degraded,
 * `string`-keyed case).
 */
export interface AcceptedEvidencePackage<
  RequiredGateId extends string = string,
  RequiredArtifactPath extends string = string,
> extends EvidencePackageBase {
  readonly accepted: true
  readonly requiredGates: Readonly<Record<RequiredGateId, CompletedGateEvidence>>
  readonly requiredBuildArtifacts: Readonly<Record<RequiredArtifactPath, Digest>>
}

/**
 * `accepted: false`: any outcome is legal for every required gate, and any
 * required build artifact may be absent — exactly the state a failed,
 * partial, or in-progress release run leaves.
 */
export interface UnacceptedEvidencePackage<
  RequiredGateId extends string = string,
  RequiredArtifactPath extends string = string,
> extends EvidencePackageBase {
  readonly accepted: false
  readonly requiredGates: Readonly<Partial<Record<RequiredGateId, GateEvidence>>>
  readonly requiredBuildArtifacts: Readonly<Partial<Record<RequiredArtifactPath, Digest>>>
}

/**
 * must[1]'s aggregate evidence package: discriminated on `accepted` so
 * must[2] is a compile-time property of the `true` arm, not a
 * runtime-checked boolean field bolted onto one common shape.
 */
export type EvidencePackage<RequiredGateId extends string = string, RequiredArtifactPath extends string = string> =
  | AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath>
  | UnacceptedEvidencePackage<RequiredGateId, RequiredArtifactPath>
