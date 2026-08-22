# @deepseek-ai/dsh-local-isolation
Process, syscall, IPC and device isolation for local sandbox.
## Overview
- Linux: user/pid/net/mount namespaces, seccomp, Landlock, bwrap
- macOS: Seatbelt sandbox
- Windows: restricted token, job object, ACL
- Device restrictions: clipboard, camera, GPU, Docker socket, SSH agent
## Key Invariants
- Unsupported features reported, not silently ignored
- Platform capability attestation included
- Docker socket and SSH agent always restricted
