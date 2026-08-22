 # Trust Kernel Boundary

 The Trust Kernel is the minimal immutable computing base (TCB) of the Harness. It is initialized before any Cordis Context is created and cannot be replaced, overridden, or unregistered by any plugin.

 ## What the Kernel Owns

 1. **Root identity**: A principal established at boot with a stable UUID. All capability requests and audit records carry this principal.

 2. **Policy enforcement entrypoint**: The kernel checks its immutable deny set first. A kernel `deny` is final and monotonic — no plugin can override it. Non-kernel capabilities are delegated to plugin-level policy.

 3. **Audit chain root**: A tamper-evident append-only log using SHA-256 hash chaining. Each record's hash includes its sequence number, type, payload, and the previous record's hash. The chain head is exposed for external verification.

 4. **Signature verification root**: Trusted root key IDs are configured at boot. Signature verification accepts only signatures from trusted roots. In insecure mode, all signatures are accepted with a warning.

 5. **Tenant boundary**: Principals are scoped to their tenant. Cross-tenant access is denied at the kernel level.

 6. **Sandbox attestation**: At boot, the kernel verifies that the sandbox mechanism is active. In production mode, failed attestation prevents boot. In insecure mode, attestation is skipped with a permanent warning.

 ## What Stays Pluggable

 | Capability | Why it stays a plugin |
 | --- | --- |
 | Models (LLM adapters) | Implementation and vendor change fast |
 | Tools | Domain-specific, varies per task |
 | Storage providers | Implementation varies (SQLite, JSONL, etc.) |
 | Workflow | Business logic, domain-specific |
 | Memory providers | Implementation varies (vector DB, graph, etc.) |
 | UI | Presentation layer, not security-critical |

 ## What Is Never a Plugin

 | Responsibility | Why it is kernel-only |
 | --- | --- |
 | Root identity | Cannot be forged by a plugin |
 | Deny enforcement | Must be monotonic and final |
 | Audit chain root | Must be tamper-evident from boot |
 | Signature verification root | Must not be bypassed by untrusted code |

 ## Invariants

 1. The kernel is initialized exactly once. Re-initialization throws.
 2. Kernel deny capabilities are permanently denied, even in insecure mode.
 3. The audit chain is append-only. No record can be rewritten.
 4. The kernel API exposes only structured types, no model-visible text.
 5. The kernel has no dependency on any Cordis product package.

 ## Insecure Mode

 For development, the kernel can be initialized with `insecure: true`. This:
 - Skips signature verification (accepts all)
 - Skips sandbox attestation (marks as not attested)
 - Still enforces kernel-level deny (monotonic)
 - Prints a permanent warning

 Production profiles must never enable insecure mode.
