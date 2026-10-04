/** Malicious-content attachment scanner provider (`ctx.attachmentScanner`, P3-12 must[1]). @module @deepseek-ai/dsh-attachment-security */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentScanner } from '@deepseek-ai/dsh-attachment'
import type { AttachmentScanInput, AttachmentScanVerdict } from '@deepseek-ai/dsh-attachment'
import { scanPayload } from './scanner.ts'
import type { ScanPolicy } from './scanner.ts'

export { scanPayload, sniffKind } from './scanner.ts'
export type { ScanPolicy } from './scanner.ts'

/** Default largest total-uncompressed to compressed ratio before an archive reads as a bomb. */
export const DEFAULT_MAX_DECOMPRESSION_RATIO = 100
/** Default deepest archive-within-archive nesting admitted. */
export const DEFAULT_MAX_NESTING_DEPTH = 1
/** Default largest intrinsic width times height admitted for a raster image. */
export const DEFAULT_MAX_PIXELS = 64_000_000

/** Malicious-content scanner configuration. */
export interface Config {
  /** Largest total-uncompressed to compressed ratio an archive may declare. Default: 100. */
  maxDecompressionRatio?: number
  /** Deepest archive-within-archive nesting admitted; 0 forbids any nested archive. Default: 1. */
  maxNestingDepth?: number
  /** Largest intrinsic width times height admitted for a raster image. Default: 64,000,000. */
  maxPixels?: number
}

/**
 * Classify one decoded attachment payload against a deployment's threat policy
 * (P3-12 must[1]). It reads leading magic numbers and ZIP central-directory
 * metadata only — it never decompresses a payload to a parser or the model, so
 * the scanner is not itself an expansion surface for a bomb.
 */
export class AttachmentSecurityScanner extends AttachmentScanner {
  static Config: z<Config> = z.object({
    maxDecompressionRatio: z.number().step(1).min(1).default(DEFAULT_MAX_DECOMPRESSION_RATIO),
    maxNestingDepth: z.number().step(1).min(0).default(DEFAULT_MAX_NESTING_DEPTH),
    maxPixels: z.number().step(1).min(1).default(DEFAULT_MAX_PIXELS),
  })

  private readonly policy: ScanPolicy

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.policy = {
      maxDecompressionRatio: config.maxDecompressionRatio ?? DEFAULT_MAX_DECOMPRESSION_RATIO,
      maxNestingDepth: config.maxNestingDepth ?? DEFAULT_MAX_NESTING_DEPTH,
      maxPixels: config.maxPixels ?? DEFAULT_MAX_PIXELS,
    }
  }

  scan(input: AttachmentScanInput): Promise<AttachmentScanVerdict> {
    const refusal = scanPayload(input, this.policy)
    return Promise.resolve(refusal === undefined ? { admit: true } : { admit: false, refusal })
  }
}

export default AttachmentSecurityScanner
