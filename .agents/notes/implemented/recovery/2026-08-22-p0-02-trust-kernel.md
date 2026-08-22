# P0-02: Minimal Immutable Trust Kernel boundary

**Date:** 2026-08-22
**Issue:** P0-02
**Status:** E2E_VERIFIED

## Context

The prototype PR (#2) had three security stubs: signature verification accepted any bytes when keyId was listed, sandbox attestation returned hardcoded success, and audit records lived in an in-process array. The kernel was not initialized in the real boot path.

## What changed

- Created `packages/kernel/trust-kernel/` with `src/index.ts`, `src/types.ts`, `src/invariant.ts`.
- Fixed signature verification: uses `node:crypto.verify()` with real RSA-SHA256 public-key crypto. Random bytes are rejected even with a trusted keyId.
- Fixed sandbox attestation: queries the real OS environment (macOS Seatbelt/App Sandbox, Linux seccomp/namespace). Returns attested=false when no sandbox is detected.
- Fixed audit storage: durable append-only file at `.dsh/trust-audit.log`. Chain head and sequence survive process restart.
- Wired kernel initialization into `packages/boot/app-boot/src/index.ts` before `new Context()`. The handle is provided to the Cordis Context as `ctx.trustKernelHandle`.
- Added trust-kernel to `tsconfig.host.json` references and `pnpm-workspace`.
- 19 integration tests covering: initialization, re-init prohibition, monotonic deny, delegation, tamper-evident audit, durable audit (survives restart), real crypto verification (reject random, accept valid), untrusted key rejection, tenant boundary, sandbox attestation, API safety.

## Verification

- 19 tests pass in `boundary.spec.ts`.
- Typecheck passes (tsc -b tsconfig.host.json + tsconfig.client.json).
- Lint passes (oxlint).
- `first100:preflight` passes with baseline:verify.
- Real RSA key pair generated in test; valid signature accepted, random bytes rejected.
- Audit log file verified on disk; chain continuity proven across simulated crash.
