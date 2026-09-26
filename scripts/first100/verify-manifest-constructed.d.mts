/**
 * Types for `verify-manifest-constructed.mjs`: P2-03 must[0]'s structural half.
 */

/** One exported function the scan followed because it constructs a manifest. */
export interface ManifestHelper {
  /** The production file that exports it. */
  file: string
  /** Its name, which the scan then counts as an entry point. */
  name: string
  /** The entry points its body calls. */
  reaches: string[]
}

/** What one scan of the tree found. */
export interface ManifestBuilderScan {
  /**
   * Production files outside the owning package that construct a manifest,
   * through the builder, the façade that calls it (§12.39), or an exported
   * helper that reaches either (B-645). A file whose only calls sit inside the
   * helpers it exports is not listed.
   */
  callers: string[]
  /** The exported helpers followed, in the order the scan found them. */
  helpers: ManifestHelper[]
  /**
   * Whether the owning package declares every accepted builder, which is the
   * control: a zero without it means the scan is broken, not that construction
   * stopped.
   */
  ownerDefines: boolean
  /** How many production files were read, so an empty result is attributable. */
  scanned: number
}

export function manifestBuilderCallers(): ManifestBuilderScan
