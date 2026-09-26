# Agent Note: Plugin warnings and errors reach stderr

Status: implemented

English | [中文](2026-09-26-plugin-warnings-and-errors-reach-stderr.zh.md)

## Problem

BLOCKED-336: the shipped hosts mounted no logger exporter besides Cordis's in-memory buffer, so every `ctx.logger.warn` and `ctx.logger.error` a plugin wrote was invisible to an operator. Lane A's A-391 measured stderr, stdout and every text file under the working directory at 0 lines on the headless profile, and A-394 found the same on the ACP, SDK and Web hosts. A failure that is only logged, such as a failed capability-token issuance, left no trace.

## Decision

- **A plugin writes them to stderr.** `@deepseek-ai/dsh-logger-stderr` registers an exporter that renders `error` and `warn` messages in the vendored console exporter's layout and writes each line to stderr, prefixed `dsh: ` as the launcher's own diagnostics are. It never writes stdout, where results and protocol frames go. `dsh-base` and `dsh-sdk-minimal` mount it, so every shipped host writes the lines; this is fix (A) as the delegate ruled it on 2026-09-26.
- **Nothing logged before it mounts is lost.** It writes the in-memory buffer's messages when it mounts, and `@deepseek-ai/dsh-app-boot` mounts the tree with its loggers at `WARN`, so the buffer keeps warnings as well as errors.
- **The headless runner keeps the lines out of its reasoning sections.** While it streams reasoning it takes the lines through `routeThrough`: a line closes an open section first, and the next reasoning text starts under a new header.
- **Two vendored Cordis fixes the stderr lines would otherwise expose.** A `provide()` cleanup now leaves a store key its consumer locked non-configurable in place (modification 21); the pinned `trustKernel` otherwise logged a `TypeError` at every root teardown, which would have printed at each shutdown. An exporter's cleanup now removes its own registration rather than the most recent one (modification 22).

## Alternatives considered

- **A log file named in the startup output.** The closing condition allowed it; the delegate chose stderr, which each host's operator already watches.
- **Stop exporting once the root starts to unload, instead of fixing the teardown error.** That depends on the order of cleanup and hides a real error instead of removing it.
- **Write a line while a reasoning section is open.** The line would land inside the reasoning text.

## Consequences

- An operator of any shipped host sees plugin warnings and errors on stderr; machine-readable stdout is unchanged.
- The tree's loggers export at `WARN`, so the in-memory buffer keeps warnings too.
- A pinned service stays registered until the process ends.
- Verification: lane A's A-393 v2 on the four shipped hosts, `packages/runtime-diagnostics/logger-stderr/tests/logger-stderr.spec.ts`, the reasoning-route case in `packages/bundle/headless/tests/headless.spec.ts`, the buffer case in `packages/boot/app-boot/tests/app-boot.spec.ts`, and `packages/kernel/trust-kernel/tests/teardown.spec.ts`.
