# P0-06: Unified Schema Registry

**Date:** 2026-08-22
**Issue:** P0-06
**Status:** E2E_VERIFIED

## Context
Prototype PR (#3) was a standalone scaffold not wired into the boot path.

## What changed
- Ported packages/schema/schema-registry with types, migrate, index, tests.
- Wired registerBuiltinSchemas() into packages/boot/app-boot/src/index.ts before new Context().
- Added schema-registry to tsconfig.host.json and pnpm workspace.
- 4 built-in schemas registered: session-event, sdk-protocol, plugin-manifest, settings.
- 18 integration tests covering registration, compatibility, negotiation, migration.

## Verification
- 18 tests pass in compatibility.spec.ts.
- 48 total tests pass (P0-01 + P0-02 + P0-06, no regression).
- Typecheck and lint pass.
