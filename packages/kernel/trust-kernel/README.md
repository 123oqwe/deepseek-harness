 # Trust Kernel

 The minimal immutable Trust Kernel is the only non-pluggable part of the Harness. It owns the root security primitives that plugins must not replace or bypass.

 | Responsibility | Description |
 | --- | --- |
 | Root identity | Established at boot, before any plugin loads |
 | Policy enforcement | Deny is monotonic and final; plugins cannot override kernel deny |
 | Audit chain | Tamper-evident append-only log with SHA-256 chain |
 | Signature verification | Trusted root keys verified at boot |
 | Tenant boundary | Principals are scoped to their tenant |
 | Sandbox attestation | Verified at boot; insecure mode for development only |

 ## What stays a plugin

 Models, tools, storage providers, workflow, memory providers, and UI remain fully pluggable.

 ## What is never a plugin

 Root identity, deny enforcement, audit chain root, and signature verification root are kernel-only and cannot be replaced, overridden, or unregistered.

 ## Usage

 ```ts
 import { initTrustKernel, requireKernel } from '@deepseek-ai/dsh-trust-kernel'

 // Initialize before any Cordis Context
 const handle = initTrustKernel()
 const kernel = requireKernel()

 // Policy evaluation (kernel deny is final)
 const result = kernel.evaluatePolicy({ capability: 'fs:write', principal: kernel.principal })
 ```

 ## Insecure mode

 Development mode (`insecure: true`) skips signature verification and sandbox attestation with a permanent warning. Production mode fails closed.
