import { describe, it, expect, beforeEach } from 'vitest'
import { CausalTrace } from '../src/index.ts'
import { TelemetryOutbox } from '../../telemetry-outbox/src/index.ts'
import { exportSpans } from '../../otel-exporter/src/index.ts'

describe('P7-07 Causal Trace & Telemetry Outbox', () => {
  let trace: CausalTrace
  let outbox: TelemetryOutbox

  beforeEach(() => {
    trace = new CausalTrace()
    outbox = new TelemetryOutbox()
  })

  it('creates spans with trace IDs and parent links', () => {
    const root = trace.startSpan('run-1', 'run', 'main run')
    const child = trace.startSpan('run-1', 'tool', 'fs-read', root.spanId)
    expect(child.traceId).toBe(root.traceId)
    expect(child.parentSpanId).toBe(root.spanId)
  })

  it('traces span kinds across run lifecycle', () => {
    trace.startSpan('r1', 'run', 'run')
    trace.startSpan('r1', 'turn', 'turn-1')
    trace.startSpan('r1', 'tool', 'bash')
    trace.startSpan('r1', 'action', 'write-file')
    trace.startSpan('r1', 'policy', 'allow')
    expect(trace.getSpansByRun('r1')).toHaveLength(5)
    expect(trace.getSpansByKind('tool')).toHaveLength(1)
  })

  it('adds causal links between spans', () => {
    const s1 = trace.startSpan('r1', 'action', 'a1')
    const s2 = trace.startSpan('r1', 'action', 'a2')
    trace.addLink(s1.spanId, s2.spanId, 'causes')
    expect(trace.getLinks()).toHaveLength(1)
  })

  it('traces to outcome for a run', () => {
    const s1 = trace.startSpan('r1', 'run', 'main')
    const s2 = trace.startSpan('r1', 'tool', 'bash', s1.spanId)
    trace.addLink(s1.spanId, s2.spanId, 'causes')
    const result = trace.traceToOutcome('r1')
    expect(result.spans).toHaveLength(2)
    expect(result.links).toHaveLength(1)
  })

  it('outbox rejects enqueue without redaction policy', () => {
    const result = outbox.enqueue('otel', { event: 'test' })
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('redaction')
  })

  it('outbox accepts enqueue with redaction policy mounted', () => {
    outbox.setRedactionPolicy(true)
    const result = outbox.enqueue('otel', { event: 'test' })
    expect(result.accepted).toBe(true)
  })

  it('outbox delivers pending entries on flush', () => {
    outbox.setRedactionPolicy(true)
    outbox.enqueue('otel', { event: 'e1' })
    outbox.enqueue('otel', { event: 'e2' })
    const delivered = outbox.flush()
    expect(delivered).toHaveLength(2)
    expect(outbox.getDeliveredCount()).toBe(2)
  })

  it('outbox ack prevents duplicate processing', () => {
    outbox.setRedactionPolicy(true)
    const r = outbox.enqueue('otel', { event: 'e1' })
    if (!r.id) throw new Error('no id')
    outbox.flush()
    expect(outbox.ack(r.id)).toBe(true)
    expect(outbox.dedupeCheck(r.id)).toBe(true)
    expect(outbox.ack(r.id)).toBe(true)
  })

  it('outbox crash recovery: undelivered entries survive', () => {
    outbox.setRedactionPolicy(true)
    outbox.enqueue('otel', { event: 'e1' })
    outbox.enqueue('otel', { event: 'e2' })
    outbox.flush()
    const r3 = outbox.enqueue('otel', { event: 'e3' })
    expect(outbox.getUndelivered()).toHaveLength(1)
    expect(r3.accepted).toBe(true)
  })

  it('OTel exporter exports spans', () => {
    trace.startSpan('r1', 'run', 'main')
    trace.startSpan('r1', 'tool', 'bash')
    const spans = trace.getSpansByRun('r1')
    const result = exportSpans(spans, [])
    expect(result.exported).toBe(2)
  })
})
