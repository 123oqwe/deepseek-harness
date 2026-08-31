# Baseline fingerprint report format — `pnpm baseline:capture` (P0-01 C-stage specimen)

Status: CONTRACT SPECIMEN. This is the canonical-format example for the
report `pnpm baseline:capture` writes to
`docs/audit/baseline-fingerprint-<gitSha>.md`, authored as part of P0-01's
C-stage (contract) micro-PR. `scripts/release/baseline-fingerprint.mjs` does
not exist yet — that is P0-01's P-stage — so this file is a hand-authored
specimen the contract test (`tests/release/baseline-fingerprint.spec.ts`)
and the machine-file specimen (`.dsh/baseline.json`) validate their shape
against, not a live tool-generated capture. It describes the frozen baseline
`0a53fb55bea101816fa226bb964ae2bed71c343b` (`tests/first100/registry.json`'s
`frozenBaseline`), which is why this specimen's SHA and `.dsh/baseline.json`'s
`gitSha` match.

This is a different artifact class from `docs/audit/baseline-0a53fb55.md`:
that file is the Supervisor's own R0.3A native-CI/pack governance health
receipt (test-suite-result evidence); this one documents the
Git-SHA+Node/pnpm-versions+workspace-package-list+protocol-schema-hashes
fingerprint format that `baseline:capture`/`baseline:verify` produce and
check. Path split recorded in `tests/first100/adjudication.json`'s
`deliverablePathPatches.entries.P0-01` (BLOCKED-001):
`docs/audit/baseline-<sha>.md` stays reserved for Supervisor governance
receipts; the `baseline:capture` family uses
`docs/audit/baseline-fingerprint-<sha>.md`.

## 1. Identity

- Frozen baseline SHA: `0a53fb55bea101816fa226bb964ae2bed71c343b`
- Toolchain this specimen assumes: Node `24.18.0`, pnpm `11.7.0`
  (`package.json`'s `packageManager: pnpm@11.7.0`, `engines.node: ^22.19.0
  || >=24.0.0`)

`pnpm baseline:capture` writes the same SHA into this doc's filename/body
and into the machine file `.dsh/baseline.json`'s `gitSha` field — the two
must always agree; `pnpm baseline:verify` treats a mismatch as drift.

## 2. `.dsh/baseline.json` field reference

| field | meaning | in the hash? |
|---|---|---|
| `formatVersion` | integer, bumped only on a structural change to this schema | yes |
| `gitSha` | full 40-character `git rev-parse HEAD` of the captured checkout | yes |
| `toolchain.node` / `toolchain.pnpm` | exact captured `node --version` / `pnpm --version`, signed metadata that must match the declared toolchain profile (`package.json`'s `engines`/`packageManager`) | yes |
| `workspacePackages` | sorted array of every workspace `package.json`'s `name` (from `pnpm-workspace.yaml`'s patterns) | yes |
| `defaultBundleRowIds` | sorted array of every row `id` in `packages/bundle/base/cordis.patch.yml` | yes |
| `protocolSchemaHashes` | map of POSIX-relative path to SHA-256 hex digest, one entry per key protocol/event schema file (at minimum `packages/sdk/protocol/src/types.ts` and `packages/core/session/src/known-event-types.ts`) | yes |

Build artifacts (`lib/`, `dist/`), timestamps, hostnames, OS name, and
absolute or backslash-spelled paths are excluded from both the file and the
hash: the fingerprint covers only the architecture/protocol-critical
surface, per `spec/first100/sources/implementation-wave-map.md` line 57's
P0-01 gate note.

## 3. Canonicalization rules

`baseline:capture`'s output — this doc and `.dsh/baseline.json` alike — must
be reproducible byte-for-byte from the same commit on Linux and macOS:

- JSON keys sorted at every object level (top-level and nested, e.g.
  `protocolSchemaHashes`'s path keys).
- UTF-8, normalized to NFC.
- LF line endings only, no `\r`.
- All paths POSIX-relative to the repository root (`packages/…`, never
  `C:\…` or an absolute path) — no OS name or path-spelling differences
  leak into the fingerprint.
- No timestamps, hostnames, process ids, or other nondeterministic fields.

## 4. `pnpm baseline:verify`

Run before any execution batch begins. On a clean checkout it re-derives
the same fields from the working tree and exits `0` when they match the
last capture. On drift — any tracked schema, bundle-row, or package
manifest file changed since capture — it exits nonzero, names the minimal
diff (the specific changed path(s), not a generic "mismatch"), and writes a
rebase report to `.dsh/rebase-report.json` so the run stops instead of
optimizing against a moved target. Restoring the drifted file(s) makes
`verify` pass again.

## 5. Honesty — what this specimen does and does not establish

- **Does establish:** the canonical field set, canonicalization rules, and
  capture/verify contract that `tests/release/baseline-fingerprint.spec.ts`
  holds the eventual `scripts/release/baseline-fingerprint.mjs` to.
- **Does NOT establish:** that `baseline:capture`/`baseline:verify` exist or
  run — they do not yet (P0-01 P-stage). No `pnpm baseline:capture` or
  `pnpm baseline:verify` script is registered in `package.json` as of this
  specimen. The contract test's real subprocess invocations of
  `scripts/release/baseline-fingerprint.mjs` fail today for exactly that
  reason.
