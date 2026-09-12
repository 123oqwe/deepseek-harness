# P4-02 — Generic compiled TaskProfile

PreFlight, recorded before the first line of code. The machine-readable half is `clause-subject-audit.json`'s `preFlight.P4-02`; this page is the reasoning that half compresses.

Lane B. Predecessors P2-04 and P4-01 are both ACCEPTED (`2d2e8f89ac`, `b3186e6db982e79a7c933b3326ee3a908bdf7385`); `check-ready P4-02` reports READY.

**Update, 2026-09-10 — that sentence was true when recorded and one half of it no longer is.** P4-01's sign-off is WITHDRAWN (BLOCKED-183: the `runs` service has no consumer outside its own package). This epic keeps going, on two grounds the delegate ruled explicitly (gq-04):

- **Mechanically READY.** `check-ready.mjs:220` admits a predecessor on `row.status !== 'ACCEPTED' && !everyApplicableCellGreen(...)` — ACCEPTED **or** every applicable cell green. P4-01's withdrawal removes the signature, not the four green cells: its library-level implementation is real and tested, and what it lacks is a production caller. Verified against that line in this tree. The run itself followed once the withdrawal landed: on base `d69d6e5b3e`, `node scripts/first100/check-ready.mjs P4-02` exits 0 with `READY: P4-02 — every predecessor ACCEPTED or fully landed, no declared-file overlap with any in-flight epic` (recorded in `preflight-P4-02-U.md`), so the mechanical half of §12.83 is observed rather than only read.
- **By design.** P4-02's Provider stage becomes P4-01's first production caller of `accepted → planning`, and P4-01.U2 follows immediately in the same lane and package. Order: P4-02.P → U → F → P4-01.U2.

**But sign-off does not follow readiness.** New rule (§12.83): with a withdrawn predecessor a successor may start and may green its cells, and may **not** reach ACCEPTED. P4-02's own sign-off waits until P4-01 is re-signed through U2. `check-ready` governs starting, not signing; this gap is closed by sign-off discipline rather than by the gate.

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

## A gap the C freeze left, closed in P rather than back-patched

The C stage admitted `src/index.ts` as a B4(f) type-only barrel — exactly one statement — and **froze no case over that shape**. P2-04, the precedent the admission cites, did pin it ("src/index.ts is exactly one statement and it re-exports types only"); this freeze's 12 cases do not. So the property was true and unguarded: any commit could have added a runtime export to the barrel and nothing would have reddened.

Recorded here rather than back-patched, per the delegate's ruling (gq-04, 2026-09-10): a closed freeze is not reopened. The Provider stage adds the case instead, over the surface it actually promises — `index.ts` exports exactly one runtime symbol, `compileTaskProfile` — with the mutation being a second exported symbol. `export type *` contributes no runtime key, so the module namespace's own keys are the whole runtime surface and the case can read it directly.

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
3. **Not a question, a boundary marker the delegate asked to be written down.** `createTrustKernel()` at `apps/cli/src/profile-boot.ts:478` is called with no arguments, so `policyEnforcement` returns `deny` for every query (`kernel/trust-kernel/src/index.ts:169-171` — deny-by-default is deliberate there: "an entrypoint with no provider behind it must refuse, not permit"). The shipped profile therefore configures no policy decider, and any epic whose path needs a PEP to let it through is refused with `policy-unavailable` until that assembly is fixed. **This epic must never meet that reason code.** `compileTaskProfile` is a pure function called from `RunPlugin`'s first `agent/pre-step`; it dispatches no tool and queries no policy, and must[2] points the opposite way — an ambiguous or high-risk missing field yields a question rather than an assumed authorization. So if the compiler ever reports `policy-unavailable`, that is not the kernel's assembly defect reaching this epic: it means the compiler was built into something that asks for authorization, which is a must[2] violation to fix here.

4. **Is this package a `package-library`? Deferred to the P freeze by delegate ruling (gq-04, 2026-09-10).** The README's `kind` is `package-reference`, which is what `doc-standard.spec.ts`'s `expectedKind` grants any directory not listed in the audited `PACKAGE_LIBRARIES`. The package would plausibly qualify — `src/index.ts` has no default export and no `apply` — but today that file is the B4(f) type-only scaffold, and the runtime export the claim would rest on (`compileTaskProfile`) is the Provider stage's deliverable. Declaring a scaffold to be a library signs for a shape that does not exist yet. **Revisited at the P freeze, judged against whatever `index.ts` is then**; `package-reference` is correct until that point.

5. **Does a synthetic `user/message` get profiled?** `source.kind === 'plugin'` covers injected context — file-change notices, skill content, cron notifications. Profiling those would produce a TaskProfile per injected notice. The filter is one line, but which sources count as a task is a product decision.

---

## acceptance-coverage pre-check, before predicate (i) needs it

`acceptance-coverage.json` has **no P4-02 entry yet**, which is correct for a row whose cells are `NOT_RUN`. This is the pre-check of what those entries will say, done now because a gap found at sign-off costs a round trip and a gap found here costs a sentence.

**One thing the schema says that this pre-check must not blur.** A citation has to resolve to a real frozen case *and*, for the closure predicate, to a real **observed-passing** one. The C cell is `NOT_RUN`, so **nothing in P4-02 is citable today**: the twelve C titles are frozen, not observed. Everything below is "what will be citable when the C cell greens", and the P column is "what will be citable after the P freeze *and* its observation". Frozen is not observed, and a coverage table that treats them alike is the kind of record that reads as evidence and is not.

| acceptance | covered by C (frozen, citable once C greens) | covered by P (drafted, citable after P freezes and observes) |
|---|---|---|
| **[0]** same input, stable output under a deterministic parser fixture | 2 — the key-order-independent reference, and a changed confidence yielding a different reference | 3 — compiling the same input twice, a changed budget changing the reference, ids from the statement rather than from position |
| **[1]** every hard constraint traceable to its source | 3 — no provenance refused, two contradictory constraints both kept with their own sources, confidence outside `[0, 1]` refused | 1 — a stated budget becoming a hard constraint whose provenance names the field |
| **[2]** an unknown side effect is never marked `none` | 2 — an undetermined effect accepted, the same effect refused when it claims certainty | 3 — undetermined at confidence 0, trust recorded without deciding the class, "not supplied" distinguished from "untrusted" |

**Zero acceptance indices have no coverage at all.** Five of the twelve C titles and seven of the fourteen P drafts serve `must[]` clauses or the module surface rather than an acceptance index, which is expected: `must[0]`'s generic-fields-only, `must[2]`'s question rules, the origin classifier's fail-closed default, the seventh `RunEntityKind`, and `index.ts`'s runtime surface are not acceptance clauses and should not be cited as if they were.

**The gap that the table hides, and it is about acceptance[0].** Read strictly, acceptance[0]'s subject is *"the same **input** produces stable output under a deterministic parser fixture"* — a statement about the **compiler**. The two C cases are about a profile's canonical digest, which is the property the compiler's determinism is *observed through*, not the determinism itself: C has no compiler to feed an input to. So the honest reading is that **acceptance[0] is closed by P and by P alone**, and C's two cases are supporting rather than covering. This matters in one specific way: if the coverage entry cites C for acceptance[0], predicate (i) could close on cases that never compiled anything. The entry should cite P for acceptance[0] and list the C pair in its `note` as the digest property P depends on.

That is a proposal for the entry's content, not a decision: `acceptance-coverage.json` is Supervisor-curated, and what a citation may claim is exactly the thing this artifact exists to keep honest.

---

# P4-02 — production-arrival evidence for the signature pass (U and F)

Same shape as `evidence-P4-01.md`'s 4.4 table and written for the same purpose: the delegate re-greps every row. Paths at `b76d54b0cf`.

The Contract and Provider stages above recorded a vocabulary and a compiler. What follows is what CALLS them, which is the question the Usage stage exists to answer and the one a sign-off has to be able to check.

## 4.4a — the noun, and the production call site that reaches it

| named thing | production call site | reached from |
|---|---|---|
| **`compileTaskProfile`** | `packages/run/run/src/index.ts:978` | `RunPlugin.recordTaskProfile` — the epic's only production caller |
| the first-step marker | `packages/run/run/src/index.ts:1192` | `const firstStep = agent.lifecycle?.state === 'queued'`, captured BEFORE `ensureRunning`, which is what consumes that state |
| the call itself | `packages/run/run/src/index.ts:1229` | inside the `agent/pre-step` waterfall, guarded by `firstStep` |
| `goalOf` (text blocks joined, other kinds tallied) | `packages/run/run/src/index.ts:111`, called at `:976` | OQ2 — the caller reads the text that is there and counts what it could not |
| `taskOriginOf` | `packages/run/task-profile/src/types.ts:312`, called at `packages/run/run/src/index.ts:985` | only `user` and `goal` compile |
| `goalRoundOf` | `packages/run/task-profile/src/types.ts:334`, called at `packages/run/run/src/index.ts:977` | OQ4(b) — the entered goal's identity rides `TaskGoalRef.goalRound` |
| `taskProfileRef` | `packages/run/task-profile/src/validate.ts:236`, called at `packages/run/run/src/index.ts:991` | the digest the Run log names |
| `lastTaskProfileRef` (the skip's input) | `packages/run/run/src/index.ts:131`, called at `:992` | OQ3 — read from the LOG, because a resumed session's handle carries nothing |
| the skip | `packages/run/run/src/index.ts:1008` | `if (previousRef !== ref)` — an unchanged profile is not appended twice |
| the session append | `packages/run/run/src/index.ts:1009` | `run/task-profile`, the profile's durable home |
| `Agent.taskProfile` | `packages/run/run/src/index.ts:1011` | the handle carries the digest, never the body |
| **`validateTaskProfile`** | **no production caller** | deliberate: it is the durable-boundary check for a READER, and the reader is P4-03. Recorded as a limitation in the package README rather than left to look like an oversight |
| `unreadContentQuestion` / `undeterminedSideEffect` | `packages/run/task-profile/src/index.ts:230`, `:194` | module-private; reached only through `compileTaskProfile` |

## 4.4b — the mount row and the generated registrations

| what | where |
|---|---|
| the plugin that calls the compiler | `packages/bundle/base/cordis.patch.yml:628` — `@deepseek-ai/dsh-run`, enabled, on every shipped profile |
| the event type's registration | `packages/core/session/src/known-event-types.ts:52` — GENERATED from the in-repo `SessionEventMap`, so declaring the member is what registers it |
| the durable documentation | `docs/persistence-catalog.md:741` — `run/task-profile`, log-only |

`@deepseek-ai/dsh-task-profile` mounts nothing and is an audited `PACKAGE_LIBRARIES` entry: one pure function, no plugin entry, no ctx key.

## 4.4c — what a model or a user can observe

**Nothing yet, and that is the honest answer rather than a gap.** The profile is compiled, appended and referenced; no path puts it into a model request. "Model-visible ⟺ logged" is satisfied in the direction that exists — it is logged and not visible. P4-03 is the epic that makes it visible, and `validateTaskProfile` exists for that reader before the reader does.

## 4.4d — the observation, per clause

| clause | observed by | where |
|---|---|---|
| must[1] — every inference traces to the goal | `compiles the objective from the goal the human actually sent, and keeps the reference beside it` | `packages/run/run/tests/task-profile.spec.ts:130` |
| must[1] — compiled once, at the first step | `appends exactly one run/task-profile event and names it on the Agent handle`, `appends no second profile for a second goal in the same session` | `:119`, `:177` |
| must[2] — only a human goal is a task | `compiles NOTHING for a first message that is injected plugin context, and leaves the Run accepted` | `:189` |
| must[2] — a goal round IS a task (OQ4(b)) | `compiles a profile for a goal continuation round and carries the round into the reference` + its control | `:303`, `:322` |
| must[2] — ask, do not guess (OQ2) | `compiles a profile for an image-led first message and asks what the image asks for` | `:209` |
| validation[2] — persisted | `references a digest whose body is in the session log, so the reference is resolvable` | `:163` |
| validation[2] — revisable (OQ3) | `appends no second profile when a resumed session re-claims the SAME pending message` + `DOES append a second profile when the resumed session carries a different goal` | `:248`, `:279` |
| validation[2] — named in the Run log | `moves the Run accepted → planning carrying the profile as a task-profile reference` | `:147` |
| validation[2] — the revision arithmetic | the F stage's seven single-field moves plus the unchanged-recompile control | `packages/run/task-profile/tests/profile.spec.ts`, the `P4-02 F — the revision arithmetic` block |

**One ordering claim is deliberately NOT observed**, and its absence is recorded so it does not read as a gap: that the profile is recorded "before the step it plans". A case asserting it passed with the call moved after `next()`, because the loop appends `step/start` and the step's own `user/message` only once the whole pre-step waterfall resolves. No log observation distinguishes the two placements, so the claim was withdrawn rather than frozen.

## 4.4 per frozen behaviour — the U and F stages, one row each

Written for the signature pass. Every line number was re-read at `1deda037ba`; the ones §4.4a carried were stale, because BLOCKED-211 removed the digest fields from the event and moved everything below the append.

**One fact governs every row below, so it is stated once rather than repeated eleven times.** The frozen argv for U is `pnpm exec vitest run packages/run/run`, and the harness those cases run in is `packages/run/run/tests/task-profile.spec.ts:71` — a hand-built `ctx.plugin(...)` composition of nine plugins, **not** a Loader boot of a shipped profile. `packages/AGENTS.md` is explicit that this is insufficient on its own for a product-visible plugin: "Hand-built `ctx.plugin(...)` suites are insufficient. Boot test-only `cordis.yml` through the Loader and app/process." **P4-02 has no composition fixture** — `tests/first100/fixtures/` holds `P4-01.composition.spec.ts` and `P4-01.fault.spec.ts` and nothing for this epic. So every U row's (d) is the same split, and it is not a defect in any individual case.

### U — eleven frozen behaviours

| # | frozen behaviour | (a) production call site | (c) measured reach | (d) §12.46-B |
|---|---|---|---|---|
| 1 | appends exactly one `run/task-profile` event and names it on the Agent handle | `index.ts:1009` append, `:1011` handle | 1 production call site for `compileTaskProfile` (`:978`); 0 others in the repo | service does it; production arrival unobserved |
| 2 | compiles the objective from the goal the human actually sent | `goalOf` `:111`, called `:976` | same single path | service does it |
| 3 | moves the Run `accepted → planning` carrying the reference | `:1012` `service.advance(runId, 'planning', …)` | the only `'planning'` advance in the package | service does it |
| 4 | references a digest whose body is in the session log | `taskProfileRef` `:991`; body appended `:1009` | digest now DERIVED, never stored (BLOCKED-211) | service does it |
| 5 | appends no second profile for a second goal in the same session | first-step guard `:1192`, consumed `:1229` | one guard, one caller | service does it |
| 6 | compiles NOTHING for injected plugin context, leaving the Run `accepted` | `taskOriginOf` `:985` | refusal path has the same single caller | service does it |
| 7 | compiles an image-led first message and asks what the image asks for | `goalOf`'s non-text tally `:111` | same | service does it |
| 8 | appends no second profile when a resumed session re-claims the SAME message | `lastTaskProfileRef` `:131`, called `:992`; skip `:1008` | reads the LOG, so a resumed handle carrying nothing still decides | service does it |
| 9 | DOES append a second profile when the resumed session carries a different goal | same skip, negative branch `:1008` | same | service does it |
| 10 | compiles a goal continuation round and carries the round into the reference | `goalRoundOf` `:977` | `source.kind === 'goal'` is the only branch that yields a round | service does it |
| 11 | carries no round for a direct human prompt | same, `undefined` branch | same | service does it |

**(b) mount path, common to all eleven.** `@deepseek-ai/dsh-run` appears in exactly ONE shipped patch layer: `packages/bundle/base/cordis.patch.yml:628`, `id: run`, enabled, configured with `storePath: dshHomePath('runs', 'runs.json')`. The plugin registers on `agent/pre-step` and reaches `recordTaskProfile` at `index.ts:1229`.

**The chain from app-boot to that row, measured.** A profile is a directory under `$DSH_HOME/profiles/<name>`, so no `package.json` in this repository declares a `dsh.profile.bundles` list — which is what made this look unmeasurable at first. The lists are nonetheless in-repo: `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts:154`) holds the shipped templates auto-initialized on first use, and `initializeProfile` writes each one's `dsh: { profile: { bundles } }` into the profile directory at `profile.ts:226`.

| shipped profile | `bundles` | carries `dsh-base` |
|---|---|---|
| `acp` (`profile.ts:156`) | `dsh-base`, `dsh-acp-app` | yes |
| `web` (`profile.ts:160`) | `dsh-base`, `dsh-web-app` | yes |
| `headless` (`profile.ts:164`) | `dsh-base`, `dsh-headless` | yes |
| `sdk` (`profile.ts:168`) | `dsh-base`, `dsh-sdk-app` | yes |
| **`sdk-minimal`** (`profile.ts:172`) | `dsh-sdk-minimal` **only** | **no** |

**So this epic's code runs on four of the five shipped profiles, and not on `sdk-minimal`.** That is not an inference from the absence of `dsh-base`: `packages/bundle/sdk-minimal/cordis.patch.yml` declares 33 plugin rows and none of them is `@deepseek-ai/dsh-run` (0 matches), and the four app bundles that layer over `base` each carry 0 `dsh-run` rows of their own — the single row at `bundle/base/cordis.patch.yml:628` is the only one in the repository. A session run under `--profile sdk-minimal` therefore compiles no task profile, opens no Run, and logs no `run/task-profile` event, and nothing in this epic's frozen cases would notice.

**That is a design boundary, not a defect, and the bundle says so itself.** `packages/bundle/sdk-minimal/README.md:13` states the profile "supplies a complete Cordis tree and **deliberately excludes `dsh-base`**", then names what goes with it — Web, settings, managed credentials, telemetry, compaction, workspace instructions, skills, jobs, subagents. Neither that README nor its Chinese counterpart claims a Run, a task profile, or a run lifecycle anywhere (grep for `run`/`task profile`/`lifecycle` returns no capability claim). So no number is owed: the profile advertises a two-tool coding agent and delivers one. What this epic owes instead is honesty about its own reach — the cells below are evidence for four shipped profiles, not five.

### F — fourteen frozen behaviours, three families

The frozen argv for F is `pnpm exec vitest run packages/run/task-profile` — the pure library, with no `Context`, no mount, and no Agent. **(a) production call site: none of the fourteen has one, and that is what the F stage is.** They exercise `compileTaskProfile`/`taskProfileRef` directly over caller-supplied input. **(b) mount path: not applicable** — `@deepseek-ai/dsh-task-profile` mounts nothing and is an audited `PACKAGE_LIBRARIES` entry. **(d) every one is "the service can do this"; none is "production reaches it".**

| family | cases | (c) measured reach |
|---|---|---|
| four task archetypes each asking about every unstated field | 1–4 (`code`, `research`, `external-action`, `personal-plan`) | the archetype is chosen inside `compileTaskProfile`; production supplies only the message, so which archetype a real goal takes is unobserved |
| two refusals | 5 (blank injected context → not-a-task), 6 (whitespace-only goal → empty-goal) | the refusal branch has one production caller (`:985` origin, `:978` compile), but no frozen case observes a refusal arriving there |
| the revision arithmetic — eight single-field moves plus a control | 7–14 (goal text, goal message, turn ceiling, spend ceiling, workspace trust, identity, unread tally, and "unchanged is not a revision") | case 8 ("changing the goal message it refers to alone changes the reference") is the one that decided BLOCKED-211's route: it binds the digest to message identity, which is why the event could not digest a projection that dropped those ids |

### What the split leaves owed

- **`validateTaskProfile` has no production caller** — 0 measured, deliberate, its reader is P4-03 and the package README records it.
- **No frozen P4-02 case observes a shipped-profile boot.** The production path is real and its call sites are above; what is missing is an observation that a Loader boot of a profile carrying `bundle/base` reaches them. P4-01's U2 slice owns a composition fixture that boots `dsh-app-boot`; the cheapest honest close for P4-02 is a case in that fixture asserting one `run/task-profile` event after a real boot, not a twelfth case in the hand-built harness.

## What the signature pass must record as still open

- **P4-02 cannot be ACCEPTED before P4-01 is re-signed** — its Usage stage's transition is P4-01's, and P4-01's sign-off is withdrawn (BLOCKED-183).
- **`validateTaskProfile` has no reader**, by design, until P4-03.
- **Four cells await observation**: `C.1` and `P.1` (the OQ4(b) and OQ2 supplements), `U`, and `F`.

-----

## The coverage citations prepared for the unobserved cells

**NINE OF ELEVEN LANDED 2026-09-11.** `U`, `F`, `C.1` and `P.1` were observed passing in CI run 34652643903 at candidate `93d52207338066bd65494f6044f1ec5920d63cb8`, so their nine citations are now in `acceptance-coverage.json` and `checkCoverageClosure('P4-02')` returns valid. **U.1's two rows are deliberately still held**: its frozen command names `tests/first100/fixtures/P4-02.composition.spec.ts`, which does not exist in that candidate's tree, so no artifact from that run could observe it. They land when a candidate carrying the fixture is observed — which is the same AND-semantics reason the rest were held, applied to a cell whose spec the observed tree did not contain.

`acceptance-coverage.json` now carries P4-02's three indices, citing **only** the cells a CI run has observed passing: `C` (12 matched at `d69d6e5b3e`) and `P` (14 matched at `e74593c50a`). `checkCoverageClosure('P4-02')` returns valid with no missing indices and no unverified citations.

The rest are held here for the same mechanical reason as P4-01's: closure treats every citation under one index as NECESSARY evidence (AND, not OR), so a title that is frozen but absent from the ledger row's `expectCasesMatched` does not record a plan — it turns a GREEN index red. `U`, `F`, `C.1`, `P.1` and `U.1` are all `NOT_RUN`. These go in verbatim once candidate 2 observes them, in one edit.

| acceptance | stage | title to cite | what it adds that the cited cells cannot |
|---|---|---|---|
| [0] | U | `appends exactly one run/task-profile event and names it on the Agent handle` | the stable output reaching a durable log, not just a returned value |
| [0] | U.1 | `compiles exactly one profile when a real shipped-path boot takes its first model step` | the only production arrival in the epic |
| [0] | U.1 | `names the same profile in the session log, the Run log and the Agent handle` | three records of one digest agreeing after a real boot |
| [0] | F | `leaves the reference alone when nothing structured changed, so an unchanged goal is not a revision` | the fault-stage control for stability |
| [0] | P.1 | `yields the same reference whatever order the caller counted the kinds in (acceptance[0])` | order-independence of the unread tally, which the P cases do not vary |
| [1] | U | `compiles the objective from the goal the human actually sent, and keeps the reference beside it` | the objective traced to a real message rather than a constructed input |
| [1] | F | `changing the goal text alone changes the reference, so that revision is visible in the chain` | the source moving is visible in the digest |
| [1] | F | `changing the goal message it refers to alone changes the reference, so that revision is visible in the chain` | the reference binds to message identity — the case that decided BLOCKED-211's route |
| [2] | U | `compiles a profile for an image-led first message and asks what the image asks for` | an undetermined value produced by content the objective could not read |
| [2] | F | `refuses a blank injected-context message as not-a-task, not as empty-goal` | the refusal is classified correctly rather than collapsing two different failures |
| [2] | C.1 | `refuses an unrecognised key inside the round, the same way the profile refuses one` | the goal-round vocabulary is closed too, so an unknown field cannot smuggle a decided side effect |

**A discrepancy in the assignment, resolved.** The assignment named `C` at `55866cb225`, which is the lane-B commit that WROTE the `C` cell green rather than the candidate that was observed — the delegate corrected it against the ledger. The observed candidates are `d69d6e5b3e` for `C` (CI run 34557063530) and `e74593c50a` for `P` (CI run 34573807027), which is what the ledger row carries and what the citations above and in `acceptance-coverage.json` were written against. The distinction is worth keeping: a cell's candidate SHA is the tree an observation ran on, never the commit that recorded the result, and `checkCoverageClosure` reads the former.

-----

## Sign-off material (4.4a–d)

Written 2026-09-12 in lane A, after every applicable cell and all three supplements went GREEN. Documentation only: nothing here changes product code, and every gap below is reported for the delegate to number rather than fixed.

**Every line number in this section was re-read at `73c1c04f2e`** — the tree `U.1` was observed on, not a candidate tip. That choice matters: the same file has moved under two later lane-A candidates (BLOCKED-229's `track()` and candidate 5's guard both added lines to `packages/run/run/src/index.ts`), so numbers read from a candidate branch would not resolve against the tree the observations rest on. The `§4.4a` table earlier on this page was written at `b76d54b0cf` and one of its rows is now stale — see gap (f).

**The predecessor blocker recorded above is cleared.** "P4-02 cannot be ACCEPTED before P4-01 is re-signed" was true when written; `delegate-signoff.json` now carries a P4-01 `PASS` from `first100-delegate-78`, signed 2026-09-12T00:09:27Z on row digest `156e75c8bd`, after BLOCKED-183's withdrawal was closed by the U.2 slice. P4-01 and P2-04 are both ACCEPTED / APPROVED with four green cells each.

### 4.4a — the production call sites, and the mount that reaches them

The epic has exactly **one** production caller, and it is not a test:

| named thing | production call site | what it does there |
| --- | --- | --- |
| `compileTaskProfile` | `packages/run/run/src/index.ts:978` | the epic's only production call, inside `RunPlugin.recordTaskProfile` (`:972`) |
| the first-step guard | `packages/run/run/src/index.ts:1192`, consumed `:1229` | `agent.lifecycle?.state === 'queued'`, captured BEFORE `ensureRunning` consumes that state |
| `goalOf` | defined `:111`, called `:976` | joins the text blocks and tallies the kinds it could not read |
| `goalRoundOf` | `:977` | the entered goal's round, for a continuation |
| `taskOriginOf` | `:985` | only `user` and `goal` compile; everything else refuses |
| `taskProfileRef` | `:991` | the digest the session log and the Run log both name |
| `lastTaskProfileRef` | defined `:131`, called `:992`, reads `:138` | the previous digest, read from the LOG rather than from the handle, so a resumed session decides correctly |
| the skip | `:1009` guarded by `previousRef !== ref` | an unchanged profile is not appended twice |
| the session append | `:1009` | `run/task-profile` — the profile's durable home |
| `Agent.taskProfile` | written `:1011`; declared `packages/core/agent/src/types.ts:126` | the handle carries the digest, never the body |
| the Run transition | `:1012` | `advance(runId, 'planning', [{ kind: 'task-profile', id: ref }], …)` — the only `'planning'` advance in the repository |
| `validateTaskProfile` | **none** | deliberate; its reader is P4-03. Declared in the package README, carried forward as gap (c) |

**The mount, and how a shipped profile reaches it.** `@deepseek-ai/dsh-run` appears in exactly one patch layer in the repository — `packages/bundle/base/cordis.patch.yml:638-639`, `id: run`, enabled, `storePath: dshHomePath('runs', 'runs.json')`. The four app bundles that layer over `base` carry no row of their own, and `packages/bundle/sdk-minimal/cordis.patch.yml` contains **0** occurrences of `dsh-run`. Through `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts:154`), `acp` (`:156`), `web` (`:160`), `headless` (`:164`) and `sdk` (`:168`) each list `@deepseek-ai/dsh-base`; `sdk-minimal` (`:172`) lists only `@deepseek-ai/dsh-sdk-minimal`.

**So this epic's code runs on four of the five shipped profiles.** That is a declared boundary rather than a gap: `packages/bundle/sdk-minimal/README.md` states the profile deliberately excludes `dsh-base` and claims no Run, profile or lifecycle capability. The cells below are evidence for four profiles, not five, and this section says so rather than letting "shipped" imply all of them.

The event type's registration and its durable documentation are both generated from the in-repo declaration: `packages/core/session/src/known-event-types.ts:53` and `docs/persistence-catalog.md:771` (log-only).

### 4.4b — cell observations

Taken from `ledger.json` as it stands (`lastUpdatedUtc` 2026-09-12T01:24:09Z). **Candidate 4's cloud run was still in flight when this was written, so no reading from it is used here**; if it lands green the delegate may re-point these rows at it, and the rows below are what the ledger actually carries today.

| cell | status | candidate SHA | CI run | frozen cases matched |
| --- | --- | --- | --- | --- |
| C | GREEN | `d69d6e5b3e` | 34557063530 | 12 |
| P | GREEN | `e74593c50a` | 34573807027 | 14 |
| U | GREEN | `93d5220733` | 34652643903 | 11 |
| F | GREEN | `93d5220733` | 34652643903 | 14 |
| C.1 | GREEN | `93d5220733` | 34652643903 | 9 |
| P.1 | GREEN | `93d5220733` | 34652643903 | 7 |
| U.1 | GREEN | `73c1c04f2e` | 34660413109 | 4 |

`checkCoverageClosure('P4-02')` was re-run read-only against this ledger, `command-freeze.json` and `acceptance-coverage.json`: **valid, no missing indices, no unverified citations.** All three acceptance indices now cite observed cells, including the two `U.1` citations this page previously recorded as held.

### 4.4c — what the service can do, and what production actually reaches

The two halves come apart cleanly here, and the split is narrower than "the epic works":

**Production reaches the compile, the digest, the log and the transition.** One message on the first model step of a Run, on any of four shipped profiles, compiles a profile, appends its body, names the digest on the handle and carries it on `accepted → planning`. `U.1` observes that through a real Loader tree booted by `@deepseek-ai/dsh-app-boot` in a child process, asserting only on JSON the driver wrote — not on live objects.

**Production reaches no reader.** Measured across `packages` and `apps`, excluding tests and `lib/`:

| the thing produced | production writers | production readers |
| --- | --- | --- |
| the `run/task-profile` event | 1 (`index.ts:1009`) | 1, and it is this epic's own skip (`lastTaskProfileRef`, `:138`) |
| `Agent.taskProfile` | 1 (`:1011`) | **0** |
| the profile's `questions[]` | 1, inside the compiler | **0** — nothing asks them |
| `hardConstraints` / `sideEffect` | 1, inside the compiler | **0** outside `packages/run/task-profile` |
| `validateTaskProfile` | — | **0** callers |

So must[2]'s "produces a question rather than guessing an authorization" is true in the direction the clause literally states — a question is produced, and it is durable — and there is no path on which a human is asked it. The `questions` hits a repo-wide grep returns are all `ctx.userQuestions`, an unrelated vocabulary belonging to `interaction/user-questions`; none of them reads a TaskProfile. This is the same shape §4.4c recorded for model-visibility earlier on this page, now measured across every field rather than only the model path: the profile is **logged and unread**, and P4-03 is the epic that reads it.

**One further narrowing of what `U.1` proves.** Its Loader config (`tests/first100/fixtures/loader/p4-02-task-profile/cordis.yml`) mounts `@deepseek-ai/dsh-run` directly, in a nine-row test-only composition. So it closes "a real `app-boot` Loader boot reaches the compile", which is the gap `§4.4` named, and it does **not** close "the row at `bundle/base/cordis.patch.yml:638` is what reaches it". The mount row is evidence by reading, not by observation. Recorded as gap (e) rather than claimed.

### 4.4d — production reach, per clause

Zero-reach entries are written as zero, not omitted.

| clause | production reach |
| --- | --- |
| must[0] — generic fields only, no vertical process | **Produced, not enforced in production.** The compiler emits only the generic vocabulary (`index.ts:978` is its one caller), so nothing production-side can mint a vertical field. The refusal that would catch one — `validateTaskProfile`'s closed-vocabulary check — has **0** production callers; the clause holds by construction of the single writer, and its guard is frozen in C/F only. |
| must[1] — original goal reference plus source/confidence for every inference | Reached: `goalOf` `:111`/`:976` supplies the text, `goalRoundOf` `:977` the round, and the compiled `goalRef` is appended at `:1009` and named at `:1011`. Observed on a real boot by `U.1`. |
| must[2] — a question instead of a guessed authorization | **Reached one way only.** Questions are compiled and durably logged on the production path; **0** production readers ask them. See 4.4c. |
| acceptance[0] — stable output for the same input | Reached: `taskProfileRef` `:991` is the production digest, and the skip at `:1009` is production behaviour that depends on its stability. `U.1` observes one profile per boot and the same digest in three records. |
| acceptance[1] — every hard constraint traceable to its source | **Produced, unread.** The provenance is compiled and logged; **0** production consumers read a constraint. Its three enforcement directions are frozen in C and P. |
| acceptance[2] — an unknown side effect is never `none` | **Produced, unread**, same shape as [1]. The `undetermined` value reaches the log through `:1009`; nothing production-side branches on it. |
| validation[0] — four generic fixtures | Library only, by design: the F cell runs `packages/run/task-profile` with no `Context`, no mount and no Agent. **0** production call sites, and that is what an F stage is. |
| validation[1] — conflicting constraints and missing information | Library only (C and P). Production supplies only a message, so which archetype or conflict a real goal takes is unobserved. |
| validation[2] — persisted and revisable | Reached, and the most production-bound of the nine: the append `:1009`, the previous-digest read from the log `:992`/`:138`, the skip `:1009`, and the Run naming at `:1012`. `U.1` observes the three records agreeing after a real boot. |

**No clause has zero production reach in the writing direction.** Three — must[2], acceptance[1], acceptance[2] — have zero in the reading direction, and two — validation[0] and validation[1] — are library-stage clauses with no production subject at all. That is the epic's honest shape: a compiler with one real caller, a durable record, and no consumer until P4-03.

### Gaps found, reported rather than fixed

- **(a) `acceptance-coverage.json`'s three P4-02 notes are stale prose.** All three still read "U is NOT_RUN" and "the production-arrival citation is prepared in evidence-P4-02.md §4.4 and is written here once observed". The citations are in fact present and `checkCoverageClosure` is valid. The data is right and the sentence describing it is a month out of date; the file is Supervisor-curated, so this is reported, not edited.
- **(b) TaskProfile `questions[]` has no asker.** 4.4c. Whether must[2] is complete without one is a clause-reading question for the delegate, not something a sign-off decides.
- **(c) `validateTaskProfile` has no production caller**, by design, until P4-03. Already declared in the package README; carried here so a re-grep does not read it as new.
- **(d) `Agent.taskProfile` has one writer and zero readers.** The same shape that grounded BLOCKED-183 against P4-01's `runs` service, one field down. Recorded because the standard that revoked a sign-off once should be applied to this epic's own surface out loud.
- **(e) No frozen case observes the shipped `bundle/base` row reaching the compile.** `U.1` boots a real Loader tree, but mounts `dsh-run` from a test-only config. Closing this needs a case over a composition that layers `bundle/base` itself.
- **(f) This page's earlier §4.4a/§4.4b line numbers are stale in one row.** `bundle/base/cordis.patch.yml:628` is now `:638-639` at `73c1c04f2e`. The `run/run/src/index.ts` numbers in those sections still resolve at that SHA; they do not on lane-A candidates 4 and 5, which is why this section pins its tree explicitly.
