# Agent Note: P3-07 — Local Sandbox Cross-Platform Fail-Closed Hardening
## Problem
Local platform implementation capabilities differ; if a restriction fails but execution continues, it creates silent degradation.
## Contract
- probeCapabilities: platform → attestation
- validateConfig: config → result
- isFailClosed: attestation → boolean
## State Machine
probe → attestation → validate → (pass|fail)
## Failure Semantics
- Missing critical restriction: validation fails
- Level 'none': fail-closed
## Rejection
- No seccomp on Linux: rejected
- No clipboard restriction on macOS: rejected
