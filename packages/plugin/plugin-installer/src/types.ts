/**
 * Durable vocabulary for the plugin-package installer (Epic P1-04 (A)). Types
 * only — no runtime code.
 * @module @deepseek-ai/dsh-plugin-installer/types
 */

import type {
  BuilderIdentity,
  PackageProvenanceClaim,
  SbomDocument,
  SourceCommitReference,
  TrustAnchorId,
} from '@deepseek-ai/dsh-plugin-provenance'

/**
 * Why the installer refused a package, one code per distinct attack the
 * acceptance clauses name. `provenance-rejected` wraps a P1-02
 * `ProvenanceRejectionReason`; the rest are the extract-time structural
 * refusals (acceptance[1]).
 */
export type InstallRefusalCode =
  | 'absolute-path'
  | 'path-traversal'
  | 'symlink-entry'
  | 'hardlink-entry'
  | 'unsupported-entry'
  | 'decompression-bomb'
  | 'empty-archive'
  | 'provenance-rejected'

/**
 * The decompression bounds extraction enforces against an untrusted archive
 * (acceptance[1]'s zip bomb). Both are deployment-resolved, never hardcoded in
 * the extract path.
 */
export interface ExtractionPolicy {
  /** Largest total-uncompressed to compressed-archive byte ratio admitted before the archive reads as a bomb. */
  readonly maxDecompressionRatio: number
  /** Largest total uncompressed byte size admitted, bounding a low-ratio but enormous archive. */
  readonly maxUncompressedBytes: number
}

/**
 * The installer's deployment configuration. Absent fields take the package's
 * `DEFAULT_*` values, resolved once into an {@link ExtractionPolicy}.
 */
export interface Config {
  /** Largest total-uncompressed to compressed ratio an archive may expand to. Default: 100. */
  maxDecompressionRatio?: number
  /** Largest total uncompressed byte size an archive may expand to. Default: 512 MiB. */
  maxUncompressedBytes?: number
}

/**
 * The independently-observed facts and signed claim a caller presents for one
 * package, less the package digest: the installer recomputes
 * `observed.observedDigest` from the tarball bytes itself (so a tampered byte
 * is a real rejection), and never trusts a digest asserted beside the bytes.
 * The source commit and builder identity are observed by the caller (the
 * registry and build system), not read from the untrusted package.
 */
export interface ProvenanceAssertion {
  readonly claim: PackageProvenanceClaim
  readonly sbom: SbomDocument
  readonly installedDependencyNames: ReadonlySet<string>
  readonly observedSourceCommit: SourceCommitReference
  readonly observedBuilderIdentity: BuilderIdentity
}

/** One install request: the untrusted package bytes and the provenance to verify them against. */
export interface InstallRequest {
  readonly tarball: Uint8Array
  readonly provenance: ProvenanceAssertion
}

/** A package that verified and extracted, named by its quarantine extraction root. */
export interface InstalledPlugin {
  /** The directory the verified package was extracted into, inside the quarantine. */
  readonly extractedPath: string
  /** The trust anchor its provenance verified against (P1-02). */
  readonly trustAnchorId: TrustAnchorId
}
