# Agent Note: P3-08 — Container ExecutionWorld Provider
## Problem
Long tasks, unknown dependencies, and third-party plugin builds need isolated filesystem/process/network namespaces.
## Contract
- ContainerRuntime: create, terminate, attest, cleanup
- Image digest verification
- Docker socket/host home mount prevention
## State Machine
created → running → (stopped|crashed|terminated)
## Failure Semantics
- Invalid image digest: rejected
- Docker socket mount: forbidden
- Host home mount: forbidden
## Rejection
- Invalid digest: rejected
- Docker socket: rejected
- Host home: rejected
