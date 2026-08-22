# @deepseek-ai/dsh-execution-world-container
Container ExecutionWorld provider.
## Overview
- ContainerRuntime: create, terminate, attest, cleanup
- Image digest verification
- Docker socket and host home mount prevention
- Reproducibility hash
## Key Invariants
- Docker socket mount: forbidden
- Host home mount: forbidden
- Image digest: verified
- Cleanup: no residual containers
