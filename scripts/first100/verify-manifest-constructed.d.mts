/**
 * Types for `verify-manifest-constructed.mjs`: P2-03 must[0]'s structural half.
 */

/** What one scan of the tree found. */
export interface ManifestBuilderScan {
  /**
   * Production files outside the owning package that construct a manifest,
   * through either entry point — the builder or the façade that calls it
   * (§12.39).
   */
  callers: string[]
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
