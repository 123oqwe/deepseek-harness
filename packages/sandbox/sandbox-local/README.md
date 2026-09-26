---
description: "Local per-platform sandbox backends for users and maintainers choosing, configuring, or debugging process confinement on Linux, macOS, or Windows."
kind: "package-reference"
---

# @deepseek-ai/dsh-sandbox-local

English | [中文](README.zh.md)

## Summary

`dsh-sandbox-local` confines commands and their descendants on Linux, macOS, and Windows while sharing the host kernel and filesystem. It chooses a supported platform runner automatically and fails with `SANDBOX_UNAVAILABLE` when none is usable, so commands never silently run without confinement. Each execution reports `full` or `partial` enforcement plus denial and runner-failure signatures, allowing callers to distinguish an unavailable or broken sandbox from a policy denial. Where the backend can, both confining modes also refuse Unix-domain sockets, so a command cannot reach the Docker daemon or an SSH agent; a backend that cannot reports `partial` and names the known sockets it leaves reachable. Choose it for host-local bash or pwsh execution; use a container or remote executor when the process needs an isolated environment.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider behind `ctx.sandbox` and a confined executor, and every command the executor spawns runs confined under the policy you resolve. The shipped [base bundle](../../bundle/base/cordis.patch.yml) owns the default policy and executor wiring.

### When to choose it

Choose it when commands must run confined on the host: it is the default backend for Linux, macOS, and Windows compositions that mount `ctx.sandbox`. Choose a different mechanism when the process must run in an isolated environment — a container or remote executor replaces whole capabilities, and this provider shares the host kernel and filesystem.

### Minimal configuration

Load the sandbox service and mount the provider; the defaults below are the selection policy.

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
```

| Field | Default | Meaning |
|---|---|---|
| `runnerCommand` | `[]` | Custom runner argv; bwrap-compatible profile arguments are appended and built-in selection and probes are skipped; enforcement is reported `partial` because no Unix-socket filter is installed |
| `runnerFailureSignatures` | `[]` | Case-insensitive stderr substrings identifying the custom runner's own failure dialect; required with `runnerCommand` |
| `probeTimeoutMs` | `5,000` | Timeout for each functional probe of a competing runner candidate |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-sandbox-local) is the exhaustive source for every accepted field and its JSDoc.

### Confined execution and enforcement

With the provider mounted, a command runs under the mode you resolve per call. Enforcement is a reported fact, not a promise: `full` means the backend governs every promised file effect and refuses Unix-domain sockets, while `partial` means it governs only a subset or cannot refuse those sockets — Landlock, the Windows ACL rung (also for its Everyone and hard-link boundaries) and a `runnerCommand` runner are the current partial cases, so a consumer that requires an absolute boundary can reject or surface them. Denied file effects surface through the backend's denial dialect, and a runner that fails before executing the command reports a structured runner-failure signature.

<a id="unix-domain-sockets"></a>
### Unix-domain sockets

A daemon or agent socket lets a command act with rights the sandbox withholds: the Docker daemon starts containers that can mount any host path, and an SSH agent signs with the user's keys. Both confining modes therefore refuse Unix-domain sockets where the backend can.

| Backend | Unix-domain sockets |
|---|---|
| bwrap on x86_64 or AArch64 | Refused: a seccomp filter fails `socket(AF_UNIX, …)` and the three io_uring calls with `EPERM`, and kills a process that makes a call through another ABI (32-bit x86, x32, AArch32) |
| Seatbelt | Refused: connecting to one fails with `EPERM`, except the mDNSResponder and syslog sockets, so host-name resolution and logging keep working |
| bwrap on another architecture, Landlock, the Windows ACL rung, `runnerCommand` | Not refused: enforcement is `partial`, and `reachableSockets` lists the known sockets below that exist on the host |

A refused command sees `Operation not permitted`. Pipes, `socketpair`, and TCP and UDP sockets still work, so a command's own processes still talk to each other and network access is unchanged. Tools that reach a local daemon or agent through a socket stop working inside the sandbox: the Docker CLI, `ssh-add` and agent-based `ssh` authentication, `gpg`, D-Bus clients, a PostgreSQL client connecting through a socket, `multiprocessing` in Python 3.14 on Linux (its default `forkserver` start method uses a socket), and test servers that listen on a Unix socket. The model can retry such a call once with `sandbox_permissions: danger-full-access`, which the user approves for that call only.

When the backend cannot refuse, the provider writes one line to stderr naming the backend and the known sockets it found, and writes it again only when that backend or list changes. It goes to stderr because a headless run does not show the logger.

The known sockets are the ones the provider can find by name; each is listed because it grants rights the sandbox withholds.

| Location | Why it is listed |
|---|---|
| `$SSH_AUTH_SOCK` | The SSH agent the session names; it signs with the user's keys |
| `$DOCKER_HOST` (a `unix://` endpoint) and the Docker CLI's current context | The daemon the Docker CLI would use |
| `/var/run/docker.sock`, `/run/docker.sock`, `/run/podman/podman.sock` | The system Docker daemon and rootful Podman |
| `/var/snap/lxd/common/lxd/unix.socket`, `/var/lib/lxd/unix.socket`, `/var/lib/incus/unix.socket` | LXD and Incus, whose instances can mount host paths |
| `/var/run/libvirt/libvirt-sock`, `/run/libvirt/libvirt-sock`, `/run/libvirt/virtqemud-sock` | libvirt's read-write sockets, which can define machines with host disks |
| Under `$XDG_RUNTIME_DIR`: `docker.sock`, `podman/podman.sock`, `libvirt/libvirt-sock`, `libvirt/virtqemud-sock` | Rootless Docker, rootless Podman and session libvirt |
| Under `$XDG_RUNTIME_DIR`: `ssh-agent.socket`, `gnupg/S.gpg-agent.ssh`, `keyring/ssh` | The SSH agents of systemd, GnuPG and GNOME Keyring |
| `~/.docker/run/docker.sock`, `~/.docker/desktop/docker.sock`, `~/.colima/default/docker.sock`, `~/.orbstack/run/docker.sock`, `~/.rd/docker.sock` | Docker Desktop, Colima, OrbStack and Rancher Desktop |
| `~/.gnupg/S.gpg-agent.ssh`, `~/.1password/agent.sock`, and the macOS 1Password and Secretive agent sockets | The SSH agents of GnuPG, 1Password and Secretive |
| `ssh-*/agent.*` and `com.apple.launchd.*/Listeners` under `/tmp`, `/private/tmp` and `$TMPDIR` | OpenSSH's default agent sockets, including those of the user's other login sessions, and the SSH agent macOS starts through launchd |

Left out on purpose: containerd's socket, which only root can open; libvirt's read-only sockets (`libvirt-sock-ro`), which cannot define or start machines; the Incus user socket (`unix.socket.user`), which confines each user to a restricted project; and an agent named only by `IdentityAgent` in `~/.ssh/config`, which the provider does not parse. On a backend that refuses sockets none of this matters: every Unix-domain socket is refused, listed or not.

### Failures and recovery

An unsupported platform or an unusable runner fails closed: `confine()` throws `SANDBOX_UNAVAILABLE` and names the runner options for the platform, and the consumer surfaces that error rather than running the command unconfined. A runner that starts but refuses its profile is identified by its fatal stderr signature and exit code, so a broken sandbox is not mistaken for a denied command. The `runnerCommand` override is an operator assertion: it skips functional probes and assumes the configured runner implements the bwrap-compatible profile honestly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains runner selection, the per-platform profiles, and the failure dialects; the observable behavior is fully covered in [Use this package](#use-this-package).

### Runner selection

Selection is by platform first, probes second: each platform has a runner chain (`linux`: `bwrap` then Landlock; `darwin`: Seatbelt; `win32`: the ACL restricted-token runner). A sole candidate is selected without a probe; competing candidates are functionally probed once in chain order, and the first usable verdict is cached for the provider's lifetime. A platform with no chain, or a chain where every probe fails, is unavailable and fails closed at `confine()`.

### Platform profiles

The bwrap profile combines a read-only host root, a fresh `/dev`, and `/proc` from a private PID namespace — commands manage their descendants but cannot see host processes, so procfs magic links cannot bypass the mounts; `workspace-write` adds an ephemeral `/tmp` and a writable workspace bind. The [private-PID note](../../../.agents/notes/implemented/bug-fix/2026-08-06-bwrap-private-pid-namespace.md) records the boundary. On x86_64 and AArch64 the argv also carries `--seccomp 3`, and a short `/bin/sh` script pipes the filter's bytes into bwrap on file descriptor 3, so the filter is never written to disk; the functional probe runs through the same script. [`src/seccomp.ts`](src/seccomp.ts) assembles the filter from the rule set sandbox-runtime generates with libseccomp.

The `@deepseek-ai/node-addon-system/landlock-run` API supplies the platform launcher, functional probe, and grant vocabulary; this provider maps mode to grants only, keeping path resolution and probe parsing with the versioned binary.

The Seatbelt profile is allow-default with `(deny file-write*)` plus write allow-lists derived from the shared `writableRoots` helper, so exactly the mode's promised file effects are governed; every root is canonicalized because Seatbelt matches resolved paths (`/tmp` IS `/private/tmp`). It also denies `network-outbound` to Unix-domain sockets, then allows the mDNSResponder and syslog sockets under both `/var/run` and `/private/var/run`.

The Windows rung keeps one deterministic write SID and standing ACE per workspace, while every live session/workspace pair gets a random private temp directory with a distinct SID and revocable ACE — sessions sharing a workspace share its intended write authority without inheriting one another's temp authority. A fresh provider always chooses a new temp path and SID, so crash residue cannot block or authorize a resumed session. The rung reports `partial` enforcement because the restricted token must retain Everyone and NTFS hard links alias one file object across paths.

### Denial and runner-failure dialects

Each runner's kernel speaks its own denial dialect, carried on every wrap as `denialSignatures`, and `runnerFailureRules` give each runner's fatal signature, so consumers classify a runner refusal before checking denial signatures. The exact strings and exit codes live in [`src/index.ts`](src/index.ts).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: runner chain selection, functional probes, per-call wrap, ACL grant lifecycle |
| [`src/profiles.ts`](src/profiles.ts) | Per-platform profile builders: bwrap mounts, Landlock grants, Seatbelt SBPL |
| [`src/seccomp.ts`](src/seccomp.ts) | The bwrap seccomp filter that refuses Unix-domain sockets, and the script that feeds it on file descriptor 3 |
| [`src/sockets.ts`](src/sockets.ts) | The known host daemon and agent sockets a backend that cannot refuse them reports |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Start with the subsystem reference for the shared vocabulary, then the seam contract, the consumers, and the win32 rung.

- [Process sandbox subsystem](../../../docs/subsystems/sandbox.md) — modes, per-call policy, and classification dialects.
- [Sandbox seam package](../sandbox/README.md) — the service contract this provider implements.
- [Bash sandbox executor](../../shell/bash-sandbox/README.md) — the confined bash consumer.
- [Windows ACL restricted-token rung](../sandbox-windows-acl/README.md) — the win32 backend this provider mounts.
- [The subprocess sandbox decision](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) — capability boundary and runner selection semantics.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`dsh-tool-bash`](../../shell/tool-bash/README.md), which render this provider's enforcement and denial facts, while the [`dsh-sandbox`](../sandbox/README.md) seam owns the `SANDBOX_UNAVAILABLE` text and this provider owns runner selection, and profiles stay outside context. The bash tool's description says the sandbox may refuse Unix-domain sockets, and a refused call's `Operation not permitted` reaches the model in the command's own stderr.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a general platform comparison or a task backlog.

- **Windows ACL enforcement is partial** — the restricted token must retain Everyone for process initialization, so external objects granting Everyone write access remain writable; NTFS hard links also alias one file object across workspace and external paths. The provider reports `enforcement: 'partial'` rather than overstating that boundary as full. It does not refuse Unix-domain sockets, and the known-socket list covers no Windows named pipes.
- **Landlock is partial** — it cannot refuse Unix-domain sockets, and older supported kernel ABIs also confine only the access classes they expose; the provider reports `enforcement: 'partial'` rather than overstating either as full.
- **Socket refusal needs bwrap on x86_64 or AArch64, or Seatbelt** — the seccomp filter is built for those two architectures only. Every other backend reports `partial` with the known sockets it found, and that list is incomplete by nature: a daemon listening anywhere else stays reachable and unnamed.
- **Refusing sockets breaks socket-based local tooling** — the tools listed under [Unix-domain sockets](#unix-domain-sockets) fail inside the sandbox, and only `danger-full-access`, approved call by call, runs them.
- **The Seatbelt socket rule is verified on a developer Mac only** — no macOS CI job runs `tests/seatbelt.e2e.ts`.
- **Seatbelt depends on deprecated `sandbox-exec`** — macOS still ships it, but this provider cannot replace or probe that private policy engine if Apple removes it.
- **Runner selection is cached for the provider lifetime** — installing, removing, or repairing a runner requires reloading the plugin before selection changes.
- **`runnerCommand` is an operator assertion** — a configured custom runner skips functional probes and is assumed to implement the bwrap-compatible profile honestly; if it is itself a Bash script, its interpreter startup runs before that script applies confinement. No Unix-socket filter is installed into it, so its wraps report `partial`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: environment-coherent groups

The [sandbox decision](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) lists an environment-coherent capability group example (for example bash plus fs against one container) as a deferred phase; it is not decided.

</details>
