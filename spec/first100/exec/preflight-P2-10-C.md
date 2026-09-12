# preFlight — P2-10 Contract stage

Supplements `preflight-P2-10.md` and the delegate's three rulings of 2026-09-12. Written before the first line of C-stage code; everything measured at `a67a40b2b1`. **Table only, no code.**

Ruling (b) governs: the language is a Cedar **schema plus conventions**, not a second syntax. So the C stage's subject is not a grammar — it is the vocabulary Cedar is allowed to see, the artifact that pins a version of it, and the document that says what the words mean.

## What the tree already decided, and nobody wrote down as a schema

The dsh entity vocabulary is **already fixed in code** by `toCedarRequest` (`policy-engine-cedar/src/index.ts:66-100`), which is what makes ruling (b) cheap: the schema C writes is a declaration of what the provider has been sending all along, not an invention.

| Cedar position | what dsh sends today | source |
| --- | --- | --- |
| principal | `Dsh::Principal` with the identity's id | `:67` |
| action | `Dsh::Action` with the manifest's **capability**, deliberately not the tool name — two tools invoking one capability are one authorization question | `:68-70` |
| resource | `Dsh::Resource` with a kind-qualified target id | `:71`, `targetId` at `:103` |
| context | exactly ten declared keys: `sideEffectClass`, `classified`, `workspaceTrust`, `permissionPosture`, `riskClass`, `world`, `tokenPresented`, `tokenCapability`, `tokenDelegationDepth`, `tokenTenant` | `:72-99` |

**There is no schema today, and that is the gap must[0] names.** `validate` requires one and nothing calls it. What the provider does at load is a probe `isAuthorized` with an empty context (`:221-232`), whose only question is whether the set PARSES. Its own comment says "Cedar has no separate 'validate this set' call that reports the same errors an authorization would" — measured against the installed 4.12.0, `checkParsePolicySet` and `validate` are both exported, so that sentence is true only about error-message parity and must not be read as "no validation call exists".

**The consequence, and it is the one to measure first at C.** A policy that references a context key or entity type dsh never sends still parses, so the load probe passes and the rule is simply dead — it never matches, and nothing says so. This is the failure a schema exists to convert into a load-time refusal. Stated as the C stage's first probe rather than as a finding: two lines, a policy naming `context.tyop` against the current provider, and the reading is whether it loads and silently never fires.

## The C table

Three columns per clause: what C can DECIDE (and therefore freeze), what C must BUILD, and how a wrong build fails — the third written as the symptom a reader would actually see, because "it fails" is not a design.

### must

| clause | C decides | C builds | how a wrong build fails |
| --- | --- | --- | --- |
| must[0] — a finite declarative language with no arbitrary code execution | the **vocabulary is closed**: the three entity types and the ten context keys above, declared as a Cedar schema, plus the rule that a policy outside it is refused at load. "No arbitrary code" is Cedar's property, not ours, and §1.8 forbids re-verifying it | `docs/policy/language.md` (the schema and its conventions) and `parser.ts` — `checkParsePolicySet` plus `validate` AGAINST that schema | **Silently, which is the whole danger.** Build the schema too wide (or skip `validate`) and a typo'd policy loads and never matches: the deployment believes it has a rule, the audit shows no match, and nothing distinguishes that from a rule that correctly did not apply. Build it too narrow and a legitimate policy is refused at boot — loud, recoverable, and much the better failure |
| must[1] — unit tests, shadow evaluation, version pin, diff explain | **only two of the four are C's.** C decides the FORM of a policy-set unit test (a request fixture plus the expected decision) and the FORM of the version pin (below). Shadow and diff explain are decided here only as data shapes; their mechanisms are P/U | the fixture format, and the pinned artifact's type | A shadow "decision" that is not the same decision. must[1]'s shadow must run the SAME evaluation the enforce path runs; a second code path that approximates it reports differences that are its own. The C-stage guard is that the shadow shape carries the `PolicySetDigest` it was evaluated against, so a comparison across two different sets cannot be mistaken for a behaviour change |
| must[2] — explain reports matched rules and a safe summary, exposing no secrets | C decides **what may appear** in a redacted explain, as a type. `PolicyExplain` already exists (`policy-engine/src/types.ts:212`) with `matched: PolicyId[]` and `diagnostics: string[]` | the redacted projection's TYPE, and the rule that the model-visible side is the existing closed `PolicyReasonCode` and nothing else | A projection that is a filter over free text. `diagnostics` is Cedar's own strings; a redactor that strips patterns from them is a denylist, and a denylist over an upstream's message format fails the first time the format changes. The C decision that avoids it is structural: the redacted explain carries policy IDS and a closed code, never upstream text |

### acceptance

| clause | C decides | C builds | how a wrong build fails |
| --- | --- | --- | --- |
| acceptance[0] — a policy file cannot reach network, filesystem or environment | **nothing to build; C states why.** Cedar is a total evaluator with no I/O primitives, which is P2-05's adopted property. The dsh-side subject is that policies arrive as CONFIG (`Config.policies`, a `Record<id, source>` at `policy-engine-cedar/src/index.ts:33-49`), so no policy path is opened by this epic at all | one frozen case pinning that the loader reads config and opens no file | Building a loader that reads policy files from disk. It would create the very I/O surface the clause denies, and it would do it in the name of satisfying the clause |
| acceptance[1] — same input and version, same output | the **version pin's definition**, which is C's central artifact: the digest over the canonical policy text (`formatPolicies` gives the canonical form) **plus the schema digest**, because the same text against a changed schema is a different evaluator | the pinned artifact type and its digest function | A pin over text alone. The schema decides what a policy MEANS; two runs with one text and two schemas are two behaviours with one pin, and a replay would report a behaviour change as a no-op |
| acceptance[2] — replay historical ActionManifests and produce an impact report | the impact report's SHAPE — per decision: the manifest reference, both decisions, and both pins | the report type | A report of decisions without their pins. The whole use is "what changes if I upgrade"; a row that cannot name which two sets it compared is not evidence of anything |

### What C must NOT take

- **Not the loader.** The fail-closed loader that keeps the last valid set is the Provider stage's (`landsIn: P2-10.P`), and it is where Cedar is first imported in production under ruling (b).
- **Not the shadow writer.** Reusing P0-05's gate means becoming its first production writer — measured: zero production writers of the shadow decision record, and `feature-gates` in no shipped bundle. C declares the record's shape; whoever writes it is P/U.
- **Not `permission-presets`.** Ruled: named by the registry, deliberately untouched, because it carries P2-11's approval posture.

## The one thing C can get wrong that no later stage can fix

A schema that declares what dsh sends is correct; a schema that declares what dsh **might want to send** is a second vocabulary, and every policy written against the speculative half is dead on arrival in exactly the silent way described above. So the C-stage rule is that **every entity type and context key in the schema is justified by a line in `toCedarRequest`**, and the frozen case that enforces it compares the schema's declared keys against that function's own — a test that fails when the two drift, in either direction.

That is also the answer to "how would we know the schema is finite": not by counting, but by the schema and the request builder being checkable against each other.

## Open, and to be measured at C rather than asked

1. Whether an unknown context key silently never matches (the first probe above). If Cedar 4.12.0 already errors without a schema, must[0]'s load-time refusal is partly free and the C table's first row shrinks.
2. Whether `formatPolicies` is stable enough across Cedar patch versions to be a digest input, or whether the digest must be taken over `policyToJson` instead. A canonicaliser that changes its output on a dependency bump would move every pin without a policy changing.
3. What `PolicyExplain.diagnostics` can actually contain — echoed policy text, entity uids, or both — which decides whether must[2]'s redaction is a projection or a refusal to carry the field at all.
