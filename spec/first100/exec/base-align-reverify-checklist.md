# BASE-ALIGN-v3 — re-verification checklist (executable, ordered)

Assembled 2026-09-13 from measured preflight data. **No new analysis, no code changed.**
Baseline `4e84901e64` · upstream `c291e7961a` · conflict source `~/first100-delegate/upstream-gap-2026-09-13/merge-tree-conflicts.txt`.

Scope: the **30 non-snapshot conflicting files cited by at least one live freeze entry**, covering 24 epics.
Churn columns are `git diff --numstat <base> <rev> -- <file>`; "cells" are live freeze entries naming the file.

**How to read a row.** A cited file changing upstream does not by itself falsify a cell — it means the recorded observation must be re-judged against the new tree. The action column says what that judgement needs.

> **Prerequisite for every snapshot-bearing step:** the six event dispositions from preflight-A §1.2 must land first, or no recording of ours migrates at all. And `snapshots/{sdk,acp}` execute built `lib/` (BLOCKED-245) — rebuild before running those lanes.

---

## Execution DAG

Topologically ordered. Every constraint scattered through the tables below is hoisted here as an explicit prerequisite, so this section alone is runnable.

**Reading rule.** A step is done when its *acceptance* holds, not when its edit compiles. Steps marked **OBSERVE** are ones where a clean merge is explicitly NOT acceptance — the assertion's subject moved, so it must be re-run and seen to pass.

```
S0a ─┐                          (user decisions, parallel to everything until their consumers)
S0b ─┤
     ├─> S1 ─> S2 ─> S3 ─> S4 ──┬─> S5(A) ──┐
S0c ─┘         │                ├─> S6(B) ──┤
               │                └─> S7(C) ──┴─> S9(P9 re-judge) ──┐
               │                                                  ├─> S10(P9 re-record)
               └─> S8b(align verify-p9-cells selector) ───────────┘
     S8(six dispositions) ─────────────────> S11(P0-06.F)
                                             S12(D, docs) ── independent, any time after S1
```

| step | what | prerequisites | output | acceptance |
|---|---|---|---|---|
| **S0a** | **USER:** P4-06 session-log atomicity — upstream deleted the `enqueueAll` layer and `SessionHandle.append` does not promise per-append crash atomicity. Options: upstream contract gains the guarantee, or the limb lands on an owned wrapper. | — | a ruling | Recorded in §9. **Must not be recorded as a relocation to `append`/`flush`** — the contract says they are not equivalent. Blocks S7's `write-behind` pair only. |
| **S0b** | **USER:** P1-03 per-bundle `unlockedProfilePolicy` value for each shipped bundle. | — | a ruling | Recorded. Note `warn-and-proceed` everywhere makes must[2] wired-but-inert on stock profiles. Blocks the P1-03 half of S5. |
| **S0c** | **USER:** whether our emitters adopt upstream's new vocabulary (`:code:`→`:ptc:`, `tool/code-dispatch`, `tools-code-mode` — 14 / 23 / 2 files). | — | a ruling | If yes, 13 `code-mode` case titles need `frozen-title-renames` entries. **A choice, not a merge consequence** — the merge does not force it. |
| **S1** | Perform the re-anchor onto `c291e7961a`. | 11″ and candidate 12 landed | merged tree | All Group A/B conflicts resolved. Measured: upstream deleted **zero** top-level exports across the five HIGH files, so these are textual, not semantic. |
| **S2** | Group C adjudications: record `core/agent/src/inbox.ts` → `core/agent-loop/src/inbox.ts`, class `Inbox` → `ReactLoopInbox`, in `adjudication.json`. | S1 | adjudication entries | `verify-baseline-file-references` green. **Before any 4.4 on P4-05 / P5-11** — 4.4a has nothing to resolve until the path exists. |
| **S3** | Repair the relocated manifest types: `DshBundleManifest`, `DshProfileManifest`, `ProfilePatchReload` move to `@deepseek-ai/dsh-package-manifest`; **`DshManifestSection` → `DshManifest`** (rename + superset, not a deletion). Consumers are exactly 2 files: `app-boot/src/profile.ts`, `app-boot/src/index.ts`. | S1 | imports fixed | Both files compile against the new package. |
| **S4** | Generated artifacts, **in this order**: merge `scripts/gen-cordis-catalog.ts` **first**, then regenerate `tool-cordis/src/api-catalog.ts` and `docs/persistence-catalog.md`. | S3 | regenerated artifacts | `verify-cordis-catalog` green. **Never hand-merge these two** — regenerate. Reversing the order wastes a pass. |
| **S5** | **Group A re-observation** — P0-05.U, P1-01.U, P1-03.U.1, P1-08.U, P2-01.U.1, P4-08.U.2. Re-run each frozen argv; re-verify **4.4a** + **4.4d**. | S4; P1-03's half also S0b | green cells | Each cell's argv re-run at the new tree. P1-03's `unlockedProfilePolicy` declared on the **post-anchor** manifest shape (upstream's `DshManifest` carries `manifestVersion?`). |
| **S6** | **Group B re-observation.** Includes: `ptc.ts` value updates in **only 2 specs** (`ptc.spec.ts`, `approval-code-mode.spec.ts`) affecting **only 4 of its 10 cells** — P2-03.U.1, P2-03.U.3, P4-12.U.1, P2-06.F. | S4; S0c if vocabulary changes | green cells | **OBSERVE** for the `continuation.spec.ts` `LEASE EPOCH` case: after re-landing it onto the relocated `continuation-activation.ts`, re-run it and confirm it observes a settlement notice **actually carrying the epoch**. A merge that compiles can still be observing nothing. |
| **S7** | **Group C re-observation** — P4-06.U.3 (3 cases re-observe, 1 re-wire), P4-06.U.4 (re-observe), P5-10.U.1. The `write-behind` pair waits on S0a. | S2; `write-behind` also S0a | green cells / a recorded gap | P4-06's must[0] limb is **not** at risk — `message-bus/*` is kind `N` and `packages/run/` does not exist upstream. |
| **S8** | **The six dispositions.** Give `run/task-profile`, `identity/attached`, `action/manifest-appended`, `action/risk-gated`, `action/world-bound`, `job/abandoned` a v2→v3 disposition. **Until this exists no recording of ours migrates at all.** Then migrate the recordings; **rebuild `lib/` before the `snapshots/{sdk,acp}` lanes** (BLOCKED-245 — they execute built output, not src). | S1 | migrating snapshots | The migration chain stops throwing `SessionFormatUnsupportedMigrationError`. Note the chain already handles the event renames — that is what its retained old vocabulary is for. |
| **S8b** | **Align `verify-p9-cells`'s stage selection to the live-set form** (BLOCKED-248): it currently picks a cell's entry with `filter(...).at(-1)`, which neither skips `supersededBy` nor distinguishes a supplement. Bring it to the **same shape as `verify-cells-recomputable`'s `liveFreezeByStage`** — a stage's live evidence is the full live set, primary plus un-superseded supplements. Owner: lane B (lane A does not touch that file). | S1 | aligned selector | **Must be in place BEFORE S10.** Harmless today only because no P9 entry carries `supersededBy` or `supplementSeq`; the P9 re-record at S10 is the first thing that creates them, so an unaligned `.at(-1)` could select the wrong entry at exactly that moment. Verify with a genuinely superseded P9 entry once one exists — a real mutation, not a synthetic one. |
| **S9** | **P9 re-judge** — P9-03, P9-05, P9-06, P9-07 cells against the re-anchored tree. | S5, S6, S7 | judged cells | `verify-p9-cells` will report these **STALE by design** from S1 onward. **Do not patch back to green.** |
| **S10** | **P9 re-record** — re-record `p9-verification.json` from an observation of the re-anchored tree, via the tool's recording form. | **S8b**, S9 | new recording | **Never before S9**, and **never before S8b**: recording against an unsettled tree pins the wrong observation, and recording through an unaligned selector pins it against the wrong freeze entry. |
| **S11** | **P0-06.F** — its 3 cases replay `snapshots/web/fresh-round-trip`, `snapshots/sdk/text-turn`, `snapshots/session/skill-load`, all three conflicting as `session.v2.jsonl` renames. | **S8** | judged cell | **Re-read the case text at this point**: they assert a *pre-schema-registry* fixture replays with no negotiation, and a migrated v3 fixture may no longer answer to that description. That judgement is not available before S8. |
| **S12** | **Group D** — prose merges for `docs/testing.md`, the two `README.zh.md`, the two `.i18n.yaml`. | S1 | merged prose | No 4.4. Bilingual pairs stay **HELD** under BLOCKED-124 — `dsh-translate-docs` is user-invocation-only; re-recording pair state instead would tell the gate the two sides agree when they do not. |

**Parallelism.** S5, S6, S7 are mutually independent given S4/S2. S8 is independent of S5–S7 and can run alongside them; only S11 and the snapshot lanes wait on it. S12 can run any time after S1.

**Two orthogonal sets, and a file can be in both (delegate ruling, 2026-09-13).** *Composable* is not *needs no re-verification*, and conflating them would drop half the work.

- The **merge set** (12 files, line-level classification below) answers *will git need a person to resolve this?* It is discharged inside S5/S6 by resolving the merge.
- The **re-verification set** (lane B's 4.4d reachability list) answers *did upstream change the production code this clause reaches?* It is discharged by re-running 4.4a–d.

`agent.ts`, `runtime-context.ts` and `ptc.ts` sit in the second and not the first: their merges compose cleanly — measured — **and** upstream substantially rewrote the production code around them, so their epics still need re-verification. A file merging without a conflict says nothing about whether the clause it carries still reaches what it claims.

**Standing invariant (delegate ruling, addendum 327).** Any tool answering *"what is this stage's live evidence?"* takes the **full live set** — primary plus un-superseded supplements — in the shape of `verify-cells-recomputable`'s `liveFreezeByStage`. Two tools already diverged on this question in opposite directions; the rule exists so a third does not invent a fourth answer.

**The three places where "it merged" is not acceptance:** S6's `LEASE EPOCH` case, S9/S10's P9 STALE (a red that means *re-record*, not *fix*), and S11's P0-06.F case text.


---

## Line-level conflict classification (all 30 cited files)

Measured 2026-09-13 by intersecting the baseline lines each side **modifies or deletes** (pure insertions excluded — two independent insertions at one anchor compose). **12 files have at least one line both sides change; 18 are composable.**

*Instrument note: two earlier forms of this measurement were wrong and are recorded so the numbers are not re-derived from them. Comparing default `git diff` hunk ranges reported all 30 as conflicting — the three lines of context make changes four lines apart look adjacent. Comparing `-U0` ranges reported 27 — a pure insertion has an empty old-range and was being charged to its anchor line. The form used here agrees with three independent manual deep-dives (`agent.ts`, `runtime-context.ts`, `continuation.ts`), which is why it is trusted.*

| file | shared lines | what each side did | verdict |
|---|---|---|---|
| `apps/cli/src/profile-boot.ts` | 2 (14, 210) | **L14** `node:fs` import: ours adds `existsSync, readFileSync`, upstream adds `existsSync, mkdirSync, rmSync`. **L210** `composeProfile`: ours adds 3rd param `production: boolean`, upstream adds 3rd param `fromDefaultProfile?: string`. | L14 → **union** (either side alone drops symbols). L210 → **REAL SEMANTIC CONFLICT**: one positional slot, two meanings, and both sides changed the body. The merged signature must hold both (4th param or an options object). **OBSERVE.** **Owner: P1-01, not P1-03** — the declaration's own JSDoc reads *"Epic P1-01.U's real pre-mount plugin admission (must[3]/acceptance[0])"* and `@param production - whether this boot enforces production plugin admission`. The variable at the call site is named `pluginEnforcement`, which reads like P1-03's plugin lock and is not: P1-03.U2's wiring is a different function, `enforceProfileLock` → `resolveUnlockedProfilePolicy`, which never touches this signature. So this is a **live re-anchor conflict on P1-01's parameter**, blocking the boot-surface 4.4d re-verification for the epics that share this file — not something the deferred P1-03.U2 work carries. Resolving it is a **merge decision for the author/delegate** (hold both: a 4th parameter or an options object), not a user decision. |
| `packages/subagent/subagent/src/continuation.ts` | 13 | upstream split ~1300 lines into `continuation-activation.ts` et al.; ours extended settlement/epoch handling | already adjudicated: **2 cells re-observe, 1 case re-wires**. **OBSERVE** (see the S6 row). |
| `packages/core/agent/src/inbox.ts` | 8 | upstream **deleted the file**; every line we changed collides with the deletion | resolved by the **S2 adjudication** → `core/agent-loop/src/inbox.ts`, `Inbox` → `ReactLoopInbox`. Not a merge decision. |
| `docs/persistence-catalog.md` | 15 | both regenerated a generated catalog | **moot — regenerate, never hand-merge** (S4). The largest raw conflict in the set dissolves entirely. |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 2 | same, generated | **moot — regenerate** (S4, after its generator merges). |
| `packages/subagent/subagent/src/index.ts` | 1 (448) | upstream renames `queueSubagentPrompt` → `deliverSubagentPrompt`; our change rewrites the same `return {` block | **real but small**: our call must adopt the new name. Re-run P4-06.U.4 / P5-10.F/U after. |
| `packages/bundle/headless/tests/headless.spec.ts` | 1 (6) | import line: ours adds `AgentOptions`; upstream drops `Inbox` and adds `AssistantStreamFrame` | **union minus `Inbox`** — taking our side alone re-imports a symbol upstream deleted. |
| `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` | 2 (7, 8) | import block: ours adds `SchemaCompatibilityError` + `decodeStorageRecord`; upstream reworks `node:path` | **union**. Confirms §2.8's finding that the two sides' work here is unrelated. |
| `packages/session/session-persistence/src/write-behind.ts` | 1 (47) | upstream **deleted the layer**; ours is `enqueueAll` | **not a merge decision — user decision D1/S0a.** |
| `packages/bundle/headless/README.zh.md` | 1 (64) | both rewrote the same sentence: ours describes model-route resolution, upstream keeps the `agentDefaultModel` link | **real prose choice**, and its English pair is under the BLOCKED-124 hold. Needs an author, not a merge rule. |
| `packages/bundle/headless/README.i18n.yaml` | 2 (5, 6) | both re-recorded the pair's blob hashes | **mechanical** — re-record after the prose above settles. |
| `packages/core/agent-loop/README.i18n.yaml` | 2 (5, 6) | same | **mechanical** — re-record. |

**Reading.** Of 12, only **three** need a decision rather than a rule: `profile-boot.ts` L210 (signature), `README.zh.md` L64 (prose), and `write-behind.ts` (already D1). Two dissolve as generated artifacts, one is already an adjudication, and the rest are unions or re-records.

---

## Group A — mount / boot surface (do first)

| pri | file | up | ours | cells | action after re-anchor |
|---|---|---|---|---|---|
| MEDIUM | `apps/cli/src/profile-boot.ts` | +91/-6 | +413/-6 | 4 — P0-05.U, P1-01.U, P1-03.U.1, P1-08.U | **ADJUDICATED 2026-09-13 — host intact, re-observe.** 307 (base) → 392 (upstream) lines; upstream deleted **no** top-level declaration and added one (`initializeProfileFromDefault`), so all 413 of our lines attach to surviving code. Textual merge + import fixes for the relocated manifest types, then re-run each cell's argv and re-verify **4.4a**/**4.4d**. `http-proxy` is newly wired here upstream. |
| MEDIUM | `packages/boot/app-boot/src/profile.ts` | +47/-60 | +185/-0 | 2 — P1-01.U, P1-08.U | **ADJUDICATED 2026-09-13 — relocation + rename, re-observe.** Upstream moved 4 exported types out to `@deepseek-ai/dsh-package-manifest` (861 → 848 lines). Three keep their names (`DshBundleManifest`, `DshProfileManifest`, `ProfilePatchReload`). **`DshManifestSection` is RENAMED to `DshManifest`**, not deleted — upstream `package-manifest/src/types.ts:28` carries the same two members with byte-identical JSDoc plus `manifestVersion?` and `client?`. (Corrects this row's earlier "no upstream home".) Consumers in our tree are exactly 2 files (this + `app-boot/src/index.ts`); fix their imports, then re-run both cells. |
| MEDIUM | `packages/boot/app-boot/src/index.ts` | +32/-16 | +23/-1 | 1 — P2-01.U.1 | Second of the two manifest-type consumers; fix imports with the row above, then re-run P2-01.U.1's argv. |
| MEDIUM | `packages/bundle/base/package.json` | +2/-2 | +34/-8 | 2 — P1-03.U.1, P4-01.U | Small upstream edit. **This is where P1-03's `unlockedProfilePolicy` must be declared — on the post-anchor manifest shape, not today's.** Blocked on the user's per-bundle decision. |
| LOW | `packages/workflow/workflow-worker-thread/package.json` | +3/-2 | +29/-2 | 1 — P4-08.U.2 | Manifest merge; re-run the argv to confirm the cell still holds. |

## Group B — agent-loop / identity surface

| pri | file | up | ours | cells | action after re-anchor |
|---|---|---|---|---|---|
| MEDIUM | `packages/core/tools/src/ptc.ts` | +4/-4 | +258/-0 | 10 cited, **4 affected** | **ADJUDICATED 2026-09-13 — host untouched, re-observe 4 cells.** Upstream's file is **678 lines, exactly the baseline count, 9 declarations** — the 4 changed lines are renamed values in place, nothing moved or deleted, and our +258 (incl. `appendCodeModeManifest`) attaches to unchanged code. The renames: `:code:`→`:ptc:`, `tool/code-dispatch`→`tool/ptc-dispatch`, `…-start` likewise, `tools-code-mode`→`tools-ptc`. **Only 4 of the 10 cells run a spec asserting those values: P2-03.U.1, P2-03.U.3, P4-12.U.1 (via `tests/ptc.spec.ts`) and P2-06.F (via `approval-code-mode.spec.ts`).** The other six — P2-03.U.2, P2-03.U.4, P2-04.U, P2-05.U, P2-05.U.1, P3-01.U — cite the file in `files[]` only and need no value update. NOT a title issue: 0 of 81 case titles carry a renamed token. |
| MEDIUM | `packages/subagent/subagent/src/continuation.ts` | **+218/-1299** | +292/-16 | 3 — P2-02.U, P4-06.U.3, P4-06.U.4 | **ADJUDICATED 2026-09-13 — not a rewrite, a SPLIT.** Upstream moved ~1300 lines into new `catalog.ts` / `continuation-activation.ts` / `continuation-messages.ts` / `inbox.ts`; the settlement+epoch machinery now lives in **`continuation-activation.ts`** (settle 27 / epoch 6 / Settlement 11) — upstream's own `subagent/src/inbox.ts` holds none of it. Per cell: **P2-02.U → re-observe** (all 4 argv specs are ours-only, absent upstream; this file is in `files[]` only). **P4-06.U.4 → re-observe** (its argv spec, `settlement-outbox.ts` and `message-bus/src/plugin.ts` exist at neither baseline nor upstream). **P4-06.U.3 → 3 of 4 cases re-observe** (in our `core/agent/tests/arrival-dedup.spec.ts`, absent upstream); **the 4th, `LEASE EPOCH`, needs the integration point re-landed** onto `continuation-activation.ts`. Mechanism survives — this is re-wiring, not re-implementation. |
| MEDIUM | `packages/core/agent-loop/src/agent.ts` | +179/-105 | +65/-7 | 1 — P9-07.P | **MERGE PRE-RESOLVED 2026-09-13.** Hunk ranges compared on the baseline: ours `[4-9, 15-20, 25-30, 33-39, 70-75, 84-89, 103-108, 119-143, 218-224, 252-257, 326-331]`, upstream `[15-24, 27-39, 68-74, 81-89, 91-108, 248-254, 288-299, 338-456, 494-504, 519-545]` — **7 regions overlap, and every one composes.** **(a) Imports (15-20, 27-30, 33-39):** we add `ControlKind`, `IdentityContext`, and extend the `./runtime-context.ts` import with `lastAttachedIdentity, resolveSessionIdentity`; upstream drops `Inbox`/`BlockAssembler`/`SessionSeq` and adds `ReactLoopInbox`, `AssistantStreamAttempt`, and `SystemPromptProjection` **on a separate line** (upstream keeps its own `RuntimeContextProjection` import at line 36 and adds line 38). Different symbols throughout → union. **(b) Class fields (70-74, 84-89):** ours adds `turnsCompleted`, `spentUsd`, `identity`; upstream retypes `inbox`/`requestSurfaceGeneration` and adds `assistantStreamRevision`, `assistantAttemptCounter`, `systemPrompt`, `frozenMessages`. Disjoint field sets → keep both. **(c) Constructor (103-108):** ours adds identity resolution + `session.append('identity/attached', …)`; upstream restructures scope/inbox construction (`new ReactLoopInbox(this.ctx.sessionProjections, …)`, `this.ctx = this.scope.ctx`, `new SystemPromptProjection(session)`). Our statements read only `session` and `options.identity` — **not** `this.ctx`/`this.scope` — so they are order-independent of upstream's reordering. **(d) New methods (252-254):** ours adds the P9-07 budget check, upstream adds `toolsChanged`, at the same insertion point. Two different methods → keep both. **OBSERVE:** (c) is the one to re-run rather than eyeball — after the merge, confirm `identity/attached` is still emitted **exactly once at construction**. It is P2-01's evidence and it now sits in a constructor someone else reordered. |
| MEDIUM | `packages/core/agent-loop/src/runtime-context.ts` | +92/-9 | +97/-0 | 2 — P2-01.F, P2-01.U | **MERGE PRE-RESOLVED 2026-09-13 — only ONE region overlaps, and it is the import block.** Ours touches baseline `[5-10, 74-76]`; upstream touches `[1-12, 16-26, 33-41]`. Our 98-line addition lands after baseline line 74, **past everything upstream changed** — no contention at all. The single overlap is `1-12`: we add two `dsh-principal` imports (purely additive); upstream rewrites the module JSDoc and restructures existing import lines (adds `createSystemMessage`/`Message`/`SessionEvent`/`SurfaceIntent`/`SystemMessage`, moves `SessionSeq` to a type-only import). Different symbols → union. **One risk checked and cleared:** upstream making `SessionSeq` type-only would break a value call `SessionSeq(index)` — but that call is at baseline line 39, inside code **we never touched** and which upstream itself rewrote (its `33-41` hunk), and **our additions never mention `SessionSeq`**. Take upstream's version of that region. `lastAttachedIdentity` and `resolveSessionIdentity` are ours (0 hits upstream) and land in untouched space. P2-01 remains the heaviest epic of the group: its snapshot evidence and its `identity/attached` disposition are one work item. |
| MEDIUM | `packages/core/agent/src/runtime-types.ts` | +113/-7 | +22/-0 | 2 — P2-01.P, P9-07.P | Upstream grew it substantially; our change is small. Re-verify **4.4b**. |
| MEDIUM | `packages/subagent/subagent/src/index.ts` | +51/-27 | +113/-9 | 3 — P4-06.U.4, P5-10.F, P5-10.U | Re-run all three argvs; P5-10 is BLOCKED_ON_ACCEPTANCE, so its cells are re-judged but not signed. |
| MEDIUM | `packages/subagent/subagent/tests/control.spec.ts` | +28/-8 | +164/-0 | 2 — P5-10.F, P5-10.U | Test-side merge; ours dominates. |
| MEDIUM | `packages/subagent/subagent/tests/continuation.spec.ts` | +760/-186 | +107/-1 | 1 — P4-06.U.3 | **ADJUDICATED** — carries exactly ONE of U.3's four cases (`carries the child run's LEASE EPOCH…`, line 2055). The other three live in a spec upstream does not have. Re-land that one case against the relocated `continuation-activation.ts`, then **re-run it and confirm it observes a settlement notice actually carrying the epoch** — a clean textual merge is NOT acceptance here, because the assertion's subject moved file and a merge that compiles can still be observing nothing (delegate ruling, 2026-09-13). |
| MEDIUM | `packages/llm/token-meter/src/index.ts` | +40/-51 | +54/-0 | 1 — P9-05.P | Re-run P9-05.P's argv. |
| MEDIUM | `packages/workspace/workspace/src/paths.ts` | +43/-8 | +31/-2 | 1 — P1-07.P | Upstream hardened canonicalization (relative paths now rejected before `realpath`). P1-07 is NOT_RUN — re-judge, do not sign. |
| MEDIUM | `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` | **+1895/-966** | +197/-2 | 2 — P0-06.F, P0-06.U | **ADJUDICATED 2026-09-13 — NO overlap; the gap doc's framing is wrong here.** P0-06 is per-payload **`schemaVersion` major-compat negotiation**; upstream built **session-FORMAT versioning** (`SESSION_FORMAT_VERSION`, the v0→v3 chain). Different mechanisms. Upstream's `jsonl.spec.ts` contains **0** `schemaVersion` and **0** `negotiat`; upstream's only 9 `schemaVersion` files are `experimental/inspector` + `tool-cordis/api-catalog`, an unrelated Cordis-snapshot concept. **P0-06.U → re-observe** (its other two argv specs, `sdk/server` and `settings`, are untouched by this). **P0-06.F → re-observe, but GATED**: its 3 cases replay `snapshots/web/fresh-round-trip`, `snapshots/sdk/text-turn`, `snapshots/session/skill-load` — all three conflict as `session.v2.jsonl` renames, so F cannot be judged until the six dispositions land and those recordings migrate. Re-read the cases then: they assert a *pre-schema-registry* fixture replays with no negotiation, and a migrated v3 fixture may no longer satisfy that description. |
| MEDIUM | `packages/extensions/tool-cordis/src/api-catalog.ts` | +538/-202 | +1411/-33 | 2 — P1-09.U, P9-07.P | Generated artifact. **Regenerate, do not hand-merge** (`scripts/gen-cordis-catalog.ts`). |
| MEDIUM | `scripts/gen-cordis-catalog.ts` | +49/-5 | +109/-0 | 1 — P1-09.U | The generator for the row above; merge this first, then regenerate. |
| LOW | `packages/core/agent-loop/package.json` | +2/-1 | +13/-2 | 1 — P9-07.C | Manifest merge. |

## Group C — failed paths (adjudication BEFORE any 4.4)

| pri | file | up | ours | cells | action after re-anchor |
|---|---|---|---|---|---|
| **HIGH** | `packages/core/agent/src/inbox.ts` | **deleted** (+0/-220) | +137/-8 | 2 — P4-06.U.3, P5-10.U.1 | **Successor exists:** `packages/core/agent-loop/src/inbox.ts`, class `Inbox` → `ReactLoopInbox implements InboxContract`. Record a path+rename adjudication, then re-run both argvs. Mechanically resolvable. |
| **HIGH** | `packages/session/session-persistence/src/write-behind.ts` | **deleted** (+0/-159) | +25/-1 | 1 — P4-06.P | **No successor.** `SessionWriteBehind`/`SessionWriteBehindOptions` have 0 hits in the entire upstream tree; our caller `coordinator.ts` is also gone; the file existed at the fork baseline, so upstream *removed the layer*. Our +25 is `enqueueAll`, the one-durable-batch guarantee behind must[0]'s no-orphan property. **Upstream's `SessionHandle.append` explicitly does not promise it** ("Persistence is best-effort… only a resolved `flush` promises it survives a crash"). → **user decision, queued; do NOT record a relocation to `append`/`flush` as equivalent.** |
| **HIGH** | `packages/session/session-persistence/tests/write-behind.spec.ts` | **deleted** (+0/-275) | +75/-0 | 1 — P4-06.P | Third gone-upstream file, not flagged in preflight-A §2.4 — it is the spec for the row above and shares its fate. Resolve with the user decision, not separately. |

**Note:** P4-06's *implementation* (`packages/run/message-bus/*`, kind `N`) is clean and `packages/run/` does not exist upstream, so must[0]'s SQLite-transaction limb is not at risk. Only the session-log limb above is.

## Group P9 — explicit re-verification (ledger status does not exempt these)

Four P9 epics hold live freeze entries citing conflicting files. Their rows carry no ACCEPTED/NOT_RUN status readable from `ledger.json`, so each needs an explicit `--report` pass rather than an inferred one.

| pri | epic | cited conflicting files | cells |
|---|---|---|---|
| **HIGH** | **P9-07** | `agent-loop/src/agent.ts`, `agent-loop/README.i18n.yaml`, `agent-loop/package.json`, `core/agent/src/runtime-types.ts`, `tool-cordis/src/api-catalog.ts`, `docs/persistence-catalog.md` | P9-07.C, P9-07.P, P9-07.F, P9-07.U |
| **HIGH** | **P9-06** | `bundle/headless/package.json`, `bundle/headless/tests/headless.spec.ts`, `bundle/headless/README.zh.md`, `README.i18n.yaml` | P9-06.C, P9-06.P, P9-06.F, P9-06.U |
| MEDIUM | P9-03 | `bundle/headless/tests/headless.spec.ts`, `README.zh.md`, `README.i18n.yaml` | P9-03.P |
| MEDIUM | P9-05 | `llm/token-meter/src/index.ts` | P9-05.P |

`packages/bundle/headless/tests/headless.spec.ts` is +130/-80 upstream against our +320/-13 — the heaviest P9 row, carrying P9-03.P and both P9-06 F/P.

**A pre-existing flake sits in this group, so do not read it as re-anchor damage.** `snapshots/session/headless.snapshot.ts` is the only conflicting snapshot path any live freeze entry cites (P9-06.P), and it is the harness driver rather than a recording. It **already fails intermittently before the re-anchor** — it was one of two reds on candidate 12's first run, on a tree whose diff touched no `packages/`, `apps/` or `snapshots/` path at all. If the P9 re-record at S9/S10 meets the same flake, that is this pre-existing behaviour and not something the re-anchor caused. Re-run before attributing it; a red here needs the same second reading any intermittent does.

**That file carries three identities at once, and a single red has three readings with three different repairs** — the full disambiguation order is in `base-align-v3-preflight.md`'s S9/S10 section, which the delegate names aloud when dispatching this step. In short: **(1)** a flake → re-run and take the second reading; **(2)** the re-anchor broke the harness path → fix the merge or the wiring; **(3)** P9-06.P's subject relocated, i.e. STALE-by-design → re-record per S8b/S10 and **do not touch the tree**. Read them in that order: re-run first to rule out (1), and only then read the diff to tell a broken path from a legitimately relocated subject.

**MANDATORY STEP, added 2026-09-13 on lane B's report.** `first100:verify-p9-cells --check` fails when any file named by a P9 freeze entry (its `files` plus the argv test paths) differs between the recorded candidate and HEAD. Every file in this group's table is such a file, so the moment BASE-ALIGN lands, **all four P9 epics report STALE by design**. That is not a regression and must not be patched back to green: **P9 has to be re-recorded from an observation of the re-anchored tree**, using the tool's recording form, after the four epics' cells have been re-judged. Sequence it AFTER Groups A–C, never before — re-recording against an unsettled tree would pin the wrong observation.

## Group D — documentation only (last, no 4.4)

| pri | file | up | ours | cells | action |
|---|---|---|---|---|---|
| LOW | `docs/persistence-catalog.md` | +162/-79 | +391/-24 | 1 — P9-07.F | Generated catalog — regenerate rather than merge. |
| LOW | `docs/testing.md` | +5/-4 | +13/-5 | 1 — P0-07.U | Prose merge. |
| LOW | `packages/bundle/headless/README.zh.md` | +14/-14 | +14/-1 | 2 — P9-03.P, P9-06.U | Prose; bilingual pair — see the translation hold (BLOCKED-124), user-gated. |
| LOW | `packages/host/plugin-inventory/README.zh.md` | +7/-7 | +13/-3 | 1 — P1-09.U | As above. |
| LOW | `packages/core/agent-loop/README.i18n.yaml` | +2/-2 | +2/-2 | 2 — P9-07.F, P9-07.U | Pair record. |
| LOW | `packages/bundle/headless/README.i18n.yaml` | +2/-2 | +2/-2 | 2 — P9-03.P, P9-06.U | Pair record. |

---

## Totals

| group | files | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| A mount/boot | 5 | 2 | 2 | 1 |
| B agent-loop/identity | 14 | 4 | 9 | 1 |
| C failed paths | 3 | 3 | — | — |
| D docs | 6 | — | — | 6 |
| **total** | **28 rows / 30 files** | **9** | **11** | **8** |

(`headless.spec.ts` and the two headless READMEs appear under both B/D and the P9 group; they are one merge each, listed twice because two groups depend on them.)

## Carried forward, unresolved

1. **P4-06 session-log atomicity** — user decision (Group C).
2. **P1-03 per-bundle `unlockedProfilePolicy`** — user decision; must be declared on the post-anchor manifest shape (Group A).
3. **The six event dispositions** — prerequisite to every snapshot step; not in this table because no frozen cell cites a conflicting snapshot except `headless.snapshot.ts` (P9-06.P, a harness driver).
4. **Whether our emitters adopt the new vocabulary** (`:code:` 14 files, `tool/code-dispatch` 23, `tools-code-mode` 2). A choice, not a merge consequence; if taken, 13 `code-mode` case titles need `frozen-title-renames` entries.
