# P0-03: Capability Seam architecture consistency checker

**Date:** 2026-08-22
**Issue:** P0-03
**Status:** E2E_VERIFIED

## What changed
- Ported scripts/architecture/check-capability-seams.mjs and architecture.layers.json.
- Added type declaration file check-capability-seams.d.mts for type-safe imports.
- Wired checker into first100:architecture gate alongside typecheck.
- Added check:capability-seams script to package.json.
- 8 integration tests covering layer validity, kernel isolation, deep-import detection, provider deps, allowlist expiry, family completeness.
