---
description: "Resource budget vocabulary and accounting for Epic P3-10: the eight dimensions a budget bounds per tenant, run and action, reservation against every enclosing budget, the admission decision, and the declared metering error bound."
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-budget

English | [中文](README.zh.md)

## Summary

`dsh-resource-budget` fixes what a resource budget IS in this harness: the tenant, run and action scopes a budget is held at, the eight dimensions it bounds (wall clock, CPU, memory, disk, processes, network bytes, tool calls, agents), and the ledger that reserves work against a budget and every budget enclosing it, all or none. A refusal is a four-field decision (`admitted`, `reason`, `limit`, `observed`) in the same shape as the agent loop's turn budget. Read it when bounding what a tenant, run or action may use, or when writing the provider that will enforce those bounds.

## Table of Contents

- [What a budget bounds](#what-a-budget-bounds)
- [Why splitting work cannot bypass a budget](#why-splitting-work-cannot-bypass-a-budget)
- [Held and consumed dimensions](#held-and-consumed-dimensions)
- [The metering error bound, declared first](#the-metering-error-bound-declared-first)
- [Telemetry names](#telemetry-names)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="what-a-budget-bounds"></a>
## What a budget bounds

A `BudgetSpec` is a scope and a set of `BudgetLimits`. The five world dimensions carry `dsh-execution-world`'s own field types unchanged: `cpuMillicores`, `memoryBytes` and `diskBytes` from `WorldResourcesSpec`, `maxProcesses` from `WorldProcessSpec`, and `maxWallClockMs` from `WorldLifetimeSpec`. A budget and the world that enforces it therefore describe one fact in one vocabulary. The three run-level counts, `maxNetworkBytes`, `maxToolCalls` and `maxAgents`, have no world counterpart and are declared here.

A zero or absent limit means unlimited, the same choice `LoopBudget` in `dsh-agent-loop` makes: a caller that wants no work does not start it.

<a id="why-splitting-work-cannot-bypass-a-budget"></a>
## Why splitting work cannot bypass a budget

`BudgetLedger.open` places an account under a parent at a strictly wider scope (tenant, then run, then action) and refuses a sibling in disguise: a run under a run, or a tenant under a run. `reserve` checks the account and every enclosing account and applies the reservation to all of them or to none. Subagents of one run reserve against that run's account, so fifty children each allowed a hundred tool calls still stop at the run's hundred.

<a id="held-and-consumed-dimensions"></a>
## Held and consumed dimensions

CPU, memory, disk and processes are **held**: `release` returns them, because a released reservation frees what it held. Network bytes, tool calls and agents are **consumed**: they stay spent, because a tool call released is still a tool call made. Wall clock is neither: parallel work does not add elapsed time, so each reservation is compared with the limit directly rather than with a running total.

<a id="the-metering-error-bound-declared-first"></a>
## The metering error bound, declared first

`METERING_ERROR_BOUND` states, per dimension, the largest relative error the Provider stage's metering may show: `0` for wall clock, processes, tool calls and agents, which are counted or armed against a monotonic clock, and `0.1` for CPU, memory, disk and network bytes, which are sampled. It is declared before anything is measured because a bound stated after a measurement cannot be wrong. A provider that cannot meet it reports the dimension as partially enforced rather than widening the number.

<a id="telemetry-names"></a>
## Telemetry names

`PROCESS_SEMCONV_METRICS` maps four dimensions to the OpenTelemetry `process.*` metrics they reconcile against: `process.cpu.time`, `process.memory.usage`, `process.disk.io` and `process.network.io`. The names are copied as literals. In `@opentelemetry/semantic-conventions` 1.43.0 they exist only in the `incubating` entry point, whose README asks instrumentation to copy definitions rather than import that entry at runtime. A test compares the literals with the pinned package's constants. Processes and wall clock have no `process.*` metric (`process.thread.count` counts threads and `process.uptime` is a process's age), and tool calls and agents are not process measurements, so those four stay unmapped.

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, contributes no prompt text, appends no session event, and describes no budget to the model.

#### KV Cache effect

Nothing here enters a model request. A refused reservation reaches a model only through the enforcement point that asked, which is not in this package.

## Known Limitations and Deferred Work

- **Nothing is enforced yet.** The ledger records reservations; it samples no running process and stops none. Hard enforcement of CPU, memory, disk, processes and network bytes needs a world provider that can satisfy those dimensions, and the only provider today, the local one, refuses all of them. That decision is pending, so a fork bomb, disk fill, memory balloon or network flood is not limited by this package.
- **No typed `resource_exhausted` outcome.** That outcome belongs to P3-03's outcome union, which does not exist yet. A refusal is a `BudgetDecision` until the Provider stage maps it.
- **Wall clock, tool calls and agents are not wired into a run.** The dimensions and their accounting are here, but no dispatch path reserves against a ledger yet.
- No runtime invariant companion is published: the ledger is plain in-process state owned by its one caller, so no independent observation of it can diverge.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Whether `agents` should count agents started over a run's life, as it does now, or agents alive at once, which would make it a held dimension, is undecided; the clause says only "agents". Which provider enforces the held dimensions is the pending world-provider decision, and with it whether the Provider stage's sampling can meet the `0.1` bound on every platform or reports a dimension as partially enforced.

</details>
