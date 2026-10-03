# Agent Note: A confined command cannot write the harness home

Status: implemented

English | [中文](2026-10-03-a-confined-command-cannot-write-the-harness-home.zh.md)

## Problem

`workspace-write` granted writes under the workspace root, `/tmp` and `os.tmpdir()`, and nothing excluded the harness home. The default home `~/.dsh` lies inside any workspace at or above `~`, so the model's `write`, `edit` and `bash` could create and change files there with no approval (B-713; A-597 ① and ② observe it on the shipped headless launch). The home holds the harness's own configuration and state: profiles and their patch layers, the settings document the enforced policy set comes from (P2-05), trust anchors, saved workflows, the action ledger directory (P4-12) and the credential store. A model steered by text in the workspace could therefore rewrite the policy that judges its next call, mount a plugin by path, or edit the ledger.

## Decision

- **One source.** `protectedRoots(policy)` in `@deepseek-ai/dsh-sandbox`, beside `writableRoots`, returns the canonical `$DSH_HOME` under `workspace-write` and nothing under `read-only`. `@deepseek-ai/dsh-sandbox` now depends on `@deepseek-ai/dsh-home-paths` for the home's resolution.
- **The fs fence.** `@deepseek-ai/dsh-fs-sandbox` refuses a write or edit whose fresh canonical target lies under a protected root with `FS_SANDBOX_DENIED`, after the writable-root containment check.
- **bwrap.** After the workspace's writable bind, a protected root inside the workspace is bound read-only. A home under the host `/tmp` is already hidden by the `/tmp` tmpfs; a home that does not exist is not bound, because bwrap cannot bind a missing path.
- **Seatbelt.** `(deny file-write* (subpath $DSH_HOME))` follows the writable-root grant. In SBPL the later of two matching rules wins; the existing profile already relies on that for its grant after `(deny file-write*)`, and a one-off `sandbox-exec` run on macOS confirmed that a later subpath deny wins over an earlier subpath allow.
- **Landlock and the Windows ACL runner.** Both can only grant writable roots. When a protected root lies under any writable root (the workspace, `/tmp` or `os.tmpdir()`), `confine` refuses the command with `SANDBOX_UNAVAILABLE` and names the home and the fix: start in a workspace that does not contain `$DSH_HOME`, or move `DSH_HOME`.

## Alternatives considered

- **Carry the home on `SandboxExecutionPolicy`, filled by `@deepseek-ai/dsh-sandbox-policy`.** That package does not resolve the home either, and every literal that builds a policy would change. One helper beside `writableRoots` keeps one source for every backend.
- **Refuse Landlock only when the workspace contains the home.** A home under `/tmp` or `os.tmpdir()` is the same gap on those backends, so the refusal covers every writable root.
- **Exclude only the files known to matter (the policy settings, the patch layers).** The home's layout grows; a new file under it would reopen the gap.

## Consequences

- A confined command, or the `write` and `edit` tools under `workspace-write`, can no longer change the harness home. Changing it from the model takes `danger-full-access`, approved call by call. This also closes the model's path to rewriting the P2-05 policy set and the P4-12 ledger directory.
- A Landlock or Windows host refuses every confined command while the workspace or a temp area contains `$DSH_HOME`; the error says how to move it.
- Not covered: reads of the home are unchanged (B-717 refuses reads of the credential files); network egress is unchanged (B-719′); `run_code` is not confined by the OS sandbox at all (question 34); the Seatbelt rule is observed on a developer Mac and the Windows refusal by unit tests only, since no CI job runs either platform's backend.
