# Agent Note: A child stopped by a graceful shutdown is reported to its parent

Status: implemented

English | [中文](2026-09-26-a-child-stopped-by-a-shutdown-is-reported-to-its-parent.zh.md)

## Problem

BLOCKED-333; P5-10 must[2] and must[3]. When the host shut down gracefully while a continuable child was still cancelling, the parent was never told the child had stopped. The continuation registry's drain commits every live child's settlement to the message bus before its first `await`, and the parent's next start delivers it. On the shipped headless profile the drain began after the bus's own teardown had cleared its store handle, so the commit threw, the `catch` logged a warning, and nothing was written (lane A's trace, run 36048642994). A fiber unload starts all of its disposers at once, each after one microtask (`vendor/cordis/src/fiber.ts`, `_unload`). Declaring `messageBus` as a dependency makes the service available to the registry; it does not order the drain before the bus's teardown.

## Decision

- **Commit when the unload is announced.** The registry listens to `internal/status`. When its own fiber or an ancestor enters `UNLOADING`, it closes admission and commits every live child's settlement at once. Cordis emits that status after it schedules the fiber's disposers and before any of them runs, so the bus is still open. `AgentRegistry` closes its initiators on the same event.
- **Once per teardown.** The drain calls the same step, which does nothing the second time. A drain called directly still commits, and a commit that succeeded is not repeated against a closed bus.

## Alternatives considered

- **Deferring the bus's handle clear.** It moves the problem into the provider, which would need a rule for what a closing store may still accept.
- **Holding the store behind the service.** §12.40 refused reaching past the service.
- **Ordering the unload in Cordis.** The vendored runtime would change for every plugin's teardown.

## Consequences

- Admission closes when the unload is announced rather than when the drain starts, a few microtasks earlier.
- The fix depends on Cordis emitting `internal/status` before a fiber's disposers run. Lane A's shutdown-while-cancelling cases fail if that changes.
- Not covered: a settlement that still cannot be written is only logged through `ctx.logger`, which the shipped headless profile does not export (BLOCKED-336). Reporting it where an operator can see it waits for that entry.
- Verification: lane A's five cases on the shipped headless profile (A-389 to A-389d, picked as `e3ab7e7ed9`). Four are red on the tree before this fix; the control is green on both.
