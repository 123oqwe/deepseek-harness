# Agent Note: P6-05 — Per-Agent Context Topology & Telemetry Contract
## Contract
- registerAgent: declare zones and parent
- assembleContext: child inherits shared/retrievable from parent, not private
- buildTelemetry: source IDs, token counts, redacted previews
- isTelemetrySafe: detect leaked SSN/secret in telemetry
## Dependencies: P4-03, P6-04, P2-02
