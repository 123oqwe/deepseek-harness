/** Malicious-content scanner seam for decoded attachment payloads (P3-12 must[1]). @module @deepseek-ai/dsh-attachment/scan */

import { Context, Service } from '@deepseek-ai/cordis'

/**
 * The threat classes the scanner recognizes (P3-12 must[1]). A closed union:
 * every consumer switch over it ends in `assertNever`, so a new class forces
 * every reader to handle it.
 */
export type AttachmentThreatKind =
  | 'mime-mismatch'
  | 'decompression-ratio'
  | 'polyglot'
  | 'pixel-bomb'
  | 'nesting-depth'
  | 'macro'
  | 'executable'

/** Why the scanner refused one payload: the threat class and a human-readable detail. */
export interface AttachmentScanRefusal {
  /** The threat class, for machine routing and metrics. */
  readonly kind: AttachmentThreatKind
  /** A short human-readable reason, e.g. the declared vs sniffed media type. */
  readonly detail: string
}

/**
 * The scanner's verdict on one decoded payload: admit it, or refuse it with the
 * threat class and detail. A refusal carries no bytes — the payload never
 * reaches a parser or the model.
 */
export type AttachmentScanVerdict =
  | { readonly admit: true }
  | { readonly admit: false; readonly refusal: AttachmentScanRefusal }

/** One decoded upload to scan: the raw bytes and the caller-declared media type. */
export interface AttachmentScanInput {
  /** The decoded payload bytes, before any parser sees them. */
  readonly bytes: Uint8Array
  /** The media type the caller declared for the payload. */
  readonly declaredMediaType: string
  /** The optional display name the caller supplied. */
  readonly name?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachmentScanner: AttachmentScanner
  }
}

/**
 * Scan one decoded attachment payload for malicious content before it reaches a
 * parser or the model (P3-12 must[1]). A deployment mounts one provider; its
 * absence admits every payload, which is capability absence, not a silent pass.
 *
 * The scanner is the decision this seam owns; a store's save path invokes it so
 * no caller reaches a parser with an unscanned payload (the enforcement point is
 * the store save operation, not the narrower admission entry a direct store
 * caller bypasses).
 */
export abstract class AttachmentScanner extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachmentScanner')
  }

  /**
   * Classify one decoded payload against the deployment's threat policy.
   * @param input - decoded bytes, declared media type, and optional name.
   * @returns a verdict: admit, or refuse with the threat class and detail.
   */
  abstract scan(input: AttachmentScanInput): Promise<AttachmentScanVerdict>
}

export default AttachmentScanner
