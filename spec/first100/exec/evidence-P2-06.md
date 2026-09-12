# Evidence package — P2-06 审批绑定完整规范化参数、资源与前置状态

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured on branch `lane-b-c7` at `e96764a0f6`, covering **all four stages**: C and P froze at `fb0ec2ea33` / `bae6f0e3fa`, U at `f4930c1250`, F at `7487e0e0bf`.

**The freeze is complete; the OBSERVATION is not.** `ledger.md` row 26 reads `NOT_RUN` in all four stage columns as this page is written. C, P and U ride candidate 6 (`50742193bf`) and F rides candidate 7. No cell on this page may be cited as GREEN until those runs land; what this page records is what the frozen cases assert and what they deliberately do not.

## Summary — what each clause can and cannot answer

| clause | verdict after C, P, U and F |
|---|---|
| must[0] the request references the manifest digest and shows redacted arguments, resource, risk, expected diff, validity | closed on both deciders: the six fields are built once at the only site holding the manifest and carried to the ACP payload and the Web card. **Not closed for code-mode asks** — see the open item below |
| must[1] re-verify digest, preconditions, capability token and policy version before execution | closed for digest and principal on BOTH dispatch paths. **`preconditions` is bound and never populated**; `capabilityToken` and `policyVersion` are deliberately absent rather than bound to a placeholder, with the reason in `approvalBindingFor`'s JSDoc |
| must[2] any field change invalidates the approval and produces a new request | closed at the decision function (C), against fields read back off the durable record (P), and at the real dispatch where the tool is observed not to run (U, F) |
| acceptance[0] substituted arguments / switched account / changed file inode or remote object version do not execute | **two limbs of three.** The third is declared OPEN in `acceptance-coverage.json`; see below |
| acceptance[1] sensitive values may display redacted while the hash covers the real canonical value | closed in three places: the digest separates two values that would display identically, the durable record carries no argument value yet still separates two, and the ACP payload carries the redacted string and never the raw one |
| acceptance[2] the approval event and the final action form a one-to-one reference | closed in two halves, cited separately: U proves the COUNT, F supplies the `actionId` the reference travels on |
| validation[1] TOCTOU / argument substitution / Unicode confusable / batch mutation | three of four. **TOCTOU is the acceptance[0] third limb** and is open for the same reason |
| validation[2] code-mode nested calls bind too | closed at F, and it was **false** before it: see F-1 below |
| validation[3] an audit query reaches a unique approval from an action | closed at F by the `actionId` field; the reverse lookup is exercised, an audit TOOL is not claimed |

## Question (2): production callers

Counted on `e96764a0f6`, over `packages/` and `apps/`, excluding `tests/`, `*.spec.ts` and `lib/`.

| subject | production callers |
|---|---|
| `approvalBindingDigest` (`user-approval/src/canonical.ts`) | 1 — `user-approval/src/index.ts` |
| `bindApproval` | 1 — `user-approval/src/index.ts` |
| `verifyApprovalBinding` | 1 outside the package — `core/tools/src/external-effect.ts` |
| `approvalBindingFor` (`core/tools/src/external-effect.ts`) | **2** — `agent-loop/src/tool-calls.ts`, `core/tools/src/ptc.ts` |
| `verifyRecordedApproval` | **2** — the same two |
| `refusedApprovalResult` | **2** — the same two |
| `approvalDisplayFor`, `redactArgumentsForDisplay` | **1** — `agent-loop/src/tool-calls.ts` only |

**The asymmetry in the last row is must[0]'s open item, not an oversight in the count.** Both dispatch paths bind and re-verify; only the native one supplies the six display fields. A code-mode ask therefore reaches a decider carrying a tool name and no manifest projection. Fixing it needs `appendCodeModeManifest` to return the manifest it builds and the two display helpers to move down beside `approvalBindingFor`, which is the same move F-1 made for the binding. It is recorded here rather than done, because F's rulings scoped this stage to must[1] and acceptance[2].

## Question (3): which launched profiles reach this

`packages/bundle/base/cordis.patch.yml:276-279` mounts `@deepseek-ai/dsh-user-approval` and `:314` mounts `@deepseek-ai/dsh-permission-presets`. `dsh-base` is inherited by `acp-app`, `headless`, `sdk-app`, `sdk-minimal` and `web-app`, so **every shipped profile reaches the ask, the binding and the re-verification.**

One qualification belongs with that sentence. The base row sets `policy` from `DSH_PERMISSION_MODE`, and under `danger-full-access` it becomes `'never'`. A profile launched that way asks nobody, records no binding, and therefore re-verifies nothing — correctly, because there is no decision to enforce. A corpus taken under that mode showing no `approval/bound` events is **not** evidence that the binding is unwired; it looks identical. Any later reading of a zero here must say which permission mode produced it.

## What the F stage found, which is the substance of this epic's second half

### F-1 — the code-mode path bound nothing, and re-verified nothing

Measured, not inferred: the tree had exactly **two** non-test callers of `gateActionRisk`. The native one at `agent-loop/src/tool-calls.ts` supplied a binding and a display and re-verified at the line below; the code-mode one at `core/tools/src/ptc.ts` supplied neither and called `verifyRecordedApproval` on no line. An approval asked from inside a code-mode program was bound to nothing, and the arguments it was decided about were never compared with the arguments that ran.

**What makes it a defect rather than an oversight is in the same file.** `ptc.ts` already reaches `enforceManifestedAction`, under a comment reading *"the SAME enforcement point the native path reaches … not a similar check written beside it"*. P2-05's question crossed to the second path; P2-06's binding did not follow it. The lesson generalises past this epic: a clause proved against one dispatch path is proved against one dispatch path, and this repository has two.

### The two paths bind different argument FORMS, and that is recorded rather than forced into one

The native path binds the **raw argument string the model emitted** — the same value `computeArgumentsHash` digests for the manifest. The code-mode path binds the **JSON-normalized value** it manifests and hashes. Each binds the form it holds.

This is safe because a dispatch is only ever compared with a record its own path wrote, and after F that is enforced by `actionId` rather than left to convention. Forcing one form would cost something real in either direction: making the native path parse introduces a failure surface at a security check, and making the code-mode path re-serialize introduces a spelling choice where P2-03 deliberately fixed one. The asymmetry is stated in `approvalBindingFor`'s JSDoc so a reader meets it rather than discovers it.

### The verifier's real biting surface is narrower than must[1] reads, and saying so is part of the evidence

Measured while writing F's cases. Mounting the real preset gate turned the substitution cases **green**: a live gate asks about the call it is dispatching and records a fresh binding that supersedes any earlier one, so every substitution looks approved. That behaviour is correct — a new question was asked and answered — but it means `verifyRecordedApproval` only bites when **the gate does not ask this time** and the session holds an earlier decision for the same action.

So must[1] reads as though re-verification guards every dispatch, and what it actually guards is the gap between a decision and a later execution that raises no new question. The cases isolate the verifier by leaving the gate unmounted, which is why they can fail at all; the frozen file says so in its own prose. Anyone citing must[1] as "every execution re-verifies" is overstating it.

### F-3 — the one-to-one reference had no field to travel on

`approval/bound` carried `action`, a tool NAME. Two `bash` calls in one session were the same line in the log, so no audit query could go from an action to its approval. U's frozen case *records ONE binding for one gated dispatch — counted* proves the COUNT, which makes a one-to-one reference possible **without making one exist**; treating the count as the reference is a substituted subject, and `acceptance-coverage.json`'s acceptance[2] note says so rather than leaving the two cited together to imply it.

The field is `actionId`, optional on the record and **outside the digest** — it is the reference, not part of the bound tuple, and putting it in would have moved C's frozen canonical projection. Records naming no dispatch are still honoured, but only while unambiguous: two of them about one tool cannot be told apart, and choosing the most recent would settle the clause by position, so the dispatch fails closed. That ambiguity check arms only when the CALLER supplies an `actionId`, which both production paths always do — which is what lets the Usage stage's frozen case over two `actionId`-less records keep its most-recent-wins reading without a re-freeze.

## acceptance[0]'s third limb is OPEN, and why it is not a matter of effort

*"改变文件 inode/远端对象版本均不会执行"* is not closed, and no citation in `acceptance-coverage.json` should be read as closing it.

`ApprovalBindingInputs.preconditions` is inside the digested tuple, so a declared precondition does move the binding. **Both production paths pass `[]`** — `agent-loop/src/tool-calls.ts` and `core/tools/src/ptc.ts` at their manifest constructions — nothing in the tree observes an inode, an mtime or a remote object version, and nothing re-reads one before execution. A field every producer leaves empty is a field the binding does not bind: BLOCKED-201's shape, said about a field instead of a path.

**The narrow version was measured before it was refused.** Building it needs to know which tool parameter is a filesystem path, and nothing declares that. Parameter schemas carry `description`/`title`/`default`/`examples` plus `type`/`enum`/`const` (`core/tools/src/schema.ts:12-28`) and nothing else; `tool-fs`'s `file_path` is an ordinary string whose only path signal is its name and its prose. Risk-domain tags name the domain (`filesystem-write`), not the parameter. `ActionTarget` declares `{ kind: 'filesystem'; path }` and **no production site constructs it** — both manifest constructions hardcode `{ kind: 'other', ref: <tool name> }`, which is **BLOCKED-238** and is also why `policy-engine-cedar` uses a tool name as every action's resource id.

So a narrow inode precondition would have shipped a producer that can never fire. That is the shape this program keeps catching in other people's work, and building it deliberately would have been worse than declaring the limb open.

## Two defects this epic produced and caught, recorded because the shapes recur

**A weak case that its own mutation exposed.** The Usage stage's *records ONE even when BOTH gates ask* began as a case driving only `gateActionRisk`. The mutation that makes the registry's own gate bind too left it GREEN, because a case that never reaches the second gate cannot count it. Rewritten to drive both, it reddens. The general form: a counting case is only as strong as the set of producers it can see.

**A `--write` that recorded a fact that was not true.** While documenting the `actionId` field, `verify-translation-pairing --write` was run to re-record the bilingual pair before the Chinese edit had actually landed — a script assertion had failed and its exit code went unread. The recorded state then said "these two sides are consistent" when they were not. Caught, corrected, and worth writing down because it is the same root as the twelve broken links in BLOCKED-236: recording a result in the middle of a change rather than at the end of it.

## Two open items carried forward

1. **must[0] does not reach the code-mode decider** (question (2) table above). A code-mode ask shows a tool name where a native ask shows six fields.
2. **The display's validity period is a constant where the service's is configurable.** `APPROVAL_DISPLAY_VALIDITY_MS = 300_000` in `agent-loop/src/tool-calls.ts` states what the decider is told; the service's `approvalValidityMs` is a `Config` field defaulting to the same number. They agree on every shipped profile today — no bundle row overrides it, checked — but a deployment that sets `approvalValidityMs` would tell a decider one expiry and bind them by another, silently. The constant's own JSDoc names the coupling without enforcing it, and the repository's rule against hardcoded tunables is on the other side of this. It is a small fix (carry the service's value to the display site) and it is not F's to make, so it is recorded here.
