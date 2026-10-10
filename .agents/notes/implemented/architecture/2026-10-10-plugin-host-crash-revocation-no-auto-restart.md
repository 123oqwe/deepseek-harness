# Agent Note: A crashed plugin host revokes its registrations; restart is a capability, not automatic (P1-06 m3)

Status: implemented

## Problem

P1-06 m3 requires that the out-of-process plugin host can crash and restart, with
its registered effects auto-revoked on crash. The crash→revocation half must be
enforced; "restartable" must be real. The open design point was whether m3
requires an AUTOMATIC crash→respawn loop.

## Decision

Crash→revocation is enforced: `packages/plugin/plugin-host-process/src/host-process.ts:95`
`void handle.done.finally(disposeHost).catch(() => {})` runs the
`attachPluginRpcHost` session disposer on any child exit (orderly, crash, or
kill), which disposes every accepted `tools.register` and removes the proxy tools
from `ctx.tools` — no zombie tools survive a crash. Restart is provided as a
CAPABILITY: `spawnPluginHost` can be re-invoked to start a fresh host that
re-registers. Automatic crash→respawn is DEFERRED: auto-respawning an untrusted,
crashing plugin is a crash-loop / resource-exhaustion risk that needs a bounded
retry/backoff policy, which product-reality-first defers rather than blind-adding.

## Consequences

A plugin that crashes leaves a clean registry; recovering its tools requires a new
`spawnPluginHost` call (today, a fresh boot). The slice-4 witness observes the
revocation (boot a profile, route a third-party plugin out-of-process, SIGKILL the
child → the host's proxy tool vanishes from `ctx.tools.schemas()`); the
delete-of-`handle.done.finally(disposeHost)` mutation proves that line is
load-bearing (a crash then leaves a zombie tool, control unaffected). A bounded
auto-restart policy is future work (not scheduled in P1-06).

## Alternatives considered

- **Automatic crash→respawn loop in boot.** Rejected for this slice: respawning an
  untrusted plugin that crashes on start loops unboundedly and exhausts resources;
  a safe version needs max-retry/backoff and a restart budget — new bounded code
  and its own design pass, not justified by m3 as written (which the revocation +
  restart-capability satisfy).
