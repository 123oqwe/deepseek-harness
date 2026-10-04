# Agent Note: An out-of-memory kill is read from the manager

Status: implemented

English | [中文](2026-10-04-an-out-of-memory-kill-is-read-from-the-manager.zh.md)

## Problem

Epic P3-03 needs `resource_exhausted` typed apart from an ordinary failure. On Linux a command that hits its memory ceiling dies by the kernel's out-of-memory killer, which shows only as `SIGKILL`, so U1 recorded it as `tool_failed`. The scope that held the command knew better, but the launch passed `--collect`, and systemd unloaded the scope, with its `Result=oom-kill`, the moment it stopped.

## Decision

- **The scope keeps its result** (delegate ruling Q-U3; probe run 37213379099 on systemd 255). The launch drops `--collect`. A stopped scope then reads `failed/oom-kill` until `reset-failed`, also when only a child of the command was killed and the command itself survived.
- **The read is the manager's and the kernel's, never the process's.** After a process that did not exit cleanly, subprocess-local reads the scope once: its `Result` when it has stopped, or its cgroup's `memory.events` `oom_kill` count while it is still active. When the cgroup goes away between the two, the scope has stopped and is read again. A clean exit is not read: it records no outcome. A read that fails leaves the fact unknown; this is a type, not a security judgement.
- **The owner records, then resets.** When the owner's poll sees a failed scope it records its `Result` and runs `reset-failed`, so failed scopes do not accumulate. The out-of-memory read uses that record when it finds the unit already gone.
- **The fact travels as exit facts.** `SubprocessOutcome.resourceExhausted` and `ShellRunResult.resourceExhausted` carry `memory`; the bash and pwsh tools keep it in their value, and `shellRunOutcome` maps it to `resource_exhausted` with `limit: memory`, after an abort and the executor's deadline and before the signal it caused.

## Alternatives considered

- **Poll the scope until it leaves `active`, then read `Result`.** A command that leaves descendants running would hold its result for the whole bound; the cgroup's `memory.events` answers at once while the scope lives.
- **Read only after a `SIGKILL`.** It would miss a child killed under a command that then fails with its own exit code.

## Consequences

- One extra `systemctl show` after every Linux scoped process that does not exit cleanly.
- Terminal sessions also launch without `--collect`; their owner resets a failed scope the same way, and they do not report the fact.
- Other platforms, and the PGID fallback on Linux, report no `resourceExhausted`: their memory kill stays `tool_failed` with the signal.
