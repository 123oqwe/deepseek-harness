/** Types for the P1-04 isolated-install security core. @module @deepseek-ai/dsh-plugin-installer/types */

/**
 * The threat class a refused tarball entry falls in (Epic P1-04 acceptance[1]).
 * A closed union; every reader switches to `assertNever`.
 */
export type UnpackThreatKind =
  | 'path-traversal'
  | 'absolute-path'
  | 'symlink'
  | 'hardlink'
  | 'decompression-ratio'
  | 'entry-count'

/** Deployment-resolved unpack limits; none is hardcoded in the extractor. */
export interface UnpackPolicy {
  /** Largest total declared uncompressed size the archive may reach before it reads as a bomb. */
  readonly maxTotalBytes: number
  /** Largest number of entries the archive may hold. */
  readonly maxEntries: number
}

/** Stable P1-04 install failure codes, routed on `code` like `AttachmentError`. */
export type PluginInstallErrorCode = 'MALICIOUS_PACKAGE' | 'QUARANTINE_FAILED'

/** A caller-correctable plugin-install failure. A `MALICIOUS_PACKAGE` carries the threat class in `threat`. */
export class PluginInstallError extends Error {
  /** Stable machine-routing code. */
  readonly code: PluginInstallErrorCode
  /** The threat class, present when `code` is `MALICIOUS_PACKAGE`. */
  readonly threat?: UnpackThreatKind

  constructor(message: string, code: PluginInstallErrorCode, threat?: UnpackThreatKind) {
    super(message)
    this.name = 'PluginInstallError'
    this.code = code
    if (threat !== undefined) this.threat = threat
  }
}
