 # P0-02: Minimal Immutable Trust Kernel Boundary

 ## Problem
 The existing architecture emphasizes "everything is a plugin" with no privileged core. While excellent for composability, this leaves security roots (identity, policy enforcement, signature verification, audit integrity) replaceable by the very plugins they constrain.

 ## Contract
 - The Trust Kernel is initialized before any Cordis Context is created, via `initTrustKernel()`.
 - It owns: root identity, policy enforcement entrypoint, audit chain root, signature verification root, tenant boundary assertion, and sandbox attestation verification.
 - Kernel deny is monotonic and final — no plugin can override it, even in insecure mode.
 - The kernel is a singleton; re-initialization throws.
 - Plugins receive only a narrow interface and an unforgeable handle.

 ## State Machine
 - Uninitialized -> initTrustKernel() -> Initialized
 - Initialized -> (any plugin attempt to replace) -> rejected
 - Initialized -> resetKernelForTesting() -> Uninitialized (tests only)

 ## Failure Semantics
 - Not initialized: `requireKernel()` throws
 - Re-initialization: throws "already initialized"
 - Kernel deny: returns deny with source=kernel (final, not delegable)
 - Untrusted signature: returns valid=false
 - Insecure mode: skip verification with permanent warning

 ## Compatibility
 - New package: `@deepseek-ai/dsh-trust-kernel` under `packages/kernel/`
 - No existing packages modified
 - Production profiles must initialize the kernel before boot
 - Development profiles may use insecure mode

 ## Rejection
 - Not rewriting the entire Harness into a microkernel
 - Only solidifying the minimal non-bypassable boundary
