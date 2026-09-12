# preFlight — P2-06 F (审批绑定完整规范化参数、资源与前置状态,Fault 阶段)

Written 2026-09-12 by lane B at `b31b4dc317`, branch `lane-b-p2-06`. Table first, same discipline as C, P and U: every row is a measurement or a declared decision, and rows marked **RULING** need settling rather than inferring. None of `preflight-P2-06.md`, `-C.md`, `-P.md` or `-U.md` is restated.

## What F owns, and the three things measuring for it turned up

`tests/first100/registry.json`'s `stages.F` names two files — `packages/interaction/user-approval/tests/approval.spec.ts` and `packages/interaction/user-approval/tests/argument-binding.spec.ts` — and the three validation clauses:

| item | text | state before F |
|---|---|---|
| validation[1] | 运行 TOCTOU、argument substitution、Unicode confusable、batch mutation 测试 | argument substitution closed at U; the other three have no case |
| validation[2] | 测试 code-mode 嵌套调用同样绑定 | **false today, and not for want of a test** — see F-1 |
| validation[3] | 审计查询能从 action 反查唯一 approval | **unanswerable today** — see F-3 |

Two of those three are not test gaps. Writing the cases the registry names would produce three reds that no test file can turn green, so F is a code stage wearing a test stage's file list. That is the first thing this page exists to say.

**The stage's second declared file does not exist.** `argument-binding.spec.ts` was never created, and neither was `src/preconditions.ts`, which the registry lists as a C-stage `[N]` file. C froze `tests/binding.spec.ts` instead and P froze `tests/binding-service.spec.ts`; both are real files with real cases, so nothing is vacuous, but the registry's names and the tree's names diverged at C and no gate noticed — `verify-freeze-in-candidate-tree` checks that a freeze entry's cited files exist, not that a stage's registry-named files do. **RULING 0:** F either creates `argument-binding.spec.ts` under its registry name or records the rename in `frozen-title-renames.json`'s sibling discipline. I lean to creating it under the registry name, because the alternative asks a reader to learn a mapping in order to find the evidence.

## F-1 — code-mode does not bind, and does not re-verify (validation[2], must[1])

Measured, not inferred. There are exactly two non-test callers of `gateActionRisk` in the tree:

| call site | binding | display | calls `verifyRecordedApproval` |
|---|---|---|---|
| `packages/core/agent-loop/src/tool-calls.ts:296` (native dispatch) | yes | yes | yes, `:320`, and a non-`valid` result refuses the dispatch |
| `packages/core/tools/src/ptc.ts:738` (code-mode sub-dispatch) | **no** | **no** | **never, on any line** |

The consequence is a bypass of exactly the kind must[1] names: an approval asked from inside a code-mode program is bound to nothing, and the arguments it was decided about are never compared with the arguments that run. Substituting arguments between the decision and the execution is refused on the native path and admitted on the other.

This is the same shape P2-05 already closed one layer down, and the contrast is what makes it a defect rather than an oversight: `ptc.ts` DOES reach `enforceManifestedAction`, and its own comment says "the SAME enforcement point the native path reaches … not a similar check written beside it". The policy question crossed to the second path; the binding did not follow it.

**RULING 1 — F fixes this in `ptc.ts` and proves it at the tool.** Not "adds a case for it": there is nothing to be green. The assertion must be what the SUB-DISPATCHED tool observed — a code-mode program whose approval covered `one` and that dispatches `two` must leave the tool unrun — because a case asserting the verifier was reached passes equally when its result is computed and dropped, which is the mutation that reddened U's cases.

**What F must NOT do while fixing it:** build a second `approvalBindingFor`. Two derivations of "what this approval covers" is the duplication least affordable here, and a code-mode binding that spells the tuple differently from the native one would give one action two digests depending on which path took it.

## F-2 — `preconditions` is bound but never observed (acceptance[0] third limb, validation[1] TOCTOU)

`ApprovalBindingInputs.preconditions` is in the digested tuple, so a change to it moves the digest. **Both production paths pass `[]`:** `tool-calls.ts:614` and `:719` on the native side, `ptc.ts:265` on the code-mode side. Nothing in the tree observes a file inode, an mtime, or a remote object version, and nothing re-reads one at execution time.

So acceptance[0] reads "审批后替换参数、切换账户、改变文件 inode/远端对象版本均不会执行" and the tree closes the first two limbs and not the third. The digest covering `preconditions` is true and empty: it is the BLOCKED-201 shape said about a field rather than a path — a field every producer leaves empty is a field the binding does not bind.

U's own JSDoc already says this out loud (`tool-calls.ts:595`), so it is a declared limitation and not a discovery. What F has to decide is whether a declared limitation is enough for an acceptance clause that names the mechanism explicitly.

**RULING 2 — I recommend F builds the narrow version and refuses the wide one.** The narrow version: for a tool whose manifest target is a filesystem path, record one precondition naming the path's inode/device pair at the ask, and re-`stat` it before the run. That is observable, local, has a real producer, and makes the third limb non-vacuous for the case the clause names first. The wide version — remote object versions, ETags, generation numbers — has no consumer in the tree: no tool reports one, so a field for it would be built for a caller that does not exist, and a green case over it would be seeded by its own test. Recommending is not deciding; the delegate should settle it, because it is the difference between the clause being closed and being declared open.

**If RULING 2 goes the other way** and F declares the whole limb open, then the clause's inode half needs an entry in `acceptance-coverage.json` saying what is NOT proven, and the sign-off cannot cite acceptance[0] whole.

## F-3 — the one-to-one reference has no field to travel on (acceptance[2], validation[3])

`approval/bound` carries `action: string`, and that string is the tool NAME (`'bash'`, `'write'`), not an `ActionId`. The manifest log's `ActionManifest` carries `actionId` and `argumentsHash`; the approval record carries neither.

Given an action in the audit log, a query cannot name its approval: two `bash` calls in one session record `action: 'bash'` twice, and nothing distinguishes them. U's frozen case *records ONE binding for one gated dispatch — counted, not merely present* proves the COUNT, which makes a one-to-one reference possible; it does not make one exist. Treating the count as the reference is a substituted subject, and this page is the place to say so before a sign-off cites the U case for validation[3].

**RULING 3 — the fix is one field, and it belongs to F rather than to a later epic.** Carry the dispatch's `ActionId` on `approval/bound`. It is available at both call sites (the native path holds `appended.record.manifest`, and `ptc.ts` holds `appended.manifest` at the same point), it is the id the audit query already has in hand, and adding it is smaller than any query-side workaround. The alternative — deriving the link from event ordering — is the failure P2-06's own P stage already rejected once: ordering cannot distinguish bind-at-ask from bind-after-answerer, and it cannot distinguish two calls to one tool either.

## The fault matrix

Organised around **what a substitution changes**, not around a list of attacks, because the defect to avoid is a dimension of the bound tuple that no case ever moves. Rows 1–3 are frozen at C or U and are here only to say they are not F's to re-prove.

| # | fault | how it is induced | expected | what distinguishes it from its neighbours |
|---|---|---|---|---|
| 1 | argument substitution | bind `one`, dispatch `two` | refused, `field: 'arguments'`, tool unrun | frozen at U on the native path; F's version is the **code-mode** one (F-1) |
| 2 | account switch | bind as alice, dispatch as bob | refused, `field: 'principal'` | frozen at U |
| 3 | lapsed decision | clock past `expiresAtMs` | refused, `reason: 'expired'` | frozen at U; distinct from 1–2 because the operator action differs — ask again vs investigate |
| 4 | **Unicode confusable** | two argument strings whose characters render alike but differ in code points: NFC vs NFD spellings of one name, and a Cyrillic `а` for a Latin `a` | **different digests, so the second is refused** | this row passes BECAUSE the canonical form does not normalize. JCS preserves normalization form deliberately (`action-manifest/src/canonicalize.ts:40`, corrected 2026-09-06 after NFC folding let one hash cover two filenames). F asserts the refusal, and the case is a regression guard on that correction as much as on this epic |
| 5 | **value-domain collision** | bind `{amount: null}`, dispatch `{amount: Infinity}` | **admitted today — they canonicalize identically** | the honest row. P2-03 records the collision; P2-06 is where it becomes "approving one approves the other". Unreachable on the native path (a model emits JSON, which has no `Infinity` literal) and reachable on the code-mode path, which passes a real JS value — so this row **only exists once F-1 lands**, and it is the reason F-1's fix must not stop at "a binding is present" |
| 6 | **batch mutation** | one assistant message carrying two calls to the SAME tool with different arguments; approve the first | the second is refused, and the first still runs | the row U's *ignores a binding for a DIFFERENT action* does not reach: that case separates two tool NAMES. Same-name is the harder case, and it is the one a real batch produces |
| 7 | **TOCTOU on the resource** | approve a write to a path; replace the file at that path between the decision and the run | refused | contingent on RULING 2. If the narrow version is built, this row asserts the inode comparison; if the limb is declared open, this row does not exist and `acceptance-coverage.json` says why |

Row 6 needs one thing stated before it is written: the refusal must be observed **at the tool**, and the first call must be observed to RUN. A batch case that only asserts "one refusal happened" passes when the path refuses both, which is the same failure mode as a dispatch path that refused everything passing both of U's refusal cases — the reason U carries a positive control.

## What this page does NOT settle

1. **RULING 0** (create `argument-binding.spec.ts` under its registry name, vs record the divergence), **RULING 1** (F is a code stage: `ptc.ts` gains the binding and the re-verification), **RULING 2** (narrow inode preconditions vs declaring the limb open), **RULING 3** (`ActionId` on `approval/bound`).
2. **Whether fixing F-1 re-opens the U freeze.** It does not change any frozen case, but it adds a second production caller to a clause U froze against one, and the delegate has ruled before that a clause's subject is what the freeze names. I read it as an F supplement rather than a U re-freeze, and I am not acting on that reading until it is confirmed.
3. **Whether `preconditions: readonly string[]` is the right type** if RULING 2 goes narrow. An inode/device pair in a string is a structured fact flattened into prose, and the binding would compare spellings. Changing the type touches C's frozen `canonical.ts` projection, which is the reason to decide it here rather than mid-implementation.
