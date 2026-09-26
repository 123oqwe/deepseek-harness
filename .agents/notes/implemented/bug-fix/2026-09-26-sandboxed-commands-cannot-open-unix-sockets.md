# Agent Note: Sandboxed commands cannot open Unix-domain sockets

Status: implemented

English | [中文](2026-09-26-sandboxed-commands-cannot-open-unix-sockets.zh.md)

## Problem

BLOCKED-346, a tier-1 security finding; P3-05 must[1]. The shipped local sandbox confined file effects only, so a command running under `workspace-write` could connect to the Docker daemon's socket and start a container that mounts the host's root, or reach an SSH agent and sign with the user's keys. Either reaches far beyond the workspace the mode promises. Lane A's A-476 part 2 and A-483 measured it on the shipped composition: a sandboxed command reached a Docker socket and an SSH agent started outside `/tmp`.

## Decision

- **bwrap refuses Unix-domain sockets with a seccomp filter.** On x86_64 and AArch64 hosts the bwrap argv carries `--seccomp 3`. The filter fails `socket(AF_UNIX, …)` and the three io_uring calls with `EPERM`, since `IORING_OP_SOCKET` creates a socket without the `socket` call, and kills a process that calls through another ABI (32-bit x86, x32, AArch32), whose `socketcall` arguments a filter cannot read. Pipes, `socketpair`, and TCP and UDP sockets keep working.
- **The rule set is sandbox-runtime's, assembled here.** It is the program Anthropic's sandbox-runtime (Apache-2.0) generates with libseccomp. `src/seccomp.ts` assembles the same classic BPF program itself, thirteen instructions on x86_64, instead of depending on libseccomp, which would need a native build or a per-platform binary for a small, fixed program; its unit tests run the program through a BPF interpreter.
- **The filter never touches the disk.** A short `/bin/sh` script pipes the filter's bytes into bwrap on file descriptor 3 and gives the command its standard input back, so no later command can replace the filter between writing and reading it. The functional probe runs through the same script, so a host whose bwrap cannot load it is not selected.
- **Seatbelt refuses them in its profile.** The profile denies `network-outbound` to any absolute-path Unix-domain socket, then allows the mDNSResponder and syslog sockets under `/var/run` and `/private/var/run`, so host-name resolution and logging keep working. The rule was verified on a developer Mac, where an absolute-path and a relative-path connect were both refused with `EPERM` and name resolution kept working; no macOS CI job runs it.
- **Other backends report what they cannot refuse.** Landlock, the Windows ACL runner, bwrap on another architecture and an operator-configured `runnerCommand` cannot refuse these sockets. Their wraps report `partial` enforcement and `reachableSockets`: the known daemon and agent sockets that exist on the host, found by name from the variables that point at them and from fixed locations. The provider also writes one line to stderr naming the backend and the sockets, because a headless run does not show the logger (BLOCKED-336).
- **The facts travel with the result.** `ConfinedArgv` carries `backend` and `reachableSockets`; the bash and pwsh executors copy them onto `ShellSandboxInfo`; the bash and pwsh tools keep them in the canonical result and persist them as `tool/result` `meta.sandbox` for a confined foreground run. `ToolOutputDefinition.presentationMeta` may now return `undefined`, which persists no `meta`.
- **The model learns the symptom and the way out.** The bash tool's description says the sandbox may refuse Unix-domain sockets, that opening one then fails with `Operation not permitted`, and that only `danger-full-access` lifts it; the existing per-call escalation carries that request to the user.

## Alternatives considered

- **Hide the known sockets instead of refusing all of them.** Mounting over or denying a list of paths leaves every socket the list misses reachable, and an SSH agent can listen anywhere `$SSH_AUTH_SOCK` points. The list exists only to report what a backend that cannot refuse leaves open.
- **A network namespace (`bwrap --unshare-net`).** A pathname Unix socket is reached through the filesystem, which a network namespace does not separate, and it would also cut TCP and UDP access, which the modes deliberately leave alone.
- **Depend on libseccomp.** See above: a native dependency for a fixed program of thirteen instructions.

## Consequences

- Tools that reach a local daemon or agent through a socket fail inside the sandbox: the Docker CLI, `ssh-add` and agent-based `ssh` authentication, `gpg`, D-Bus clients, a PostgreSQL client connecting through a socket, `multiprocessing` in Python 3.14 on Linux, and test servers that listen on a Unix socket. Each needs one approved `danger-full-access` call.
- Under Seatbelt a refused socket is also classified as a file denial, because Seatbelt's file-denial dialect is the same `Operation not permitted`; under bwrap the command's own error names it.
- The bash tool's description grew by one sentence, so recorded tool-schema and system-prompt fixtures changed once. The snapshot normalizer drops `meta.sandbox`, which names the backend of the recording host.
- Not covered: the filter exists for x86_64 and AArch64 only, `runnerCommand` gets none, the known-socket list is incomplete by nature and covers no Windows named pipes, and the Seatbelt rule has no CI run.
- Verification: lane A's A-476 part 2 and A-483 v2 (red first); `dsh-sandbox-local`'s unit cases (the filter run through an interpreter, the trampoline run through `sh`, socket discovery over real sockets) and its bwrap, Landlock and Seatbelt e2e cases; `dsh-bash-sandbox`'s e2e cases; and `dsh-tool-bash`'s `socket-escalation.e2e.ts`, where a refused socket connects after an approved `danger-full-access` retry.
