# Agent Note: A batch verifies the committed baseline first

Status: implemented

English | [中文](2026-10-03-a-batch-verifies-the-committed-baseline-first.zh.md)

## Problem

P0-01 must[2] asks that every execution batch verify against the locked baseline before it runs, and stop with a rebase report on upstream drift. `baseline-fingerprint.mjs` reported a different HEAD as drift, so a baseline locked at any earlier commit always failed. The boot preflight therefore stayed disabled, and CI and the release workflows captured a fresh baseline before verifying it, which can never find drift. No shipped path verified the locked baseline (P0-01 blind review 1-1).

## Decision

- `verifyBaseline` takes a head policy. `'context'`, used by `pnpm baseline:verify` and the preflight, counts only changes to fingerprinted surfaces; the baseline's commit and the current one are named in the output and in `.dsh/rebase-report.json`. `'bound'`, used by `collect-evidence` and `verify-evidence`, keeps a different HEAD as drift, because an evidence package binds one exact commit.
- `first100-exact-sha.yml` verifies the committed `.dsh/baseline.json` before the step that captures over it, stops the job on drift and uploads the rebase report. The release workflows verify the committed baseline before recapturing.
- A batch that changes a fingerprinted surface commits its recaptured baseline, taken from a CI capture, with its records.
- The preflight stays disabled by default; its reason is now that an uncommitted manifest edit in a development checkout would abort every boot.

## Alternatives considered

- **Enable the preflight by default.** The check would run at every boot on developer machines, where uncommitted edits are normal, while the batch-start check belongs to CI.

## Consequences

- A batch whose code changes a manifest, a bundle row, a protocol schema or the lockfile without a recaptured baseline stops at the first CI step, with the drifted surfaces named.
