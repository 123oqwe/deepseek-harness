# P0-03: Capability Seam Architecture Consistency Checker

## Problem
The repository's Service Definition / Provider / Consumer principle relied on AGENTS.md and human review. Large refactors can introduce consumer-to-provider deep imports, providers with business protocol, or hardcoded provider implementations in agent-loop.

## Contract
- `architecture.layers.json` declares each capability family's definition, providers, consumers, and allowed dependency edges.
- `scripts/architecture/check-capability-seams.mjs` scans imports and enforces rules.
- `pnpm architecture:seams` runs the checker as a gate.
- Allowlist entries must carry a removal date and owner.

## Failure Semantics
- Consumer deep-imports provider src/*: violation (unless allowlisted)
- Provider depends on app/UI: violation
- Kernel depends on product packages: violation
- Expired allowlist entry: violation

## Compatibility
- New files only; no existing packages modified
- Adds `tests/**/*.spec.ts` to vitest includes (for tests/ directory)

## Rejection
- Not introducing vertical business logic
- Not replacing existing import analysis tools
