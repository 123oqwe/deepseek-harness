export type SpanKind = 'run' | 'turn' | 'step' | 'tool' | 'action' | 'policy' | 'approval' | 'subagent' | 'world' | 'evidence' | 'verifier' | 'repair'

export interface TraceSpan {
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId?: string | undefined
  readonly kind: SpanKind
  readonly name: string
  readonly startTime: number
  readonly endTime?: number | undefined
  readonly attributes: Record<string, unknown>
  readonly causationId?: string | undefined
  readonly runId: string
  readonly actionId?: string | undefined
}

export interface TraceLink {
  readonly fromSpanId: string
  readonly toSpanId: string
  readonly relation: 'causes' | 'follows' | 'compensates'
}
