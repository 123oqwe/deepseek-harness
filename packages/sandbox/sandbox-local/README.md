# @deepseek-ai/dsh-sandbox-local-conformance
Local sandbox cross-platform fail-closed hardening.
## Overview
- probeCapabilities: platform → attestation with capabilities and unsupported features
- validateConfig: config → result with errors
- isFailClosed: attestation → boolean
## Key Invariants
- Missing seccomp on Linux: fail
- Missing clipboard on macOS: fail
- Missing device restriction on Windows: fail
