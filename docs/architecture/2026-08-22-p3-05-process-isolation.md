# Agent Note: P3-05 — Process, Syscall, IPC & Device Isolation
## Problem
File root restrictions cannot prevent ptrace, process enumeration, Unix sockets, device nodes, and privileged syscalls.
## Contract
- IsolationConfig: platform + namespace flags + device restrictions
- probeIsolation: platform → attestation with capabilities and unsupported features
- validateIsolation: config → result with attestation
## State Machine
probe → attestation → validate → (pass|fail)
## Failure Semantics
- Unsupported platform features: reported, not silently ignored
- Missing required restrictions: validation fails
- Docker socket/SSH agent: always required to be restricted
## Rejection
- No seccomp on Linux: rejected
- No clipboard restriction on macOS: rejected
- No device restriction on Windows: rejected
