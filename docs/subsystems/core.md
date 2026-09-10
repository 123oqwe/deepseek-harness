# Core

English | [中文](core.zh.md)

The **core** subsystem is [`packages/core`](../../packages/core/README.md) — the packages every composition boots: the event-sourced session log, system-prompt assembly, the tool registry, the agent types, and the concrete loop that drives them. This page explains what the `agent`/`agent-loop` pair declares — how an agent is created and owned, and the `Agent` handle's delivery, cancellation, and interception contracts — plus the two type patterns every subsystem follows. The group's dedicated pages and the rest of the folder are indexed in the [subsystems README](README.md).

## The spine, package by package

Before claiming a prompt the driver asks whether a configured budget still permits a turn. `AgentOptions.budget` states hard ceilings (`maxTurns`, `maxSpendUsd`) the loop enforces for itself, so a model that never sees them is bounded identically; absent — and `0` in either field — means unbounded. The question is asked BEFORE the turn, which is what lets a refusal leave a whole number of completed turns behind for `--resume` to continue from, and the refusal is appended as `budget/exceeded` before the loop stops, so why it stopped is part of the session rather than something only the halting process knew.

A turn flows through the six packages in one loop: the driver in [`agent-loop`](../../packages/core/agent-loop) claims a queued prompt, opens a turn on the [session log](session.md) (`ctx.sessions`), assembles the request prefix through [system-prompt](system-prompt.md) (`ctx.systemPrompt`) and derives history from the log, streams the model response through the [LLM seam](llm-streaming.md), dispatches tool calls through the [tool registry](tools.md) (`ctx.tools`), and appends every model-visible fact back onto the log before the next step derives from it. The conversation vocabulary the loop moves — `Message`, `ContentBlock`, `StreamChunk`, the model request — is declared by [`packages/llm`](../../packages/llm/README.md) and documented on [llm-streaming.md](llm-streaming.md).

| Package | Owns | Page |
|---|---|---|
| `session/` | The append-only `SessionEvent` log and in-memory store — the single source of truth (`ctx.sessions`) | [session.md](session.md) |
| `system-prompt/` | Prompt-section and tool-schema assembly (`ctx.systemPrompt`) | [system-prompt.md](system-prompt.md) |
| `tools/` | The scoped tool registry and guarded execution pipeline (`ctx.tools`) | [tools.md](tools.md) |
| `agent/` | The `Agent` interface, live registry, initiator scope, and `agent/*` event vocabulary (`ctx.agents`) | this page |
| `agent-loop/` | The concrete driver implementing the public `Agent` contract (`ctx.agentLoop`) | this page |
| `scope/` | The scoped-registration primitive the registries and loop build per-agent scoping on | [scope.md](scope.md) |

`scope/` is the one non-service package: a dependency-free library (`createScope`/`scopeOf`/`scopeTarget`) that sits below `session/` and `system-prompt/` in the module graph precisely so they can consume it without a cycle. `agent-loop` is the one concrete implementation of the public `Agent` contract and lives here because it is the harness's default product loop; it runs each driver inside `ctx.agents.withInitiator()`. Extension plugins depend on `agent` — including when they need the initiating Agent — and never on `agent-loop` directly, so the loop stays swappable. [`dsh-base`](../../packages/bundle/base/README.md) is the default product composition, while [`dsh-sdk-minimal`](../../packages/bundle/sdk-minimal/README.md) declares a smaller standalone tree.

## Creation and ownership

Consumers create agents through `ctx.agents` — `create()` builds a fresh session and agent under one caller-supplied `SessionId`, `resume()` loads a persisted session first — or declaratively through the loop's config entries. Programmatic creation returns the owner's handle:

Source: [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions` carries the shared identity and everything a fresh agent needs before publication: session metadata (`meta` — validated `cwd`, fork lineage, the `isSeeded` marker, origin classification, delegation depth, and `agentPreset`), the exact fork cut in sibling field `inheritedEventCount`, an optional `seed` replay prefix, per-agent `AgentOptions`, a creation-only cancellation `signal`, and `setup`. `ResumeAgentOptions` is the persisted-identity counterpart: `resumeSessionId`, `agentOptions`, `signal`, and `setup`. The `setup` callback (`AgentSetup`) composes the agent's scoped world while both ids are still unpublished — everything registered through `agentCtx` exists before `agent/created` and the first prompt assembly — and may return a synchronous commit invoked immediately before publication; a setup rejection, commit throw, or owner disposal rolls the transaction back without publishing either id.

`AgentFactory` is the creation interface behind the registry: the loop registers its factory via `ctx.agents.setFactory()`, so consumers use `ctx.agents` without depending on the concrete loop package. The exact `create`/`resume` signatures and rollback contracts are in the [generated section](#ctxagents--agentregistry) below.

## The agent handle

`Agent` is the surface every plugin (UI, hooks, orchestrators) programs against; `ctx.agents.get(id)` returns it, and the [initiator scope](#initiating-agent) carries it. The concrete implementation is package-internal to dsh-agent-loop; nothing outside the loop depends on it. The unified `send` method exposes target and wakeup routing directly; `followup`, `steer`, and `inject` are fixed-preset aliases.

Source: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle; the runtime face augments its live capabilities. */
interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
  /**
   * Which principal is acting as this agent, and its full delegation chain
   * back to root (first100 registry P2-01 acceptance[0]). Optional: absent
   * for an agent with no identity attached. `ReactLoopAgent`
   * (`@deepseek-ai/dsh-agent-loop`) is the real producer, resolving it from
   * `AgentOptions.identity` and the session's already-recorded identity via
   * `resolveSessionIdentity` (`@deepseek-ai/dsh-agent-loop/runtime-context`).
   */
  readonly identity?: IdentityContext
  /**
   * Which Run this agent's session is doing work inside (first100 registry
   * P4-01 acceptance[2]). Optional: absent when no Run Service is mounted.
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * assigning it from its `agent/session-start` listener before any turn
   * runs. Deliberately not `readonly`: the Run Service owns the Run, not the
   * agent (P4-01 must[2]), so the association is attached by that service
   * rather than minted in the agent's own constructor the way `identity` is.
   * Readers treat an absent value as capability absence, never as a Run that
   * failed to open.
   */
  runId?: RunId
  /**
   * This agent run's position in the lifecycle, and the authority every state
   * write it makes is checked against (first100 registry P4-05 must[1], P4-07
   * must[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer.
   * It sets this beside {@link Agent.runId} when it opens the Run, having
   * taken that Run's lease from `ctx.leaseStore`, and it advances it. The
   * `epoch` here is one a lease store ISSUED, never one a caller chose — that
   * is the whole difference between this field and a number, and why
   * `advanceAgentLifecycleFenced` rather than `advanceAgentLifecycle` is the
   * entry point that may move it.
   *
   * Absent when no Run Service is mounted, or when the Run's lease was
   * refused. A reader treats absence as "this agent may not make authorized
   * state writes", never as a lifecycle at its initial state.
   */
  lifecycle?: AgentLifecycle
  /**
   * The lease this agent's Run holds, and the authority every state write it
   * makes presents (first100 registry P4-07 must[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * setting it beside {@link Agent.lifecycle} from the same acquisition.
   *
   * It lives on the Agent rather than behind the Run Service so that a
   * dispatcher can present it WITHOUT depending on that service: the agent
   * loop is where tool calls are dispatched and `@deepseek-ai/dsh-run` already
   * depends on the agent loop, so a reverse call would be a cycle. Absent
   * means this agent holds no Run and may make no authorized state write.
   */
  runLease?: RunLease
  /**
   * That a Run Service was mounted and this agent's lease was REFUSED
   * (first100 registry P4-07 must[0], acceptance[1]).
   *
   * Writer contract: `RunPlugin` (`@deepseek-ai/dsh-run`) is the sole writer,
   * setting it in the same branch that declines to open a Run.
   *
   * **It exists because absence had two meanings and they need different
   * answers.** An agent with no {@link Agent.lifecycle} is either running in a
   * composition that mounts no Run Service — capability absence, which must
   * dispatch normally — or one whose lease a live store refused, which must
   * not dispatch at all. Measured before this field existed: the two were
   * indistinguishable, so a second host that lost the race for a work item
   * kept executing tools against it, which is the two-master state P4-07
   * exists to prevent.
   *
   * Never set on a successful acquisition, and never cleared: a refusal is
   * about this agent's one attempt to open its Run, and the agent does not get
   * a second.
   */
  leaseRefused?: true
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

`running` describes the driver-wide drain interval and may span consecutive queued turns; it does not prove a turn is still open. Disposal removes the agent from the registry and emits `agent/disposed`; it is not a terminal status value. `followup()` returns no handle: its `MessageId` identifies durable inbox insertion, claim, and discard facts, not a later assistant output or turn ending. `whenIdle()` observes the whole agent, so callers may call a receipt-to-idle interval a run only when they explicitly own that interval ([decision](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)).

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
  /**
   * The principal acting as this agent and its delegation chain back to
   * root, to attach as `Agent.identity` (`./types.ts`, first100 registry
   * P2-01 acceptance[0]). `Agent.identity` is `readonly`, so a constructor
   * option is the only type-level path a caller has to supply it; still
   * type-only for now, since no `Agent` implementation reads this option and
   * attaches it yet -- that wiring is a later first100 stage's job (see
   * `@deepseek-ai/dsh-principal/types`'s module doc for why this package's
   * own runtime module is not built yet).
   */
  identity?: IdentityContext
}
```

Dispatch requires `provider` and `model` after `agent/request`. An explicit `reasoningEffort` seeds the first request on that route; exact-model resolution validates it, while omission allows the adapter default to materialize. When present, `maxTokens` must be a positive safe integer and caps every conversation-model request; omission allows the exact-model adapter default to materialize before the request header, or otherwise leaves provider behavior unchanged. An agent-scoped `deployment:persona` prompt section may shadow the global default persona.

The inbox is the delivery vocabulary — two ordered pending-message lists the agent owns as a durable projection:

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

Every pending occurrence is its `UserMessage`; `MessageId` is the sole identity. `Inbox.append`, `prepend`, `replace`, `remove`, `clear`, `splice`, and `claim` record normalized durable `agent/inbox/spliced` mutations and reject duplicate pending ids. `replace(messageId, newMessage)` and `remove(messageId)` locate the pending message across both lists; replacement may change identity and emits the old message as discarded followed by the new message as inserted. Ordinary removals and `clear()` are cancellations. `claim(target)` removes the proposed step batch — all `next-step` input plus, at a turn boundary, one `next-turn` message — through pure deletion splices without emitting discarded notifications, and the loop separately emits per-message claimed notifications. Whole-queue consumers such as UI projections reconstruct `nextTurn` and `nextStep` from the durable splices, while consumers following one message use the exact `agent/inbox/inserted`, `claimed`, and `discarded` notifications.

Cancellation:

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

The cause is a TypeScript-enforced same-process input. An active cancellation holder copies it into the runtime-only `AbortSignal.reason`; a signal grants cooperating listeners no classification authority. Durable `turn/end` records the outcome as `{ kind: 'aborted', reason: TurnEndCancelCause }`, so the cancel cause lands in the terminal result.

The [event taxonomy](../architecture.md#events) owns the `agent/*` lifecycle, checkpoint, and waterfall contracts. Turn and step boundaries are durable session events rather than agent emits.

## Initiating Agent

The process-local initiator carried by `ctx.agents` is the exact `Agent` above, not a separate frame or copied identity. Ambient presence is neither liveness proof nor authorization; the [initiator-scope decision](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md) defines its lifetime and scope rules.

## Interception decisions

Pre-step decisions use the same identified `UserMessage` type as durable user-role input. The entered batch is authoritative and preserves every message's `id` and `source`. Hook bridges map their native decision fields onto this typed result.

Source: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step` receives one payload carrying the exclusive claimed batch (`messages`), the proposed step's coordinates (`turn`, `step`), and the current turn's cancellation `signal`. The initial proposal runs inside an open turn before any step; a tool continuation may submit an empty claimed batch between steps:

It returns a `PreStepDecision`. Reject opens no step. Enter supplies the complete message batch appended after `step/start`; claimed messages omitted by the final decision remain removed, while input inserted after the claim stays pending:

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | {
    kind: 'enter'
    messages: UserMessage[]
    /** Start a distinct model-message series before this step's admitted messages. */
    startsRequestSeries?: true
  }
```

`agent/request-error` runs after a failed model step closes and before its turn closes. Listeners can repair durable state or await policy work while the failed turn's signal is still live. A handling listener returns `{ kind: 'retry' }` without calling `next()`; the default `undefined` leaves the failure terminal.

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step` is the only waterfall listener chain before request derivation. `agent/turn-stopping` runs when a turn has no tool or steering continuation, before one final steering drain.

`agent/session-start` carries a `SessionStartSource` (why the session lifecycle began; a bridge keys its SessionStart matcher on it):

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## Sessions

A `Session` is an **append-only log** of typed `SessionEvent`s — the single source of truth. The LLM message history is *derived* from the log (`deriveMessages()`), not stored separately. Every entry carries a monotonic `seq`, a `time`, and a `type`-discriminated `data` payload; surface variants may also list cited earlier events in `sourceEventSeqs` and carry a `surfaceOp`.

The `SessionEvent` envelope's exact conditional fields, the twelve core event variants (`turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, `request/header`, `request/context`, `session/end-seed`), the `deriveMessages()` projection rules, the `TurnEndReason` reasons, and the execution-enclosure and standalone-event rules are on **[session.md](session.md)**. How the log is made durable — the `SessionPersistence` interface, JSONL provider, `session/flush` checkpoint, crash recovery, and `SessionHeader` — is on **[persistence.md](persistence.md)**.

## `ToolDefinition`

The one pipeline-authoring type that is core: what every registered tool *is* — a model-facing `ToolSchema` plus an `execute` function and optional final-content and UI callbacks. A tool author rarely constructs it by hand (the `defineTool` DSL builds it with typed arguments), but it is the contract the registry holds and the loop dispatches through.

Its full fields, the `defineTool`/`ValueSchemaSpec`/`ParameterSchemaSpec` typed schema DSL, the `ToolExecution`/`ToolExecutionResult` waterfall types, and the tool-presentation UI types are on **[tools.md](tools.md)**.

## Repo-wide type patterns

Two patterns recur across every subsystem and are documented once, here.

<a id="the-map--derived-union-pattern"></a>

### The `…Map → derived-union` pattern

Almost every extensible sum type in the harness follows one pattern: an interface keyed by a discriminant tag (the `…Map`), from which the union is derived with `keyof`. Plugins add variants by **declaration merging** — no edit to the owning package.

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

Five canonical maps use this pattern; a plugin author extends these:

| Map | Package | Derives | Catalog |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.md#the-model-request-and-result) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.md) |

Two large discriminated unions are the ones consumers `switch` over most: **`StreamChunk`** (the streaming protocol) and **`SessionEvent`** (the log entry). Per the repo convention, `switch` on the tag — don't chain `if`s — so each arm narrows and a typo'd tag fails to compile.

### Branded IDs

IDs passed between packages are **branded** — structurally strings, but non-interchangeable at the type level (a `SessionId` cannot be passed where a `ToolCallId` is expected). Construction uses the shared `brandString<T>()` helper or an owner-defined validating factory; comparison, logging, and JSON behave as ordinary strings.

The `Branded<B>` primitive and stateless constructor live in [dsh-brand](../../packages/util/brand), which has no harness capability dependency. `brandString<T>()` applies a compile-time-only string brand.

Source: [`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

The two core IDs are `ToolCallId` (correlates a tool call with its result; dsh-llm) and `SessionId` (the shared live agent and durable session identity; dsh-session). Capability packages brand their own ids too, such as `JobId` in [jobs.md](jobs.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxactionledger--actionledgerplugin"></a>

### `ctx.actionLedger` — `ActionLedgerPlugin`

The mounted ledger, published as `ctx.actionLedger`.

Forwards LedgerStore rather than exposing the opened store, so a consumer reaches only the operations the contract names and cannot reach past them into this provider's own surface.

```ts cordis-catalog
/**
 * Take responsibility for one external effect before it is sent.
 * @param request - the scope, key, arguments hash and epoch to reserve under.
 * @returns whether the caller may send, or why not.
 */
reserve(request: ReserveRequest): ReserveDecision

/**
 * Record that the request left the harness.
 * @param scope - the reservation's owning principal.
 * @param key - the idempotency key.
 * @param epoch - the generation that holds the reservation.
 */
markSent(scope: LedgerScope, key: string, epoch: LedgerEpoch): void

/**
 * Record the provider's receipt, the evidence the effect committed.
 * @param scope - the reservation's owning principal.
 * @param key - the idempotency key.
 * @param epoch - the generation that holds the reservation.
 * @param receiptDigest - the digest of what the provider returned.
 */
confirm(scope: LedgerScope, key: string, epoch: LedgerEpoch, receiptDigest: ReceiptDigest): void

/**
 * Record that retrying cannot determine the outcome.
 * @param scope - the reservation's owning principal.
 * @param key - the idempotency key.
 * @param epoch - the generation that holds the reservation.
 */
markAmbiguous(scope: LedgerScope, key: string, epoch: LedgerEpoch): void

/**
 * The entry for one scoped key.
 * @param scope - the reservation's owning principal.
 * @param key - the idempotency key.
 * @returns the entry, or `undefined` when it was never reserved.
 */
entry(scope: LedgerScope, key: string): LedgerEntry | undefined
```

Source: [`packages/action/action-ledger/src/plugin.ts`](../../packages/action/action-ledger/src/plugin.ts)

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Owns the default model selection independently of any Host or transport. The composition entry remains usable without a settings provider; when one is mounted, its user layer is read live.

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a settings
 * provider keeps its composition entry.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional settings write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

Source: [`packages/core/agent-default-model/src/index.ts`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

Concrete agent factory and driver service.

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

Types: [SessionHeader](persistence.md)

Source: [`packages/core/agent-loop/src/index.ts`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresets"></a>

### `ctx.agentPresets` — `AgentPresets`

Registry over the deployment's agent presets.

Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every call so a preset authored while the process runs is visible immediately, and a preset deleted underneath a picker disappears from the next read.

```ts cordis-catalog
/**
 * Every preset the configured roots currently supply.
 * @returns the presets, first-root-wins per id.
 */
async list(): Promise<AgentPreset[]>

/**
 * The roster off the Host: {@link list} projected to path-free rows, with
 * the default marked and this deployment's authoring capability beside it.
 *
 * Whether a client can open a preset's directory is the Host's own opener
 * capability, not a roster property — a caller needing both joins them.
 * @returns the rows and the authoring capability.
 */
@Remote('list') async remoteExportList(): Promise<AgentPresetRoster>

/**
 * Every preset's composition as flattened plugin rows, for plugin-listing
 * surfaces beside the roster's own picker.
 *
 * A preset with a live standing mount answers from its newest generation's
 * Loader entries — the composition new sessions join — even when the file
 * behind it has since been edited into an unreadable state: the mount is
 * what sessions actually run, so the broken verdict only applies to a
 * preset nothing composed. One never composed since boot answers from its
 * file, with `!!js` disabled gates evaluated against the Loader context so
 * both answers reflect the same host. Reading never mounts: an unmounted
 * preset is parsed, not composed, so listing a preset's plugins cannot
 * activate them early. A composition that stopped reading between
 * discovery's health verdict and this read is reported broken with the
 * raced reason rather than dropped.
 * @returns one composition per roster preset, in roster order.
 */
async compositionInventory(): Promise<AgentPresetComposition[]>

/**
 * Resolve one preset by id.
 *
 * A broken preset resolves — deleting one, reading one, and reporting one
 * all need the row — and the mounting paths refuse it AFTER resolution
 * through {@link resolveMountable}.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the resolved preset.
 * @throws when no configured root supplies that id.
 */
async resolve(id?: string): Promise<AgentPreset>

/**
 * Compose one agent from a preset: ensure the preset's standing mount, then
 * parent the agent's scope key to it so the mount's registrations and
 * listeners cover this agent.
 *
 * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
 * the agent creation back, so a broken preset never yields a half-composed
 * session.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the preset that was composed, for the caller to record.
 * @throws when the preset is unknown or its composition is unusable.
 */
async mount(agentCtx: Context, id?: string): Promise<AgentPreset>

/**
 * Join one agent to the SAME standing composition another already runs on.
 *
 * This is how a child agent inherits its parent's capabilities. It is a bind,
 * not a mount: the parent's generation is already composed, so the child gets
 * that exact instance — the same plugin objects, the same tool registrations,
 * the same prompt sections. Re-resolving the parent's preset by id instead
 * would re-read the roster, and a composition file edited since the parent
 * started would hand the child a DIFFERENT generation than the one its
 * parent's history was produced under (and a preset deleted since would fail
 * the child outright while its parent keeps running).
 *
 * Synchronous, and with no composition failure mode of its own — it reads no
 * roster, mounts nothing, and touches no file — which is what lets a child
 * creation window use it: the two in-process subagent drivers compose their
 * children inside a synchronous `setup`. It still rejects a caller error, as
 * the `@throws` below record.
 *
 * A parent that joined no preset — a rosterless deployment — yields no join
 * and no error: there, the model-facing rows sit in the host composition and
 * the child already sees them through the global layer.
 * @param agentCtx - the joining agent's scope context.
 * @param parentCtx - the scope context of the agent whose composition to join.
 * @returns the preset id joined, or undefined when the parent joined none.
 * @throws when `agentCtx` carries no scope, or has already joined a preset.
 */
composeFrom(agentCtx: Context, parentCtx: Context): string | undefined

/**
 * The preset one live agent runs on.
 *
 * Read from the live scope chain rather than from the session, so it answers
 * for an agent whose session has not recorded a preset yet — a child agent
 * whose durable header is being built from its parent's composition.
 * @param agentCtx - the agent's scope context.
 * @returns the preset id, or undefined when the agent joined none.
 */
composedPreset(agentCtx: Context): string | undefined

/**
 * Read one preset's composition text.
 * @param id - the preset id.
 * @returns the composition exactly as stored.
 * @throws when no configured root supplies that id.
 */
async read(id: string): Promise<string>

/**
 * One preset's composition text with the roster row it belongs to.
 * @param agentPreset - the preset id.
 * @returns the composition beside its trust and published metadata.
 * @throws {RemoteError} `gateway/bad-request` for an empty id, or
 * `agent-preset/not-found` when no configured root supplies it.
 */
@Remote('read') async readDocument(agentPreset: string): Promise<AgentPresetDocument>

/**
 * Create a locally authored preset by copying an existing one whole.
 *
 * Copy is the only authoring write. Composition text never crosses this
 * seam: the source is named by id and its directory is copied as it stands,
 * so the copy is exactly as loadable as its source and authoring grants no
 * capability the roster did not already carry. The copy is NOT mounted to
 * validate — a source that mounts today yields a copy that mounts today.
 * @param from - the preset the copy starts from; shipped presets are the
 * primary source, so any trust is accepted.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; absent falls back to the id.
 * @throws when the source is unknown, the id is unusable or already taken,
 * or the deployment configures no writable root.
 */
async copy(from: string, id: string, name?: string): Promise<void>

/**
 * Copy one preset through the Remote API.
 * @param from - the source preset id.
 * @param id - the new preset id.
 * @param name - the copy's optional display name.
 * @returns once the copy is stored.
 * @throws {RemoteError} with the corresponding stable preset code and
 * details when the copy is refused.
 */
@Remote('copy') async remoteExportCopy(from: string, id: string, name?: string): Promise<void>

/**
 * Delete a locally authored preset.
 *
 * @param id - the preset id.
 * @throws when the preset is unknown or ships with the deployment.
 */
async remove(id: string): Promise<void>

/**
 * Delete one preset through the Remote API.
 * @param id - the preset id.
 * @returns once the preset is deleted.
 * @throws {RemoteError} with the corresponding stable preset code and
 * details when deletion is refused.
 */
@Remote('deletePreset') async remoteExportDelete(id: string): Promise<void>

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes services behind `isolate` realms, which are invisible
 * outside the group that declares them — including to the host. This is how a
 * caller holding the agent reads one anyway: a request that is ABOUT a
 * session but arrives from outside it, which is every browser RPC.
 *
 * Read addressing only. A host row that `inject`s a service cannot use this,
 * because injection resolves before any session exists and has no agent to
 * key by; such a service belongs on the host plane instead.
 * @param agent - the agent whose composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/**
 * Re-link one agent to a different preset's standing composition.
 *
 * Only valid while the agent has produced nothing: swapping tools mid
 * conversation would leave logged tool calls the new composition cannot
 * make. The CALLER owns that check — this method does not read session
 * history.
 *
 * The swap is a parent re-link, not an unmount: standing mounts are shared
 * and permanent, so the old composition stays for its other agents and the
 * new one is ensured BEFORE the link moves. An unknown or unusable preset
 * therefore throws with the agent exactly as it was — there is no torn-down
 * state to restore. The re-link runs through the binding this roster kept
 * from the agent's mount — dsh-scope's only re-link authority. An agent
 * that never composed one has nothing to re-link: the switch is then the
 * agent's first bind, exactly a mount. A committed re-link emits
 * `tools/change` because changing the parent scope changes the Agent's
 * resolved tool set without adding or removing registry entries.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset to compose the agent from instead.
 * @returns the preset now installed.
 * @throws when the preset is unknown or its composition is unusable.
 */
async recompose(agentCtx: Context, id: string): Promise<AgentPreset>

/**
 * Compose a blank session's agent from a different preset and record it.
 * @param agent - the session's live agent, resolved from the wire identity.
 * @param agentPreset - the preset to compose the agent from instead.
 * @returns the preset id that was recorded.
 * @throws {RemoteError} with `gateway/bad-request`, `agent-preset/locked`,
 * `agent-preset/not-found`, or `agent-preset/invalid` when refused.
 */
@Remote('select') async select(agent: Agent, agentPreset: string): Promise<string>

/**
 * The standing scope key of one preset, for a host reader with no agent.
 *
 * A cold transcript read resolves tool presenters against the composition
 * the session recorded, and the standing mount makes that possible without
 * resuming anything: ensuring the mount composes plugins but starts no
 * agent, no session, and no turn.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the standing scope key readers pass as a registry view scope.
 * @throws when the preset is unknown or its composition is unusable.
 */
async standingKeyFor(id?: string): Promise<ScopeKey>
```

Types: [ScopeKey](scope.md)

Source: [`packages/preset/agent-presets/src/index.ts`](../../packages/preset/agent-presets/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory.

Initiator methods provide same-process causal attribution only. Ambient presence is neither liveness proof nor authorization; subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries. Returned Promise boundaries drain during teardown, except a nested lineage that starts an owning-fiber unload is excluded from its own drain.

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while `agentCtx.agent` identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, configuration, and optional setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent. Throws if an agent with the same id is already
 * registered. Emits `agent/created` on registration and `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). Returns the disposer.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): () => void

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - live agent whose scoped context created this agent, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   synchronous `agent/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
announce(agent: Agent): void

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

Source: [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

<a id="ctxcapabilitytokens--capabilitytokenprovidercontract"></a>

### `ctx.capabilityTokens` — `CapabilityTokenProviderContract`

The mounted Capability Token provider, published by whichever provider a profile mounts (`@deepseek-ai/dsh-capability-token-file` is the first).

Declared in the DEFINITION package rather than in a provider so the name means the contract and not one implementation: a consumer reading `ctx.get('capabilityTokens')` gets this type without importing a provider — which the layer rules forbid it from doing anyway. Declaring it provider-side left every consumer's read typed `any`, and `any` is what the tool-dispatch lint rules reject; two providers could also have disagreed about what the service is.

```ts cordis-catalog
/**
 * The session's root token, waiting for an in-flight issuance and minting one
 * on first demand. This is what a consumer presenting a token calls.
 * @param session - the session whose root token is wanted.
 * @returns the token, or `undefined` when none could be issued.
 */
whenSessionToken(session: SessionIdLike): Promise<SignedCapabilityToken | undefined>

/**
 * The session's root token if issuance already settled, without waiting.
 * @param session - the session whose root token is wanted.
 * @returns the token, or `undefined` before issuance settled.
 */
sessionToken(session: SessionIdLike): SignedCapabilityToken | undefined

/**
 * Why this session holds no token, when issuance ran and failed — so a
 * refusal can say that instead of reading as "nobody attached one".
 * @param session - the session whose issuance failure is wanted.
 * @returns the failure message, or `undefined` when issuance did not fail.
 */
issuanceError(session: SessionIdLike): string | undefined

/**
 * Whether this token, or any ancestor it was delegated from, has been
 * revoked (P2-02 acceptance[1]).
 *
 * The question a tool dispatch asks before honouring a presented token.
 * Without it, revocation is a record rather than a withdrawal: a revoked
 * token keeps authorizing every call until it expires, and acceptance[1]'s
 * "revoking a parent invalidates every descendant" is true of the ledger and
 * false of the running system.
 *
 * Answered from the loaded revocation set, never by reading the store, so
 * the dispatch stays free of I/O.
 * @param token - the token presented to the dispatch.
 * @returns `true` when the token or an ancestor is revoked.
 */
isRevoked(token: SignedCapabilityToken): boolean

/**
 * Withdraw a session's authority: every root issued for it, and so every
 * token delegated from any of them.
 *
 * Answered from durable records, so a session that has already ended is
 * still revocable — the case a detached run makes ordinary, since it outlives
 * the session that launched it.
 * @param session - the session whose authority is withdrawn.
 * @returns `'revoked'` when at least one root was withdrawn, `'nothing-to-revoke'`
 *   when the durable record holds none for this session. The two are distinct
 *   answers on purpose: reporting plain success for a session nothing was
 *   recorded against tells an operator their revocation took effect when it
 *   had nothing to act on.
 */
revokeSession(session: SessionIdLike): Promise<'revoked' | 'nothing-to-revoke'>

/**
 * Derive a child session's token from its parent's, under the parent's own
 * delegation filter (P2-02 acceptance[0]: never wider than its parent).
 *
 * Called from the child-composition path, which is the only place that KNOWS
 * the filter — it is the delegating call's `toolFilter`, not anything the
 * provider can observe. Starts the derivation and returns; the token settles
 * before the child's first tool call because that call awaits
 * {@link whenSessionToken}. A child with a derived token is never granted a
 * root of its own.
 * @param parentSession - the delegating parent's session.
 * @param childSession - the child session receiving the derived token.
 * @param filter - the parent's declared restriction on the child, or `undefined` for none.
 */
deriveChild(parentSession: SessionIdLike, childSession: SessionIdLike, filter?: ChildResourceFilter): void
```

Source: [`packages/policy/capability-token/src/types.ts`](../../packages/policy/capability-token/src/types.ts)

<a id="ctxcircuitbreaker--circuitbreakercontract"></a>

### `ctx.circuitBreaker` — `CircuitBreakerContract`

The mounted circuit breaker, published by whichever provider a profile mounts.

One operation, not a consult-then-record pair: a contract that reported state separately would leave the consultation to every caller, and a caller that forgot would still compile and still pass its own tests.

```ts cordis-catalog
/**
 * Run `operation` unless its destination's breaker is open, counting the
 * outcome toward that destination's health.
 *
 * `classify` is required rather than inferred because what counts as
 * endpoint ill-health is {@link classifyFailure}'s decision applied to facts
 * only the caller can read: a policy denial is permanent but says nothing
 * about the endpoint, and counting it would open a breaker on a working
 * destination. The breaker never inspects a raw error itself.
 * @param destination - the endpoint the operation addresses.
 * @param operation - the work to attempt.
 * @param classify - reads the thrown value into facts this package decides on.
 * @returns the operation's own result.
 * @throws {BreakerOpenError} when the destination is open, WITHOUT running
 *   `operation`.
 */
execute<T>( destination: BreakerDestination, operation: () => Promise<T>, classify: (error: unknown) => FailureFacts, ): Promise<T>
```

Source: [`packages/reliability/retry/src/provider.ts`](../../packages/reliability/retry/src/provider.ts)

<a id="ctxleasestore--leasestorecontract"></a>

### `ctx.leaseStore` — `LeaseStoreContract`

What a lease store must do, independent of where it keeps the leases.

Declared here, away from every implementation, so a consumer depends on the RULE rather than on whichever store happens to be nearest. A consumer that `new`s a concrete store instead of taking one is choosing the storage for its callers, which is how a workflow engine came to hold every lease in a `Map` nobody could share.

```ts cordis-catalog
/**
 * Mark the store reachable or not; an unreachable store refuses all work.
 * @param available - whether the store can be reached.
 */
setAvailable(available: boolean): void

/**
 * The item's current lease.
 * @param workItem - the item to look up.
 * @returns the lease, or `undefined` when none is held.
 */
get(workItem: WorkItemId): Lease | undefined

/**
 * Take an item, issuing a strictly greater epoch, or say why not.
 *
 * An expired lease is taken over rather than refused: expiry is precisely
 * the condition under which the scheduler may reclaim (must[2]). The
 * previous holder is not consulted and is not notified — it discovers it was
 * fenced when its next write is refused, the one notification that cannot be
 * lost. While the store is unavailable this refuses rather than reporting
 * the item free, because "nobody holds this" and "I cannot tell you who
 * holds this" must not look alike to a scheduler (acceptance[2]).
 * @param workItem - the item to acquire.
 * @param worker - the acquiring worker.
 * @param nowMs - the instant to judge the incumbent's expiry against.
 * @param leaseMs - how long the new lease should run from `nowMs`.
 * @returns the new lease and its token, or the reason for refusal.
 */
acquire(workItem: WorkItemId, worker: WorkerId, nowMs: number, leaseMs: number): AcquireResult

/**
 * Extend the lease a token authorizes (must[2]).
 *
 * Refuses an already-expired lease even when the token is otherwise current:
 * a holder whose lease lapsed has become reclaimable, and reviving it would
 * resurrect an authority the scheduler may already have handed elsewhere.
 * Renewal issues no new epoch — only the deadline moves.
 * @param token - the holder's current authority.
 * @param nowMs - the instant to judge expiry against.
 * @param leaseMs - how long the renewed lease should run from `nowMs`.
 * @returns the extended lease, or the reason for refusal.
 */
renew(token: FencingToken, nowMs: number, leaseMs: number): RenewResult

/**
 * Give up the lease a token authorizes, so the item is free immediately.
 *
 * A run that FINISHED is not the same as one whose lease lapsed. Without
 * this, every completed run leaves its item owned until the deadline it
 * never needed, and a scheduler with a thousand short runs spends its
 * capacity waiting for leases nobody holds. Releasing is not reclaiming: it
 * issues no epoch and hands the item to nobody, it only stops this holder
 * from owning it.
 *
 * Idempotent, and silent when the token is not current — a holder that was
 * already fenced out has nothing to give up, and reporting that as an error
 * would make ordinary teardown noisy.
 * @param token - the holder's authority over the item it is giving up.
 */
release(token: FencingToken): void

/**
 * Every item whose lease has expired at `nowMs` and may be reclaimed.
 *
 * Empty while the store is unavailable rather than throwing: a scheduler
 * asking what it may pick up during an outage should find nothing, and
 * `acquire` refuses anyway, so this is stop-work in both directions.
 * @param nowMs - the instant to judge expiry against.
 * @returns the reclaimable work items.
 */
reclaimable(nowMs: number): readonly WorkItemId[]
```

Source: [`packages/collaboration/lease-contract/src/types.ts`](../../packages/collaboration/lease-contract/src/types.ts)

<a id="ctxmessagebus--messagebusplugin"></a>

### `ctx.messageBus` — `MessageBusPlugin`

The mounted durable bus, published as `ctx.messageBus`.

Implements the store contract itself and forwards, so a consumer injecting the service holds exactly what the contract describes and never learns that SQLite is behind it. The two module-level operations that take a store — committing an intake and sweeping stale claims — are methods here for the same reason: a consumer that had to import them alongside the service would be holding the storage choice again.

```ts cordis-catalog
/**
 * Take responsibility for a message on behalf of one turn.
 * @param message - the arriving message.
 * @param turn - the turn claiming it.
 */
claim(message: BusMessage, turn: number): void

/**
 * The inbox row for one `(source, id, epoch)`.
 * @param source - the emitter the id is scoped to.
 * @param messageId - the message id.
 * @param epoch - the sender generation.
 * @returns the row, or `undefined` when this bus holds none.
 */
inboxRow(source: string, messageId: string, epoch: number): InboxRow | undefined

/**
 * Every committed domain event, in commit order.
 * @returns the events.
 */
domainEvents(): readonly BusMessage[]

/**
 * Every stored outbox row, in commit order.
 * @returns the rows, each carrying its delivery record.
 */
outboxRows(): readonly StoredOutboxRow[]

/**
 * Persist one record's advanced state after a dispatch pass.
 * @param record - the record as the dispatch decision left it.
 */
persistOutbox(record: OutboxRecord): void

/**
 * The dedup keys of consumed messages, which is the durable seen-set.
 * @returns the keys.
 */
consumedKeys(): ReadonlySet<string>

/**
 * Commit a domain event, its outbox rows and the inbox transition, in one
 * transaction (must[0]).
 * @param commit - the message, the claiming turn, and the rows it owes.
 */
commitIntake(commit: IntakeCommit): void

/**
 * Sweep claims older than the window, so a turn that never ran does not hold
 * a message forever (must[2]).
 * @param window - the expiry boundary.
 * @returns how many rows were released.
 */
recoverStaleClaims(window: RecoveryWindow): number
```

Source: [`packages/run/message-bus/src/plugin.ts`](../../packages/run/message-bus/src/plugin.ts)

<a id="ctxruns--runplugin"></a>

### `ctx.runs` — `RunPlugin`

Epic P4-01's Run Service as a mounted Cordis plugin: the one place a real harness run becomes a Run.

On mount it restores the durable registry from Config.storePath (acceptance[0]'s restart path, executed on every boot including the first), then subscribes to the agent registry's own extension points. Every agent session the harness starts opens a Run owned by `RUN_SERVICE_OWNER_ID` (must[2]) whose `sessionIds` begins with that session (acceptance[2]), and every workflow execution that session runs is referenced in that Run's append-only log (must[1]).

`inject` names the agent registry, so the plugin activates only where the events it subscribes to are actually emitted rather than sitting inert.

```ts cordis-catalog
/**
 * The Run the harness opened for `agent`'s session.
 * @param agent - a live agent handle from the agent registry.
 * @returns the {@link Run} that agent's session is doing work inside, or
 * `undefined` when no Run was opened for it — a subagent session started
 * outside the agent registry this plugin observes, for instance.
 */
runFor(agent: Agent): Run | undefined

/**
 * Reclaim a run whose lease lapsed, recording it as `orphaned` (Epic P4-05
 * acceptance[2], §12.60).
 *
 * **The reclaimer writes this, never the orphaned host.** A host that lost
 * its lease must not write at all — from its own side a reclaim and a pause
 * are indistinguishable, so it cannot establish its own orphaning, and
 * `advanceLeasedAgent` refuses it as `fenced`. The party that OBSERVED the
 * loss is the one that acquired the item, and it records the state under the
 * epoch the store just issued it. No fencing bypass exists or is needed.
 *
 * `orphaned` leads to `starting` or `failed`, so a caller resumes the work
 * under its new epoch or fails it safely — acceptance[2]'s two arms.
 * @param agent - the agent whose work item is being reclaimed.
 * @param nowMs - the caller's clock reading, against which the lapse is judged.
 * @returns `'reclaimed'` when this host took the item and recorded the state,
 * `'held'` when the item is still validly owned, `'no-run'` when the agent
 * has no lifecycle to record against.
 */
reclaim(agent: Agent, nowMs: number = Date.now()): 'reclaimed' | 'held' | 'no-run'

/**
 * Advance one agent's lifecycle under the Run's lease (P4-05 must[1], P4-07
 * must[1]).
 *
 * The production caller `advanceAgentLifecycleFenced` did not have. The
 * token and the current lease both come from the lease this plugin took, so
 * a caller cannot present authority it was not granted, and an agent whose
 * Run was reclaimed by another host is refused here rather than allowed to
 * write on a stale epoch.
 * @param agent - the agent whose lifecycle is proposed to move.
 * @param to - the state proposed.
 * @param reason - why, recorded on the transition (must[1] requires it non-empty).
 * @returns the refusal, or `undefined` when the agent advanced. `lease-refused`
 *   names an agent this plugin declined to open a Run for, which is a
 *   different fact from `no-run`: a live store said no, rather than nothing
 *   tracking ownership at all.
 */
advance( agent: Agent, to: AgentLifecycleState, reason: string, ): TransitionDenialReason | 'fenced' | 'lease-refused' | 'no-run' | undefined
```

Source: [`packages/run/run/src/index.ts`](../../packages/run/run/src/index.ts)

<a id="ctxtaskstore--taskstorecontract"></a>

### `ctx.taskStore` — `TaskStoreContract`

What a taskboard must do, independent of where it keeps the tasks.

Declared away from the in-memory class so a consumer depends on the RULE rather than on the storage. acceptance[0] is about MULTI-PROCESS contention, and a `Map` cannot hold that property at all: two processes each hold their own and both claim the same task. `@deepseek-ai/dsh-taskboard-sqlite` is the provider that can.

```ts cordis-catalog
/**
 * Submit a task graph, refusing cycles before anything is stored.
 *
 * The whole submission is validated against the tasks already held, not
 * against the batch alone: a cycle can close across two separately-valid
 * submissions, and an implementation that serializes writers must do this
 * check under the same lock as the write.
 * @param tasks - the tasks to add; ids must not already be held.
 * @returns whether the submission was accepted, and why it was not.
 */
submit(tasks: readonly Task[]): SubmitOutcome

/**
 * The task with this id.
 * @param id - the task to look up.
 * @returns the task, or `undefined` when this store holds none with that id.
 */
get(id: TaskId): Task | undefined

/**
 * Claim a task for one worker, atomically against every other claimer of
 * this store.
 *
 * The read, the decision and the write admit no interleaving: two callers
 * reaching this together must not both be told they hold the task. On
 * success the store already holds the claimed task, so a caller never writes
 * the decision back.
 * @param id - the task to claim.
 * @param worker - the claiming worker.
 * @param nowMs - the instant to judge the incumbent claim's expiry against.
 * @param leaseMs - how long the new claim should hold from `nowMs`.
 * @returns the claimed task, or why the claim was refused.
 */
claim(id: TaskId, worker: WorkerId, nowMs: number, leaseMs: number): ClaimDecision

/**
 * Give a claim back before it lapses, so the same worker can claim the task
 * again without waiting out its own dead claim.
 *
 * Fenced by the attempt, exactly as a receipt is: a holder whose claim was
 * reclaimed by someone else must not be able to strip the new holder's claim
 * by releasing the one it lost.
 * @param id - the task to release.
 * @param worker - the worker giving the claim back.
 * @param attempt - the attempt number that worker holds.
 * @returns the released task, or why the release was refused.
 */
release(id: TaskId, worker: WorkerId, attempt: number): ReleaseDecision

/**
 * Advance a task from a receipt, without the model touching it.
 *
 * The receipt must come from the task's current owner at its current
 * attempt, and must name a legal transition; a lapsed holder that finished
 * its work and reported is refused rather than allowed to overwrite the new
 * holder's task.
 * @param receipt - the evidence being applied.
 * @returns the advanced task, or why the receipt was refused.
 */
applyReceipt(receipt: TaskReceipt): ReceiptOutcome

/**
 * Every task this store currently holds.
 * @returns the tasks, in submission order.
 */
list(): readonly Task[]
```

Source: [`packages/collaboration/taskboard/src/store.ts`](../../packages/collaboration/taskboard/src/store.ts)

<a id="agent-events"></a>

### `agent/*` events

<a id="agentcreated--emit"></a>

#### `agent/created` — emit

A fully configured agent and live session were published. Setup is composition-only; `agent/session-start` is the first startup-driving extension point. Synchronous listener failure vetoes publication, while returned-promise rejection is reported. Detach requested during dispatch waits until every creation listener has observed the stable entry.

```ts cordis-catalog
/**
 * A fully configured agent and live session were published. Setup is
 * composition-only; `agent/session-start` is the first startup-driving extension point.
 * Synchronous listener failure vetoes publication, while returned-promise
 * rejection is reported. Detach requested during dispatch waits until every
 * creation listener has observed the stable entry.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — emit

An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment. Custom registry users own their driver-ordering contract.

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — emit

A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record.

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — emit

One message left the inbox inside its open turn. If the proposed step is rejected, the claimed message ends here: it is neither discarded nor re-emitted as a user/message, and the turn closes without a step.

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — emit

One message was discarded from the live inbox.

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — emit

One message entered the live inbox.

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — waterfall

Reject a proposed step or replace the messages that enter it. Calling `next()` preserves the current messages.

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

Types: [Scoped](scope.md) · [UserMessage](session.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — waterfall

Replace the frozen call configuration. `await next()` yields the config the machine would use (agent options on the first request, the logged header afterwards); return a replacement to switch. Model-visible content must use logged channels; this waterfall cannot mutate messages.

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. Model-visible
 * content must use logged channels; this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

Types: [LlmCallConfig](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — waterfall

Handle one failed model-request attempt before the loop retries or closes its step. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery, or calls `next()` to delegate. The default `undefined` leaves the failure terminal.

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

Types: [LlmFailure](llm-streaming.md) · [ResolvedRetryPolicy](llm-streaming.md) · [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentsession-start--emit"></a>

#### `agent/session-start` — emit

The session lifecycle began, once before the first turn. Use `agent.inject()` to seed model-facing context. This is a notification, not a veto; disposal requested by a lifecycle owner is rechecked before the driver starts.

```ts cordis-catalog
/**
 * The session lifecycle began, once before the first turn. Use
 * `agent.inject()` to seed model-facing context. This is a notification, not
 * a veto; disposal requested by a lifecycle owner is rechecked before the
 * driver starts.
 * @param payload.agent - the agent whose session lifecycle began.
 * @param payload.source - why the session started (fresh startup, resume, …).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — emit

Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously after reserving cancellation; `idle` means no driver remains scheduled or active.

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — serial

The turn is about to close: the model owes no response (no live tool calls, no fresh steering). Awaited before the boundary commits — a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. Data decides, so listener order cannot change the outcome. The inverse control (stop a tool loop early) is data too: a tool result carrying `concludesTurn` ends the turn at its step. The conclusion never short-circuits already-submitted next-step work: same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

Types: [Scoped](scope.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` events

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — emit

A declarative agent entry failed before it could publish a live agent. Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever. Normal factory teardown suppresses failures from the cancelled startup attempt.

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

Source: [`packages/core/agent-loop/src/index.ts`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` events

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — emit

One session committed a different agent preset to its durable log. Consumers invalidate only state derived from that session's composition.

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

Source: [`packages/preset/agent-presets/src/types.ts`](../../packages/preset/agent-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
