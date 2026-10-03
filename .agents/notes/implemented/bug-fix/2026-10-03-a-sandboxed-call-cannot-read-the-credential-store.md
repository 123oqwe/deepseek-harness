# Agent Note: A sandboxed call cannot read the credential store

Status: implemented

English | [中文](2026-10-03-a-sandboxed-call-cannot-read-the-credential-store.zh.md)

## Problem

The sandbox confined writes only. The model's `read`, `grep` and `bash` returned the harness's own credential store with no approval: `$DSH_HOME/.credentials.yaml`, which `@deepseek-ai/dsh-credentials-local` keeps, and the home-level `$DSH_HOME/.env` that `@deepseek-ai/dsh-app-boot` reads as a credential layer (B-716; A-598 observes all three on the shipped headless launch). The secret broker the Trust Kernel holds is bypassed when the secrets lie in a plain file the model can read and then send out.

## Decision

- **One list.** `unreadableFiles()` in `@deepseek-ai/dsh-sandbox`, beside `protectedRoots`, returns those two files under the canonical home, whether or not they exist yet. The names are written there rather than imported, because both owners are providers this capability definition must not depend on.
- **The fs fence.** `@deepseek-ai/dsh-fs-sandbox` refuses `readText`, `streamText`, `readBytes` and `readByteRange` of a listed file with `FS_SANDBOX_DENIED` unless the session's mode is `danger-full-access`. `stat` and `listDir` disclose only existence and metadata and are unchanged.
- **The search tools.** `grep` and `glob` start ripgrep directly, not through the fs layer. In every mode they drop a result whose file is a listed one, compared by device and inode whatever its name, so a renamed symlink or a hard link to the store is caught too; ripgrep runs outside the OS sandbox and follows a symlink it is pointed at. Neither the store's lines nor its location reach the model, and a search pointed at the file itself returns nothing.
- **bwrap.** In both confining modes `/dev/null` is bound over each listed file that exists, after every other mount.
- **Seatbelt.** In both confining modes `(deny file-read* (literal <file>))` is added for each listed file.

## Alternatives considered

- **Exclude the files from ripgrep with `--glob` patterns.** How a negated glob applies to an explicit file path and to hidden files is ripgrep behavior this package does not own, and a basename pattern would also hide every project's `.env`. Filtering the results by file identity is exact.
- **Refuse confined commands on Landlock and Windows hosts while the store exists.** The store always exists, so every confined command would be refused there. Those hosts are recorded as a Known Limitation instead.
- **Grant Landlock reads item by item, skipping the store.** Every sibling along `$DSH_HOME`'s path would have to be enumerated at confine time, and a file created afterwards in those directories would become unreadable.

## Consequences

- Under `read-only` and `workspace-write`, the model's tools and a bubblewrap- or Seatbelt-confined command cannot read the credential store; a call the user approves as `danger-full-access` can.
- Not covered: on a Landlock or Windows host a confined command can still read the store (P3-05, P3-06); a credential provider configured with a `path` outside `$DSH_HOME` is not covered; a project's own `.env` and every other file the user can read stay readable, and network egress is unchanged.
