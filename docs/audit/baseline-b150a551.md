 # Audit Baseline

 | Field | Value |
 | --- | --- |
 | Repository | `deepseek-ai/deepseek-harness` |
 | Fork | `123oqwe/deepseek-harness` |
 | Audit SHA (manifest) | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
 | Local HEAD SHA | `47f943859bef60e4160492346772ded9b24f765a` |
 | Date | 2026-08-22 |
 |
 | The manifest's audit SHA `b150a551` does not exist in the local clone. The local HEAD `47f943859b` is used as the working baseline. Path-migration-map: none needed — all `baseline` paths verified present.

 ## Purpose

 Every downstream optimization issue must bind its changes to a known source state. This baseline fingerprint records architecture- and protocol-critical surfaces so that drift is detected before any issue begins.

 ## Usage

 ```sh
 pnpm baseline:capture   # write .dsh/baseline.json
 pnpm baseline:verify    # compare current state to .dsh/baseline.json
 ```

 ## Fingerprint Surfaces

 | Category | Files |
 | --- | --- |
 | Schema (protocol & events) | `packages/sdk/protocol/src/types.ts`, `packages/core/session/src/types.ts`, `packages/core/session/src/known-event-types.ts`, `packages/bundle/base/cordis.patch.yml`, `packages/core/agent/src/types.ts`, `packages/core/agent-loop/src/runtime-context.ts` |
 | Manifests | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
 | Bundle row IDs | Extracted from `packages/bundle/base/cordis.patch.yml` |
 | Workspace packages | All `package.json` names under `packages/*/*` and `vendor/*` |

 The fingerprint excludes build artifacts, timestamps, and other non-deterministic data.

 ## Verification

 - `pnpm baseline:verify` exits 0 on a clean checkout.
 - Tampering any schema file, manifest, or bundle row causes exit 1 with a minimal diff.
 - The same clean checkout produces the same normalized fingerprint on macOS and Linux.
