import { randomUUID } from 'node:crypto'
import type { TraceSpan, TraceLink, SpanKind } from './types.ts'

export type { TraceSpan, TraceLink, SpanKind } from './types.ts'

export class CausalTrace {
  private spans = new Map<string, TraceSpan>()
  private links: TraceLink[] = []

  startSpan(
    runId: string,
    kind: SpanKind,
    name: string,
    parentSpanId?: string,
    attributes: Record<string, unknown> = {},
    actionId?: string,
  ): TraceSpan {
    const traceId = parentSpanId
      ? this.spans.get(parentSpanId)?.traceId ?? randomUUID()
      : randomUUID()
    const span: TraceSpan = {
      spanId: randomUUID(),
      traceId,
      parentSpanId: parentSpanId ?? undefined,
      kind,
      name,
      startTime: Date.now(),
      attributes,
      runId,
      actionId: actionId ?? undefined,
    }
    this.spans.set(span.spanId, span)
    return span
  }

  endSpan(spanId: string): TraceSpan | undefined {
    const span = this.spans.get(spanId)
    if (!span) return undefined
    const updated = { ...span, endTime: Date.now() }
    this.spans.set(spanId, updated)
    return updated
  }

  addLink(fromSpanId: string, toSpanId: string, relation: TraceLink['relation']): void {
    this.links.push({ fromSpanId, toSpanId, relation })
  }

  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId)
  }

  getSpansByRun(runId: string): readonly TraceSpan[] {
    return Array.from(this.spans.values()).filter(s => s.runId === runId)
  }

  getSpansByKind(kind: SpanKind): readonly TraceSpan[] {
    return Array.from(this.spans.values()).filter(s => s.kind === kind)
  }

  getLinks(): readonly TraceLink[] {
    return this.links
  }

  traceToOutcome(runId: string): { spans: readonly TraceSpan[]; links: readonly TraceLink[] } {
    const runSpans = this.getSpansByRun(runId)
    const spanIds = new Set(runSpans.map(s => s.spanId))
    const runLinks = this.links.filter(l => spanIds.has(l.fromSpanId) && spanIds.has(l.toSpanId))
    return { spans: runSpans, links: runLinks }
  }

  clear(): void {
    this.spans.clear()
    this.links = []
  }
}
