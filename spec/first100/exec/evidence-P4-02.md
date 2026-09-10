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
