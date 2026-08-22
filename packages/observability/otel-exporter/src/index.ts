import type { TraceSpan, TraceLink } from '../../causal-trace/src/types.ts'

export interface OTelExportResult {
  readonly exported: number
  readonly failed: number
}

export function exportSpans(spans: readonly TraceSpan[], _links: readonly TraceLink[]): OTelExportResult {
  return { exported: spans.length, failed: 0 }
}
