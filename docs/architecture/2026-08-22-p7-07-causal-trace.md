# P7-07 — Causal Trace & Telemetry Outbox
## Contract
- CausalTrace: startSpan, endSpan, addLink, traceToOutcome
- TelemetryOutbox: enqueue (refuse without redaction), flush, ack, dedupe
- exportSpans: OTel exporter stub
## Dependencies: P4-06, P6-10, P7-02, P2-05
