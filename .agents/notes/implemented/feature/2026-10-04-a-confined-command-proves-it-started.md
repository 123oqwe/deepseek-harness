# Agent Note: A confined command proves it started

Status: implemented

English | [中文](2026-10-04-a-confined-command-proves-it-started.zh.md)

## Problem

Epic P3-03 must[1] requires that a program's output never decides its outcome. The sandboxed shells decided two things from output. A runner failure, the sandbox runner refusing before it started the command, was matched from stderr against per-backend fatal signatures (`bwrap: `, `sandbox-exec: `, `landlock-run: ` with exit 125, `windows-acl-run: ` with exit 127). A command that printed one of them and exited with that code was reported `SANDBOX_UNAVAILABLE`, which types as `policy_denied` and invites an escalation. The exit-code gates did not help: every runner execs the command, so after a successful launch the exit code is the command's own. A file-access denial was matched the same way and shown with the marker the filesystem fence uses for a denial the harness decides itself.

## Decision

- **A launch marker is the one out-of-band fact that the command started** (delegate rulings Q-U2a and Q-U2c). In `LaunchMarker` (`dsh-sandbox`), a host-side `/bin/sh` opens a status file under `$DSH_HOME/cache/launch` on descriptor 9 and execs the runner; a `/bin/sh` inside the sandbox writes the marker, closes descriptor 9 and execs the command. No marker: the runner failed, and the call fails closed. A marker: any failure is the command's. The command can neither write nor remove the marker: it holds no descriptor to the file, and no confined mode lets it write the harness home. A CI probe showed all four properties under bwrap; Landlock and Seatbelt are not reachable from a narrow run, and their real-runner check is pending for sign-off.
- **The consumers wrap; the provider does not.** `dsh-bash-sandbox` and `dsh-pwsh-sandbox` open a marker per run, hand the provider the command behind the in-sandbox wrapper and spawn the result behind the host-side one. `confine()` is unchanged, so a terminal session gains no extra shell and no status directory.
- **The stderr rules are removed**: `RunnerFailureRule`, `ConfinedArgv.runnerFailureRules`, the local provider's per-backend rules and its `runnerFailureSignatures` config. A `runnerCommand` runner must exec the wrapped argv.
- **Windows has no marker** (Q-U2b). The restricted-token runner offers no POSIX shell for the wrappers, so the marker is unmarked and only a spawn failure counts; the runner's exit-127 line is for the operator.
- **A denial read from output is a hint** (Q-U2d). `ShellSandboxInfo.denied` stays a stderr match against the backend's dialect, and bash and pwsh render it as `[the command's output reads like a sandbox file-access denial under <mode> mode; the sandbox did not report it]`. The filesystem fence keeps `[sandbox: file access denied under <mode> mode]` for the denials it decides. Such a run's outcome is `tool_failed` (U1).

## Alternatives considered

- **bwrap `--json-status-fd`.** It covers one backend and needs a descriptor the subprocess spawn spec cannot pass.
- **The exit-code gates.** Forgeable, because the runner execs the command.
- **The marker inside `confine()`.** Every caller of the seam, terminals included, would get the wrappers and a status directory per call.

## Consequences

- Model-visible: the bash and pwsh tool descriptions and their denial results carry the new hint; recordings that show either move with a snapshot refresh.
- A real shell denial (EROFS, EACCES or EPERM from the kernel) has no out-of-band report on any backend, so it is `tool_failed` with the hint, never `policy_denied`. Whether that narrowing of P3-03 acceptance[1] is accepted is the user's decision (Q-U2e).
- Seatbelt checks writes, and the status file lies outside the writable roots. If its profile refuses the write to descriptor 9, every run fails closed; the fix is a pipe in place of the file, before sign-off.
