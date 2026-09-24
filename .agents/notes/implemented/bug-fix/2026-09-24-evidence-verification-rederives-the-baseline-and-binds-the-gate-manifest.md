# Agent Note: Evidence verification re-derives the baseline, binds the gate manifest, and reports the accepted status

Status: implemented

English | [中文](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.zh.md)

## Problem

`scripts/release/verify-evidence.mjs` re-hashed `.dsh/baseline.json` against the digest the package recorded, but never re-derived the fingerprint that file records from the checkout. A change to a file the fingerprint covers, made after collection, therefore passed verification as long as `.dsh/baseline.json` itself was untouched (BLOCKED-304). The sidecar `manifest.json`, which lists the required gate ids and artifact paths declared at `collect-evidence.mjs init`, was not bound to the package either, so an edit to it after collection also passed. And the verifier's result line named the package but not its `accepted` status, the second fact a report of this gate cites.

## Decision

- **Verification re-derives the baseline.** When `.dsh/baseline.json` still matches the recorded digest, `verify` calls P0-01's `verifyBaseline` on the checkout and reports each drift entry as a mismatch.
- **The gate manifest is bound to the package.** `collect-evidence.mjs init` writes `manifest.json` before signing and records its digest as the package's optional `sidecarManifestDigest`, which the package signature covers. `verify` reports a manifest whose digest differs, and a package that lacks the field.
- **The result line says `accepted=true` only for a package that verified clean and records the boolean `true`.** A package that fails verification says `accepted=false` and names the value it records in words, and an `accepted` that is not a boolean is itself a mismatch.
- **The package binds the working tree as it stands after the last collection step.** Each step (`init`, `run`, `build-artifact`) records `git diff --binary <baseSha>` together with every untracked file git does not ignore, and every untracked `.gitignore` whether ignored or not, as a patch against `/dev/null`, leaving out the package's own file and sidecar directory. `verify` takes the same patch again and compares digests, so a change made after the last step fails verification, whether committed, uncommitted, a new untracked file, or a new `.gitignore` that ignores itself.
- **The patch is git's own, taken from the working tree.** Both diffs run with `--no-ext-diff --no-textconv`, so an external diff program or a textconv filter in the git configuration cannot replace it. A checkout whose index marks a file skip-worktree or assume-unchanged is refused, because `git diff` reads the index for such a file, and so is an untracked entry for which git produces no patch, such as a symbolic link to a directory or a nested repository.
- **A check that cannot run is a named mismatch.** Missing git or pnpm, a directory that is not a git checkout, and a package or manifest that is not valid JSON each become a mismatch, and a package that parses but lacks a field `verify` reads is reported as `verify could not complete`, so the result line is always printed.

## Alternatives considered

- **Exclude the toolchain fields from drift.** Not chosen: the smallest change keeps P0-01's fingerprint whole. An offline re-verification therefore needs the collecting checkout's HEAD, Node and pnpm, which the exact-SHA workflow's upload comment states.
- **A required `sidecarManifestDigest` field.** Not chosen: the frozen Contract-stage cases build package literals without it, and an optional field keeps them valid while `verify` still refuses a package that lacks it.

## Consequences

- An offline re-verification must run on the collecting checkout's HEAD with the same Node and pnpm versions; anything else is reported as drift. When it finds drift, `verifyBaseline` writes `.dsh/rebase-report.json`.
- Each verification now runs `git`, `node --version` and `pnpm --version`.
- A package collected before this change has no `sidecarManifestDigest` and fails verification.
- A change made between `init` and the last collection step belongs to the tree the package describes and is not reported. A gate that writes a file git does not ignore has that file bound with it.
- Files ignored by the ignore rules in effect at collection are not bound. This repository ignores `.env`, `mise.toml` and `.vscode/`, among others, so a change to one of them after collection passes verification. Rules outside the tree, in `.git/info/exclude` or the global `core.excludesFile`, are rules in effect as well: a rule added there after collection hides a new file from verification.
- A checkout that marks files skip-worktree, as a sparse checkout does, cannot be collected, and neither can one holding an untracked symbolic link to a directory or a nested repository.
- `main()` runs behind an `import.meta.main` guard, so a Node release without `import.meta.main` would run nothing and exit 0. This predates the fix and is tracked as BLOCKED-305.
- The fix is commit `775c25640a`. A later commit message cites `bed753dfe2`, which is this note's documentation commit.
