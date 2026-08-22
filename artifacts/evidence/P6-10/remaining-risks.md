# P6-10 Remaining Risks

1. Classification rules are pattern-based; advanced PII (names, addresses) not covered.
2. Redaction is in-memory; persistence-layer redaction hooks not wired to all sinks yet.
3. Fork/snapshot purpose filtering is defined but not yet integrated into session fork path.
4. Legal hold reporting is stubbed; full backup traversal not implemented.
