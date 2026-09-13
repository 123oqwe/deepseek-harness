# BASE-ALIGN-v3 — confirmation package

One document to decide from. Assembled 2026-09-13 by lane A from measurements taken on `2ff333e393`; the delegate's spec (`base-align-v3-preflight.md`) and the executable checklist (`base-align-reverify-checklist.md`) remain the authorities, and this reproduces their decision-bearing content without the timeline.

**What is proposed.** Re-anchor `first100-exec` from fork point `4e84901e64` onto upstream master `c291e7961a` — 1637 commits — after candidates 11″/12 and P4-12 land, before new P6/P7 work begins.

**Provenance note.** Sections 2, 4 and 6, and decisions **D1–D3**, are lane A measurements, each re-derivable from the commands named in the source documents. **D4, D5 and D6** are the delegate's items — D5 and D6 summarised from `BLOCKED-QUEUE.md` — and lane A took no measurement that decides them; each is marked where it appears. Sections 1 and 5 are the delegate's rulings on process.

---

## 1. The iron rule this whole plan serves

**A clause's landing point may move. The functionality may not shrink.** (Delegate ruling, addendum 321.)

Concretely, three outcomes are permitted when upstream has moved our ground, and one is not:

| upstream did | we do |
|---|---|
| moved the code | record the successor path, re-observe |
| renamed the values | update what our assertions compare, re-observe |
| genuinely deleted the capability | **escalate to you** — the clause is not quietly dropped |
| — | **never**: withdraw a clause because upstream removed its host |

Exactly one item in the whole re-anchor hits the third row. It is decision **D1** below.

---

## 2. What the measurement found, in one paragraph

The re-anchor is **far less dangerous than it first looked**. 145 snapshot files and 114 code files conflict. Of the code conflicts, 30 are cited by live freeze entries across 24 epics. Every one of the five highest-risk files was read for survival, and **upstream deleted zero top-level exports across all five** — what looked like rewrites are relocations and in-place renames. Three declared paths do disappear: `core/agent/src/inbox.ts` has a successor, while `session-persistence/src/write-behind.ts` and its spec have none — upstream removed that layer outright. The single genuine capability loss is D1.

---

## 3. Decisions that need you

Each carries a recommendation and what happens if you say nothing.

### D1 — P4-06 session-log atomicity *(the only real capability gap)*

**What happened.** Our `write-behind.ts` carries `enqueueAll(events)`, which guarantees a domain event and its derived outbox row land in **one durable batch**. That is the session-log half of P4-06 must[0]'s no-orphan property. Upstream **deleted that layer entirely** — `SessionWriteBehind` has 0 hits in the whole upstream tree, and its caller `coordinator.ts` is gone too.

**Why the obvious substitute does not work.** Upstream's replacement, `SessionHandle.append(events[])`, says in its own contract: *"Persistence is best-effort… only a resolved `flush` promises it survives a crash."* Nothing states that one `append` call's events are crash-atomic with each other, and `read`'s *"a torn physical tail is never returned"* implies the log can tear with recovery truncating to a prefix — a cut between the event and its outbox row is exactly the orphan must[0] forbids.

**Recommendation:** land P4-06's session-log limb on **an owned wrapper that states the guarantee**, rather than adopting `append`/`flush` as equivalent.
**Default if you don't answer:** the limb is recorded as an **open gap** against P4-06 and the epic is not re-signed. Nothing is silently dropped, and nothing false is recorded.
**What must not happen either way:** recording a relocation to `append`/`flush` as equivalent. The contract says it is not.

**Scope reassurance:** P4-06's must[0] *SQLite-transaction* limb is **not** at risk. It lives in `packages/run/message-bus/`, which upstream does not have at all.

### D2 — P1-03 per-bundle `unlockedProfilePolicy`

**What happened.** P1-03 must[2] says a production boot loads only lock-approved plugins. Wiring the gate into a real boot (done) requires every shipped bundle to declare a policy for the unlocked case — and **no bundle in the repository declares one**, so every boot currently throws. The field was specified by BLOCKED-094 and never landed.

**The trap.** Declaring `warn-and-proceed` everywhere makes every boot proceed, because stock profiles have no lock until an operator runs `dsh plugin`. must[2] would read as enforced while **refusing nothing on any profile in existence** — which BLOCKED-094's own note names as the unsafe reading.

**Recommendation:** `refuse` for `base` and operator-facing profiles (`dsh plugin` can generate a lock, so this is not a suicide setting); `warn-and-proceed` for test/minimal profiles, with the reason written down.
**Default if you don't answer:** P1-03.U2 stays parked and P1-03 is not re-signed. No value is chosen on your behalf.
**Timing note:** whatever the value, it must be declared on the **post-anchor** manifest shape — upstream moved these types into a new package and added `manifestVersion?`.

### D3 — do our emitters adopt upstream's new vocabulary?

**What happened.** Upstream renamed, in live code: sub-call id `:code:` → `:ptc:`, `tool/code-dispatch` → `tool/ptc-dispatch`, plugin source `tools-code-mode` → `tools-ptc`. Our tree uses the old names in 14 / 23 / 2 files respectively.

**This is a choice, not a consequence.** The merge does not force it: upstream keeps the old names inside its format-migration chain precisely so old logs stay readable, and our recordings are such logs.

**Recommendation:** adopt the new vocabulary in the same pass, so we do not carry a second dialect indefinitely.
**Default if you don't answer:** keep our names; nothing breaks.
**Cost if adopted:** 13 frozen case titles containing `code-mode` need `frozen-title-renames` entries.

### D4 — P1-01 `manifestVersion` *(delegate's item, lane A input)*

Upstream's `DshManifest` carries `manifestVersion?: 1`, a field our manifests do not have. Lane A's input is only the fact of it; whether P1-01 adopts it is the delegate's proposal.
**Recommendation (delegate's):** declare per-bundle values on the upstream shape, including the field.
**Default:** ignore the optional field; it is optional upstream too.

### D5 — P1-07 workspace-trust posture *(delegate's queue, relayed)*

Per `BLOCKED-QUEUE.md` BLOCKED-185: `workspace-trust-local` ships `disabled: true` in `bundle/base/cordis.patch.yml:351-353`, so `ctx.get('workspaceTrust')` is `undefined` on every profile a user starts, and P1-07's acceptance[0] does not hold on the product. The row's own comment gives the reason: enabled with no grants, **every** workspace becomes untrusted at once, breaking project skills and `AGENTS.md` for existing users.
**The decision:** ship it on with a first-time authorization flow, or keep it opt-in.
**Recommendation:** this is a product-posture call the delegate owns the framing of; lane A has no measurement that decides it.
**Default:** unchanged (opt-in), P1-07 stays revoked.
**Relation to the re-anchor:** upstream hardened `workspace/src/paths.ts` (+43/−8), which P1-07.P cites — so this decision and the re-anchor touch the same file, but the posture question is independent of the merge.

### D6 — P2-10 scope: who owns atomic settings writes *(framing by the delegate)*

**What was found.** P2-10's Usage stage observed that a settings-namespace write is a **truncating write, not an atomic one** — and that this affects **every settings namespace, not only policy**. Owner is `settings/settings`. It is recorded today by limb as a known limitation at `docs/policy/language.md:65`.

**The choice.**
**(a)** P2-10 U declares the limitation by limb and freezes current behaviour; "atomic writes across all settings namespaces" becomes a later epic under its real owner, `settings/settings`.
**(b)** P2-10 U's scope widens to fix atomic settings writes globally.

**Recommendation (delegate's): (a).** P2-10 is a policy-language epic; cross-namespace write atomicity is outside its boundary, and assigning it to the wrong owner lets that epic expand without limit. Stated as a recommendation, not a conclusion — it is a product/scope judgement.
**Default if you don't answer:** unchanged — recorded by limb, not re-signed.

*Lane A took no measurement here; the finding and the framing are the delegate's, relayed.*

---

## 4. Risk ledger (current values)

| priority | count | what |
|---|---|---|
| **HIGH** | **3** | the three failed paths only — `core/agent/src/inbox.ts` (successor exists), `session-persistence/src/write-behind.ts` + its spec (**no successor — D1**) |
| MEDIUM | 11 | textual merges with re-observation; the two real both-sides merges are `agent-loop/src/agent.ts` and `runtime-context.ts` |
| LOW | 8 | prose and manifests |

Started at 9 HIGH. Six were cleared by reading what survived, not by assumption:

| file | first read as | measured to be |
|---|---|---|
| `subagent/src/continuation.ts` | near-rewrite (+218/−1299) | **a split** — settlement machinery moved intact to `continuation-activation.ts`; 2 cells re-observe, 1 case re-wires |
| `session-persistence-jsonl/tests/jsonl.spec.ts` | possible collision with upstream's own version work | **no overlap** — P0-06 is per-payload `schemaVersion`; upstream built session-*format* versioning. Upstream's copy has 0 `schemaVersion`, 0 `negotiat` |
| `core/tools/src/ptc.ts` | 10 cells at risk | **4 cells** — host is byte-identical in size to baseline; only 2 specs assert the renamed values |
| `apps/cli/src/profile-boot.ts` | worst ratio in the tree | zero declarations deleted; one added |
| `app-boot/src/profile.ts` | `DshManifestSection` has no upstream home | **renamed to `DshManifest`**, same members, superset |
| `agent-loop/src/agent.ts`, `runtime-context.ts` | rewritten regions | zero exports deleted; both files grew |

**Snapshots.** 145 conflicts, but only **one** is cited by a live freeze entry (`headless.snapshot.ts`, a harness driver — an ordinary code conflict). The rest carry no frozen citation. The real snapshot blocker is mechanical: upstream's migration chain refuses six event types our fork added (`run/task-profile` alone is in 141 of 148 recordings), so **no recording migrates until six dispositions are written**. That is engineering work, not a decision.

---

## 5. Acceptance

The re-anchor is done when:

1. every step of the 13-step execution DAG has met its stated acceptance;
2. **the 16 ACCEPTED epics whose declared files conflict have had 4.4a–d re-run** — re-verified, *not* de-signed. Withdrawal is not an acceptable substitute for re-verification;
3. the 24 epics whose live freeze entries cite a conflicting file have had those observations re-judged against the new tree — a wider and differently-derived set than (2), overlapping it in 10; union 30;
4. P9 has been **re-recorded** from an observation of the re-anchored tree — its cells go STALE by design at re-anchor, and that red means *re-record*, never *patch green*;
5. no clause has been withdrawn on the grounds that upstream removed its host (§1).

**Three places where a passing merge is explicitly not acceptance**, called out because they are the ones a green would otherwise hide: the `LEASE EPOCH` case after re-wiring; P9's STALE reds; and P0-06.F's case text, which asserts a *pre-schema-registry* fixture and may no longer describe a migrated v3 one.

---

## 6. What is not yet measured

Stated so nothing here reads as more settled than it is.

- Whether each snapshot needs `refresh` or `record` — unanswerable until the six dispositions exist.
- Whether any frozen case *title* contains an old event name (the delegate is checking; an earlier lane B scan found none).
- The 114 code conflicts outside the 30 with frozen citations.
- Whether upstream's v3 replay path accepts our profiles at all — a separate question from migration.
- P2-03 / P3-01 membership in the re-verification set, and whether P9's ledger rows carry a status that changes their treatment.
