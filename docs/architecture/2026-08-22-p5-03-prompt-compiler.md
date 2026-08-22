# Agent Note: P5-03 — Prompt Compiler
## Problem
No provider-specific prompt compilation with capability negotiation.
## Contract
- compilePrompt: input + provider → compiled prompt with warnings
- getCapability: provider → capability info
## State Machine
input → getCapability → compile → (adapted|warnings)
## Failure Semantics
- Unsupported feature: warning, feature dropped
- Stop sequences: truncated to limit
## Rejection
- None (graceful degradation with warnings)
