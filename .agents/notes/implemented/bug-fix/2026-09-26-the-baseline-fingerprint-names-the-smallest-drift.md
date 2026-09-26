# Agent Note: The baseline fingerprint names the smallest drift, and no longer depends on the capturing toolchain

Status: implemented

English | [中文](2026-09-26-the-baseline-fingerprint-names-the-smallest-drift.zh.md)

## Problem

BLOCKED-305 conditions [0] and [1], P0-01 acceptance[0] and [1]. `scripts/release/baseline-fingerprint.mjs` recorded the Node and pnpm versions of the machine that captured a baseline, and verify compared them exactly, so one clean checkout captured under two toolchains gave two baselines and failed verify. Lane A's A-448 measured three such cases. The fingerprint also covered bundle rows only by id and packages only by name. A changed row name, config or `disabled` flag, a changed package version, dependencies or scripts, an edited root `package.json` and an edited `spec/*.schema.json` all verified clean. An added row, or a renamed package, was reported as the whole id or name list, the rename under another file. A-449 measured eleven red cases.

## Decision

- **Format 2.** A baseline in another format reports the format difference alone.
- **The toolchain the checkout declares.** `toolchain` holds the root `package.json`'s `engines.node` and the pnpm version its `packageManager` pins, `null` where it declares none, and verify does not compare it: a change to the declaration is a change to that manifest. The Node and pnpm that ran the capture are written to the audit document, so must[0] still records them.
- **Package manifests field by field.** `packageManifests` maps each manifest, the root one included, to the sha256 of each top-level field's canonical value. A drift names the manifest and the field.
- **Bundle rows by content.** `bundleRows` holds the rows in document order and each row's content hash, with rows nested inside it replaced by their ids. A row added or removed is reported once, as `defaultBundleRowIds`, with only the ids that moved. A changed row is reported as `row <id>`, and a reordering among the rows both sides hold as `row order`.
- **Key schemas.** `protocolSchemaHashes` also covers `spec/*.schema.json`.
- **Package membership.** A `workspacePackages` drift names only the package names that moved.

## Alternatives considered

- **One hash per manifest, with field differences read at verify from the baseline commit through git.** The baseline would stay near 35 KB instead of about 400 KB, but verify would then need the baseline commit to be readable, which a shallow CI clone or an installed package may not have, and the capture tree to have been clean. The delegate chose field hashes on 2026-09-26.
- **Normalizing a toolchain to its major version.** Captures under two majors would still differ, which acceptance[0] does not allow; the declared toolchain belongs to the checkout, not to the machine.

## Consequences

- The committed `.dsh/baseline.json` stays in format 1 until it is recaptured, and the frozen C-stage case that compares a capture's key set with it fails until then. As the delegate ruled, the recapture is taken from the next observation batch's CI evidence package and committed with its audit document in a later record batch; no capture runs locally.
- For this repository the baseline grows to about 400 KB.
- An offline re-verification by `verify-evidence.mjs` needs the collecting checkout's HEAD and no longer its toolchain.
- Verification: A-448 (`tests/release/baseline-fingerprint-normalized.spec.ts`), A-449 (`tests/release/baseline-fingerprint-classes.spec.ts`) and the frozen C-stage `tests/release/baseline-fingerprint.spec.ts`.
