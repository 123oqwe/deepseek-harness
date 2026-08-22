# Audit Baseline

| Field | Value |
| --- | --- |
| Repository | `deepseek-ai/deepseek-harness` |
| Fork | `123oqwe/deepseek-harness` |
| Required audit SHA | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Integration branch | `integration/first-100-rebuild` |
| Integration branch HEAD | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Date | 2026-08-22 |

The integration branch is created from the latest official upstream/master. The recorded baseline SHA exactly equals the integration branch HEAD.

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
| Schema (protocol and events) | `packages/sdk/protocol/src/types.ts`, `packages/core/session/src/types.ts`, `packages/core/session/src/known-event-types.ts`, `packages/bundle/base/cordis.patch.yml`, `packages/core/agent/src/types.ts`, `packages/core/agent-loop/src/runtime-context.ts` |
| Manifests | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` |
| Bundle row IDs | Extracted from `packages/bundle/base/cordis.patch.yml` |
| Workspace packages | All `package.json` names under `packages/*/*` and `vendor/*` |

The fingerprint excludes build artifacts, timestamps, and other non-deterministic data.

## Verification

- `pnpm baseline:verify` exits 0 on a clean checkout.
- Tampering any schema file, manifest, or bundle row causes exit 1 with a minimal diff.
- The same clean checkout produces the same normalized fingerprint on macOS and Linux.
- `baseline:verify` checks that the current HEAD matches the recorded `git_sha`.
