# Agent Note: Entries start without `import.meta.main`

Status: implemented

English | [中文](2026-09-28-entries-start-without-import-meta-main.zh.md)

## Problem

Seventeen non-test entries started their CLI only `if (import.meta.main)`. On Node v24.0.0, which the root `engines` range `^22.19.0 || >=24.0.0` admits, `import.meta.main` is undefined, so each entry did nothing and exited 0: workflow run 36402168106 measured it for `baseline-fingerprint.mjs verify` (BLOCKED-351). For that command it breaks P0-01 must[1], 「将审计 SHA 写入文档和机器文件；任何执行批次开始前必须 verify，发现上游漂移时停止并生成 rebase report。」, by failing open (BLOCKED-305). For `dsh` itself it is a command that runs nothing and reports success.

## Decision

- **Every entry compares `process.argv[1]` with its own file**, as `scripts/clean.ts` and `scripts/first100/verify-adapt-dispositions.mjs` already did: `resolve(process.argv[1])` against `fileURLToPath(import.meta.url)`.
- **An entry started through a symlink compares the real path**, after checking that `argv[1]` names a file: `apps/cli/src/bin.ts` (the `dsh` bin link), `packages/subprocess/subprocess-local/src/bin.ts`, and `apps/desktop-host/src/index.ts`, which the desktop app starts from `node_modules`. Node gives the main module the real path as its URL. The packaged SDK runtime imports `lib/bin.js` and calls `runCli()` itself, so there `argv[1]` may be an argument rather than a file, and the check must not throw.
- **The engines range stays.** The delegate kept it, since the repository's existing guards were written for the whole range.
- Attribution, file by file:
  - P0-01 (BLOCKED-305): `scripts/release/baseline-fingerprint.mjs`, `scripts/release/collect-evidence.mjs`, `scripts/release/verify-evidence.mjs`.
  - BLOCKED-351: `apps/cli/src/bin.ts`, `apps/desktop-host/src/index.ts`, `packages/subprocess/subprocess-local/src/bin.ts`, `apps/desktop/scripts/prepare-package-set.ts`, and under `scripts/`: `benchmark-next-package-dependency.ts`, `benchmark-npm-resolution.ts`, `build.ts`, `run-gates.ts`, `verify-cordis-config.ts`, `verify-doc-site-fragments.ts`, `verify-npm-install-layout.ts`, `verify-package-dependencies.ts`, `verify-package-readme-summaries.ts`, `verify-runtime-closure.ts`.

## Alternatives considered

- **Raise the engines floor to a Node 24 release with `import.meta.main`.** A range the code does not honour misleads users, and the repository's own guards already cover the whole range.
- **`import.meta.filename`.** It is available across the range, but the repository's guard compares `fileURLToPath(import.meta.url)`, and one form is kept.

## Consequences

- On Node v24.0.0, `dsh`, `baseline:verify` and the gate scripts run as they do on later releases. Running the `node_version_probe` workflow input again on this fix is BLOCKED-351's closing condition 4.
- This note supersedes in part [Evidence verification re-derives the baseline, binds the gate manifest, and reports the accepted status](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.md): its item on the `import.meta.main` guard no longer holds.
