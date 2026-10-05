# Agent Note: npm publish jobs check downloaded tarballs against the evidence package

Status: implemented

English | [中文](2026-10-05-npm-publish-jobs-check-downloaded-tarballs-against-the-evidence.zh.md)

## Problem

In `release-publish.yml`, `release-vendor-publish.yml` and `node-addon-system-release.yml`, the pack job verifies the release evidence package and uploads the tarballs; the publish job runs on a fresh runner, downloads them, and publishes them without reading the package. "A release cannot complete without its evidence verifying" held only through the artifact passed between the two jobs (BLOCKED-362).

## Decision

- The pack job uploads the evidence package as its own artifact, after the tarballs, and reports the package's sha256 as the job output `evidence-sha256`.
- Each publish job downloads both and, before it publishes, runs `scripts/release/verify-published-artifacts.mjs`: the package's sha256 must equal the job output, it must record `accepted: true`, the files under the downloaded directory must be exactly its `requiredBuildArtifacts` keys, and each file's sha256 must equal the recorded digest. The step has no condition and no `continue-on-error`.
- The script imports only Node builtins, because the node-addon publish job installs nothing.

## Alternatives considered

- **Re-run `verify-evidence.mjs` in the publish job.** It re-derives the baseline and the working-tree diff from the pack job's checkout, which a fresh runner does not have, and it reaches `js-yaml` through `baseline-fingerprint.mjs`.
- **An artifacts-only mode inside `verify-evidence.mjs`.** It would still import `js-yaml` and change an accepted verifier.

## Consequences

- A tarball that differs from what the pack job recorded, or an evidence package other than the one it reported, stops the publish job before the registry is touched.
- The publish-side check runs only in a real release; its structure is pinned by a case, and the script's behaviour by `scripts/release/verify-published-artifacts.spec.ts`.
