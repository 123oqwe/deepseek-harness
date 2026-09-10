# P4-02 — Generic compiled TaskProfile

PreFlight, recorded before the first line of code. The machine-readable half is `clause-subject-audit.json`'s `preFlight.P4-02`; this page is the reasoning that half compresses.

Lane B. Predecessors P2-04 and P4-01 are both ACCEPTED (`2d2e8f89ac`, `b3186e6db982e79a7c933b3326ee3a908bdf7385`); `check-ready P4-02` reports READY.

## What the tree looks like at the moment of recording

Measured at `e3004c9276`, not assumed:

| question | measurement |
|---|---|
| Does `TaskProfile` exist anywhere in the tree? | No. `grep -rn TaskProfile packages` returns nothing outside `spec/` prose. Every occurrence is registry / ledger / matrix text. The whole vocabulary is new. |
| Does `packages/run/task-profile` exist? | No. `packages/run/` holds `lease`, `lease-sqlite`, `message-bus`, `run`, `taskboard-sqlite`. Four of the seven declared files are a package that does not exist yet. |
| Do the two U files exist, and are they what the wave map assumes? | They exist; one is not. `core/agent/src/types.ts` is the durable agent-handle and session-event vocabulary — the right place. `core/agent/src/dispatch.ts` is the **fused event dispatcher** (`agentEvents`, `AgentSubjectEvent`), 310 lines of scope-carrier plumbing with no intake in it. The wave map calls the U pair "intake/persistence consumers"; only half of that is true of this tree. |
| Is `spec/task-profile.schema.json` in the registry's `files[]`? | **No.** It appears only in `stages.C` (5 files) while `files[]` lists 7 without it. The two lists disagree; `spec/` holds four sibling schemas (`action-manifest`, `capability-manifest`, `control-protocol`, `first100-evidence`) so the path is house-shaped, but the C freeze would reference a file outside `files[]`. |
| Is zod already here? | Yes, as the house pattern: `zod ^4.4.3` is declared in **39** package manifests (`llm`, `agent-loop`, `schedule`, `context/*`, …). `require.resolve('zod')` from the repo root throws `MODULE_NOT_FOUND` — pnpm does not hoist it — so adopting it is a manifest line in a new package, not a new dependency for the repo. `ajv` appears twice and is not the house choice. |
| Is there a side-effect / risk vocabulary already? | Yes, and it is P2-04's, accepted last wave. `packages/policy/risk-taxonomy` exports `RiskClass` (8 members), `RiskGroundKind` (`policy-rule` / `kernel-hard-deny` / `unknown-default`), `RiskClassification { riskClass, ground, decidedBy, confidence, hardDenied }`. |
| Is there a place for must[2]'s questions to go? | Yes. `ctx.userQuestions` is a live capability seam (`packages/interaction/user-questions`, `UserQuestionService`) with two production consumers already on it: `interaction/tool-ask-user/src/index.ts:81` and `plan/plan-mode/src/index.ts:296`. |
| Where does a task actually enter the product? | Six origins, all through one call: `ctx.agents.create()` in `acp/acp/src/session.ts:128`, `api/session-controller/src/agent.ts:477` and `commands.ts:247`, `bundle/headless/src/index.ts:279`, `sdk/server/src/server.ts:401`, `webhook/webhook/src/session.ts:136`. |
| Is there a precedent for hanging a compiled artifact off the agent? | Yes, three times in the U file itself. `Agent.runId`, `Agent.lifecycle`, `Agent.runLease` are each declared in `core/agent/src/types.ts` with a **writer contract** naming `RunPlugin` as sole writer, and each is written from that plugin's `agent/session-start` listener (`run/run/src/index.ts:853`). `@deepseek-ai/dsh-run` is mounted in the shipped base bundle (`bundle/base/cordis.patch.yml:563`). |
| Is a deterministic canonicalizer available if acceptance[0] needs a digest? | Yes — `canonicalizeArguments` (`action/action-manifest/src/canonicalize.ts:70`), P2-03's JCS, already used for argument hashing. Recorded as available, not as adopted: acceptance[0] asks for stable *output*, not a stable id. |

## The verdict, and what it does and does not license

`CONTRACT_WRITE`, no secondary. The ledger row lists **no `adapt` entry at all** — two OSS rows, `a2aproject/A2A Task/Message` as `reference` (naming only) and `W3C PROV (per-field provenance)` as `reject` ("Overkill"), neither with an npm name. So `adopted` and `deviations` are both legitimately empty here, and `rejectedAbsent` is empty because the one rejection has no npm name to scan for. Gate (b)'s positive control has nothing to find in this epic; that is a property of the row, not an omission.

What that means in practice: **nothing about this epic is bought.** The entire deliverable is dsh vocabulary. The make-vs-use question therefore reduces to a different one — not "which library", but "which of the vocabularies this repository *already owns* must this epic import instead of minting a second copy of". Three answers, and all three are the real content of this preFlight:

1. **Side-effect class is P2-04's, not ours.** acceptance[2] says an unknown side effect must not be marked `none`. `RiskClass` has no `none` member and `RiskGroundKind` already distinguishes `unknown-default` from a matched rule, with `confidence: 0` attached. Importing it makes acceptance[2] true by construction; minting a parallel `SideEffectClass` with a `none` member would recreate exactly the hole the clause names, and would be the second-declaration failure §7.6 scans for by behaviour.
2. **JSON Schema shape is P0-06's.** `standards-ownership.json` records `thisEpicOwns: false`, `owner: P0-06`, family `JSON Schema 2020-12`. This epic imports; it declares no standard of its own. `standardsOwned` is empty, and gate (e)'s frozen-case requirement for owned standards does not apply.
3. **Goal provenance is a session reference, not a copy.** must[1] keeps "原始用户目标引用" — a reference. `user/message` events carry `data.id` and `data.source` and are already the durable record (`api/session-controller/src/history.ts:37`). A profile that inlines the goal text would be a second copy of a durable fact with no way to detect divergence.

## Stage shape, and the one place the registry and the tree disagree

- **C** — `task-profile/src/types.ts`, `validate.ts`, `tests/profile.spec.ts`, `run/run/src/types.ts`, `spec/task-profile.schema.json`. The vocabulary: goal ref, hard/soft constraints each carrying source + confidence, side-effect class imported from P2-04, and the question contract. `run/run/src/types.ts` is [P]-kind and already names `'accepted'` and `'planning'` in `RunState` — the two states a profile exists between — so the reference from a Run to its profile belongs there.
- **P** — `task-profile/src/index.ts`: the deterministic compiler. acceptance[0]'s stability is this stage's property.
- **U** — `core/agent/src/{dispatch.ts,types.ts}`. §2.9a requires the U freeze to name ≥1 of these. `types.ts` is straightforward: a `taskProfile?` field with a writer contract, the fourth in a file that already carries three. **`dispatch.ts` is the open one** — see question 1.
- **F** — `task-profile/tests/profile.spec.ts`: validation[0]'s four generic fixtures (code, research, external action, personal plan), conflicting constraints, missing information.

## Open questions this preFlight does NOT settle

1. **What is the production call site, and does `dispatch.ts` have one?** This is the question that revoked P2-02, P6-07 and P1-10 (§12.69, §12.75, §12.78), and the answer must exist before code, not after. `core/agent` is a library; it constructs no agents and compiles nothing. The only shape on this tree that reaches all six intake origins with one site is P4-01's: a plugin listening on `agent/session-start`, writing a field on the `Agent` handle, mounted in the base bundle. But that writer would live in `run/run/src/index.ts`, which is **not** in this epic's `files[]` (only `run/run/src/types.ts` is), and `packages/run/task-profile` is mounted in no bundle at all. So either (a) the compiler package gains a plugin entry and a base-bundle mount — both outside `files[]`, needing `filesOverlay` and a delegate ruling, or (b) the U consumer is something already in `files[]` that I have not found. I am not choosing between these. **What I will not do is write a compiler with no caller and report "built".**
2. **`spec/task-profile.schema.json` is in `stages.C` but not in `files[]`.** Under §2.10 a freeze referencing it needs a `filesOverlay` entry with a reason; under the lifecycle's own instruction a registry self-inconsistency is a delegate matter (A-class), not something I reconcile by picking the longer list. Which list governs?
3. **Where is a TaskProfile physically persisted, and who writes it?** §12.78's rule, asked before any code: validation[2] requires persistence and version revision. Candidates on this tree are the session log (`SessionEventMap`, which the model-visible⟺logged rule would favour if the profile ever reaches a model request), the Run event log (P4-01, `RunEvent`), and a storage-hub domain unit (the medium §12.78 corrected P1-10 onto). These have different version-revision semantics — a session event is append-only and needs `SESSION_FORMAT_VERSION` discipline, a KV unit has `KvUnitDescriptor.version` and refuses a mismatched open. Choosing wrong is precisely the P1-10 failure. I have not chosen.
4. **Does the profile reach a model request?** If yes, "model-visible ⟺ logged" makes a session event mandatory and settles question 3 by itself. The registry does not say, and the six intake origins do not agree on having a model in the loop (webhook and ACP do; a bare `sdk-minimal` composition may not).
5. **Does must[2]'s question go through `ctx.userQuestions` synchronously?** The seam exists and is the obvious target, but `UserQuestionService` blocks on an answerer. A compiler that awaits a human inside a deterministic compile step would break acceptance[0]'s stability. The likely shape is that the profile *carries* open questions as data and something else asks them — but "produces a question" in must[2] could be read either way, and the two readings have different stage boundaries.
6. **Gap check, one community package, one unresolved sentence.** `dsh-trajectory-governor` (13★, ≈30%) is recorded in the ledger with its gap sentence **truncated mid-word**: "…no side-effect field at all, so 'unknown side effect". The three legible gaps map to must[1] (no per-inference source/confidence, only a scalar complexity score), must[2] (guesses instead of emitting a question) and acceptance[2] (no side-effect field). The truncated clause is presumably also acceptance[2]; I am recording it as truncated rather than completing it from context.

## Two pointers in the assignment that do not resolve on this tree

Reported as lifecycle bugs per the file's own instruction, not worked around:

- **`EPIC-LIFECYCLE.md` §5.1** — §5 has no subsections; it is the single 提速令 paragraph naming three Writer lanes (L1/L2/L3). There is no "双 lane 协议" §5.1 at `e3004c9276`.
- **`plan-rectification-2026-09-06.md` §12.79–§12.80** — the file ends at §12.78. §12.77 and §12.78 exist and are read (P1-10's storage-model reversal and the "建了 = 有生产调用点" restatement are the two rules I have applied hardest above).

If either exists in a commit this worktree does not have, `lane-b` is at `fork/first100-exec` `e3004c9276` and needs the newer base before I can honour it.

---

# P4-02.P — Provider stage preFlight

Recorded at `39102d4530`, before the first line of Provider-stage code, per §1.12. The C stage is written and awaiting its freeze; nothing here has been implemented.

The delegate's three answers to the questions the C preFlight left open are taken as given and are not re-argued: the deterministic parser extracts only what is *already structured* and records `unknown-default` plus a question for everything else; the compiler does not take a `RiskPolicy` and leaves classification to a consumer that holds one; constraint ids derive from a digest of the normalized statement and source rather than from a counter.

## Two measurements that contradict the mount point, found before writing code

Both were measured on this tree, not inferred from the sheet.

### 1. `accepted → planning` is a transition nothing performs

The ruling puts the compile at the Run's `accepted → planning` transition. That transition has no production caller.

| measurement | result |
|---|---|
| Production callers of `ctx.runs.advance(...)` | **Zero.** `grep -rn "\.advance(\|ctx\.runs" packages apps --include='*.ts'`, excluding tests, `.spec.ts` and `lib/`, returns one hit and it is `packages/extensions/tool-cordis/src/api-catalog.ts:1561` — a generated documentation artifact, not a call. |
| What writes a `RunEvent` in production | `createRun` only (`run/run/src/index.ts:332` and `:359`), which mints the genesis event at `accepted`. Nothing appends a second entry. |
| What actually moves in production | `Agent.lifecycle`, which is P4-05's **`AgentLifecycle`** vocabulary — `queued`, `starting`, `running`, `waiting_tool`, `cancelling`, `completed`, `failed` — advanced from `ensureRunning` on `agent/pre-step` (`index.ts:795-814`). `RunState`'s `accepted / planning / waiting / verifying / reconciling` are a **second, parallel vocabulary that no production path advances**. |

So mounting the compiler on `accepted → planning` as specified would put it behind a transition nothing performs. That is the P2-02 / P6-07 / P1-10 zero-arrival shape (§12.69, §12.75, §12.78) — the fourth instance, and the first one caught before the code was written rather than at sign-off.

### 2. `agent/session-start` does not carry the goal

`SessionStartSource` is `'startup' | 'resume' | 'clear' | 'compact'` (`core/agent/src/runtime-types.ts:91`) and the payload is `{ agent, source }`. There is no task text in it, and there cannot be: the event fires when the session opens, before the first user message exists. A compiler that runs there has nothing to compile.

The event that does hold the goal is **`agent/pre-step`**, whose payload carries `messages: UserMessage[]` — "messages removed from the inbox for this step" (`runtime-types.ts:260`). `RunPlugin` already subscribes to it (`index.ts:862`), which is also where it advances the lifecycle. The first `agent/pre-step` of a run is the first moment at which the goal, the identity and the budget are all in hand at once.

## What the deterministic parser can actually read

The inventory the delegate asked for, measured rather than assumed. Everything below reaches `RunPlugin` at the first `agent/pre-step` through `agent.options`, `agent.identity` or a service it can inject.

| source | structured fields available | what it can become in the profile |
|---|---|---|
| `AgentOptions.budget` (`runtime-types.ts:43`) | `maxTurns`, `maxSpendUsd` | **hard** constraints, `origin: 'user-stated'`, `confidence: 1` — these are ceilings the loop enforces for itself, not guesses. Absent, and `0`, both mean unbounded; that distinction has to survive into the profile or a stated "no cap" becomes an inferred one. |
| `AgentOptions` route fields | `provider`, `model`, `reasoningEffort`, `maxTokens` | **soft** constraints at most. They describe how the work is done, not what the task requires, and promoting a default route to a hard constraint would invent a requirement the user never stated. |
| `Agent.identity` (`IdentityContext`, P2-01) | acting principal and the full delegation chain | not a constraint. It is the answer to "whose authorization would be assumed", which is exactly what must[2] forbids assuming — so an absent identity is a reason to emit a question, never a reason to default. |
| `@deepseek-ai/dsh-workspace-trust` | `TrustState`: `untrusted` \| `trusted-read` \| `trusted-execute` (`workspace-trust/src/types.ts:61`) | bounds the side-effect class the profile may claim. An `untrusted` workspace cannot yield a decided `external-communication`. |
| `user/message` event | `id` (`MessageId`), `source` (`user` \| `plugin` \| …) | the `TaskGoalRef`, and the `source.kind` decides whether this is a human goal at all — a synthetic `agent.inject()` context is not a task to profile. |
| the goal text | free-form | **nothing.** Per the ruling, natural-language inference is not this stage's work. Text yields a profile whose side effect is `unknown-default` and whose `questions[]` is non-empty. |
| headless / ACP / SDK / webhook request metadata | measured: `bundle/headless/src/index.ts:279` passes only `{ sessionId, meta: { cwd }, agentOptions: { provider, model } }` | `cwd` is the only per-origin field beyond `AgentOptions`, and it is not a task constraint. **The six origins do not differ in what a profile can read from them**, which is a useful negative result: one mount point suffices and no per-origin branch is needed. |

The honest consequence, stated so it is not discovered later as a disappointment: **the first version's profiles will be mostly questions.** A goal with no budget set and no explicit trust posture compiles to one objective, zero or one constraints, an `unknown-default` side effect and two or three questions. That is correct under must[2] and acceptance[2], and it is what makes the epic's value — provenance, confidence, and asking instead of guessing — real rather than decorative.

## Where the output goes

Unchanged from the delegate's ruling, and the C stage already carries both halves:

1. The profile body is appended to the session log as `run/task-profile` (`{ ref, profile, previousRef? }`), which is the durable home validation[2] asks for and the record P4-03 will need for "model-visible ⟺ logged".
2. A `RunEvent` naming it by `TaskProfileRef` — **once the Run event log has a production writer at all**. Today it has exactly one entry per Run and no appender, so this half depends on finding 1's resolution.

## Fixtures and mutation plan for P

The four generic kinds become compiler inputs rather than literal profiles: each fixture is a `TaskProfileInput` (goal ref, text, plus the structured fields above) with an expected profile. Determinism (acceptance[0]) is observed by compiling each fixture twice and comparing `taskProfileRef`, not by comparing objects — the digest is what the Run log and the revision chain actually key on.

Planned mutations, all in the non-loosening forms this epic has been using (constant, value and dependency replacement rather than removing a check):

- Compile the budget as a `soft` constraint instead of `hard` — reds the budget fixture only.
- Report `confidence: 1` on a field that came from no structured source — reds the "unstated field is not certain" case.
- Emit no question when the side effect is undetermined — reds the must[2] fixtures while the four positive fixtures stay green as controls.
- Derive a constraint id from a counter instead of the statement digest — reds the "recompiling an unchanged goal yields the same ref" case, which is the revision chain's load-bearing property.

## Open questions this preFlight does NOT settle

1. **Where does the compiler actually mount, given finding 1?** Three shapes, and the choice is the delegate's: (a) the first `agent/pre-step` in `RunPlugin`, with the Run event deferred until the Run log has a writer; (b) the same, plus P4-02 giving the Run log its first real appender — which is arguably P4-01 work arriving late rather than this epic's; (c) somewhere else entirely. I have not chosen, and I will not write a compiler mounted on `accepted → planning`.
2. **Is `RunState` reachable at all, and whose problem is that?** P4-01 is ACCEPTED with a state machine that no production caller advances. That is a finding about P4-01, not about P4-02, and it belongs in the queue as its own item rather than being quietly absorbed by whichever epic notices it first.
3. **Does a synthetic `user/message` get profiled?** `source.kind === 'plugin'` covers injected context — file-change notices, skill content, cron notifications. Profiling those would produce a TaskProfile per injected notice. The filter is one line, but which sources count as a task is a product decision.
