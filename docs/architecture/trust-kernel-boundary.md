# Trust Kernel Boundary

The Trust Kernel is the only non-pluggable part of DeepSeek Harness. It owns the root security primitives that plugins must not replace or bypass.

## What the Kernel Owns

1. **Root identity** — established at boot before any plugin loads
2. **Policy enforcement** — deny is monotonic and final; no plugin can override a kernel deny
3. **Audit chain** — tamper-evident append-only log, durably stored on disk
4. **Signature verification** — real public-key cryptography (RSA-SHA256), not byte matching
5. **Tenant boundary** — principals are scoped to the kernel's tenant
6. **Sandbox attestation** — queries the real OS environment, not hardcoded success

## Immutability

The kernel singleton is set once at boot via `setKernel()`. Subsequent calls throw. No plugin can:
- Replace the kernel instance
- Override the policy enforcement entrypoint
- Rewrite the audit chain
- Override signature verification results
- Bypass tenant boundaries

## Production vs Development

- **Production** (default): the kernel fails closed if sandbox attestation fails
- **Development** (`DSH_INSECURE=1`): the kernel allows boot with a permanent warning; signature verification and attestation are skipped

## Durable Audit

Audit records are appended to `.dsh/trust-audit.log` as JSON lines. Each record contains:
- Monotonic sequence number
- Event type
- Canonical JSON payload
- SHA-256 hash of the previous record (chain)
- SHA-256 hash of this record

The chain is tamper-evident: modifying any record breaks the hash chain. The chain survives process restart: a new kernel instance loads the existing chain head from disk and continues from it.

## Boot Path Integration

The kernel is initialized in `packages/boot/app-boot/src/index.ts` before `new Context()` is called. The handle is provided to the Cordis Context as `ctx.trustKernelHandle`.

## Package

`@deepseek-ai/dsh-trust-kernel` at `packages/kernel/trust-kernel/`
