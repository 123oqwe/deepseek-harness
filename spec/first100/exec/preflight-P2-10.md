# preFlight — P2-10 (Policy-as-Code、Explain 与 Dry Run)

Written 2026-09-12 by lane A during the push-6 wait, under the delegate's authorisation, in the shape `preflight-P2-06.md` set: every assertion carries a reading or is marked unverified. **Nothing in this epic has been implemented. `recordedBeforeFirstLine: true` is literally true here** — no `packages/policy/policy-language` directory exists, so there is no earlier code to have been described after the fact.

Paths and line numbers were read at `6cf66891af`.

## Readiness, and the one rule that shapes this epic before any clause does

Predecessors `P0-05` and `P2-05` are both **ACCEPTED / APPROVED** with four green cells each. P2-10's own row is `NOT_RUN` / `PENDING`.

**§1.8 applies and decides the epic's shape.** P2-10 is on the shared Cedar engine's consumer list, and the engine slice has landed: `@deepseek-ai/dsh-policy-engine-cedar` is P2-05's Provider stage, mounted in the shipped base at `packages/bundle/base/cordis.patch.yml:287-288`. So **this epic does not re-verify Cedar.** Whether `forbid` overrides `permit`, whether an unmatched request denies, and whether the authorizer reports which policies matched are P2-05's frozen properties, and re-freezing them here would be the second declaration §7.6 scans for.

What that leaves P2-10 is exactly what the make-vs-use card's `residual` names, and the card is worth quoting because it is unusually precise about the division:

> Policy-set version pin (digest of text + schema), shadow evaluation via P0-05 gate off|shadow|enforce, replay harness over historical ActionManifests + impact/diff report, fail-closed loader keeping last-good set, explain redaction, vitest fixture runner, fuzz of Cedar inputs, docs/policy/language.md as dsh's Cedar schema + conventions.

Verdict `PROVIDER_ADAPT`, one `adapt` row (`cedar-policy/cedar`, `@cedar-policy/cedar-wasm`, already at **4.12.0** in `policy-engine-cedar`'s dependencies), four `reject` rows and one `optional` (`cel-js`). `standards: []`.

## 1.2 — the three questions

### Is each clause's subject on an execution path today?

| clause | subject | on an execution path at `6cf66891af` |
| --- | --- | --- |
| must[0] — a finite declarative policy language with no arbitrary code execution | the language | **Does not exist as a dsh artifact.** `packages/policy/policy-language/` is absent; `docs/policy/language.md` is absent. What EXISTS is Cedar source strings supplied as deployment config: `Config.policies` is `Record<policyId, cedarSource>` (`policy-engine-cedar/src/index.ts:33-49`), and the shipped base supplies two of them by hand (`cordis.patch.yml:293-300`). So the *language* is Cedar's and is already in production; what is absent is dsh's own finite surface over it, which is what must[0] asks for |
| must[1] — unit tests, shadow evaluation, version pin, diff explain | four separate subjects | **All four absent.** `grep -rn 'shadow\|versionPin\|version pin\|impact report\|dryRun\|dry-run' packages/policy --include='*.ts'` excluding tests and `lib/` returns **0 hits** |
| must[2] — explain reports matched rules and a safe summary, exposing no secrets | `PolicyExplain` | **Exists and is on the path.** `policy-engine/src/types.ts:212-222`: `matched: readonly PolicyId[]` plus `diagnostics: readonly string[]`, declared audit-only and explicitly "Never returned to a model or an ordinary plugin". The enforcement point reads it at `policy-enforcement/src/index.ts:169`. **The redaction half of must[2] is the gap**: the type says who may see the explain; nothing measures that `diagnostics` carries no secret |
| acceptance[0] — a policy file cannot reach network, filesystem or environment | Cedar's evaluator | **True by construction today, and not by anything dsh built.** Cedar is a total evaluator with no I/O primitives. The clause's real dsh subject is the LOADER: what happens when a deployment's policy text is read, which is `Config.policies` — a config field, so its content arrives through the loader, not through a file this epic opens |
| acceptance[1] — same input and version produces the same output | `PolicySetDigest` | **Half exists.** `ClosedDecision.policySet` carries the digest (`types.ts:202`) and the provider computes it (`policy-engine-cedar`). What is absent is the other half of "version": nothing pins a version, and nothing replays against a pinned one |
| acceptance[2] — replay historical ActionManifests before an upgrade and produce an impact report | the replay harness | **Absent.** No such harness exists. The inputs do: `action/manifest-appended` is a session event with a production writer, and P2-03's manifests carry `sideEffectClass`, `riskClass` and the target |
| validation[0] — parser fuzz, resource exhaustion, conflict tests | the parser | absent with the language |
| validation[1] — shadow replay over ten thousand historical fixtures | the corpus | **The corpus does not exist either**, and this is the clause most likely to be misread — see open question 3 |
| validation[2] — a bad policy load fails closed and keeps the last valid version | the loader | **Neither half exists.** Today an invalid policy set fails at plugin load, which takes the whole boot down rather than keeping a last-good set; there is no "last valid version" because nothing versions |

### Which stage does each freeze hang on?

The registry's stage map is coherent with the above and this preFlight proposes no A-class change to it:

- **C** — `policy-language/src/{parser,compiler}.ts`, `tests/golden.spec.ts`, `docs/policy/language.md`, plus `policy-engine/src/index.ts`. The vocabulary and the grammar.
- **P** — `policy-language/src/index.ts`. The compiler as a callable.
- **U** — `permission-presets/src/index.ts` and `settings/settings/src/index.ts`. **This is the stage worth arguing about before code**, see open question 1.
- **F** — `tests/golden.spec.ts`. Fuzz, exhaustion, conflicts.

### What is each clause's subject, as a file and line?

Recorded in the table above. Three subjects have file:line today (`PolicyExplain` at `policy-engine/src/types.ts:212`, the digest at `:202`, the enforcement read at `policy-enforcement/src/index.ts:169`); the rest have none, which is the honest state of an epic whose package does not exist.

## 1.3 / 1.4 — the fourth question, and the adapt SOP

The card's one `adapt` row is Cedar, and **it is already adopted on this tree** — `policy-engine-cedar/package.json` declares `@cedar-policy/cedar-wasm: 4.12.0`, and P2-05's `preFlight.makeVsUse.adopted` records the adoption with its landing site. So §8's nine-step SOP does not re-run here: P2-10 adds no new adapt-level dependency, it consumes one that P2-05 already supply-chain-checked and landed.

**What P2-10 must do instead is check which Cedar primitives its clauses need are actually present**, because the card names several that P2-05 never used. Measured by loading the installed package from `policy-engine-cedar`:

`checkParseContext, checkParseEntities, checkParsePolicySet, checkParseSchema, formatPolicies, getCedarLangVersion, getCedarSDKVersion, getCedarVersion, getValidRequestEnvsPolicy, getValidRequestEnvsTemplate, isAuthorized, isAuthorizedPartial, policySetTextToParts, policyToJson, policyToText, preparsePolicySet, preparseSchema, schemaToJson, schemaToJsonWithResolvedTypes, schemaToText, statefulIsAuthorized, templateToJson, templateToText, validate` — 24 exports.

So every primitive the card's note names is present: `checkParsePolicySet` (the fail-closed loader's parse), `validate` (schema validation), `formatPolicies` (canonical text for the digest), `policyToJson` / `policyToText` (a finite surface both ways), `isAuthorizedPartial` (residuals). **`preparsePolicySet` and `statefulIsAuthorized` are additionally present and the card does not mention them**; whether a replay harness over ten thousand fixtures should use the stateful entry is a P-stage measurement, not a preFlight claim.

## 1.5 / 1.6 — standards and community gaps

`standards: []` — this epic owns no standard and imports none. The Cedar schema dsh writes is a deployment artifact, not a standard this program owns; `docs/policy/language.md` documents dsh's conventions over Cedar's language, which is why the registry classes it `N` rather than as a spec file.

The card records no `gaps` array, so 1.6's item-by-item reconciliation has nothing to reconcile. The four `reject` rows carry their reasons (OPA needs a Go build to produce wasm and its npm package is eval-only, last published 2024-11; casbin has expression matchers with no schema and weak explain; json-logic and casl likewise). None of them reopens a clause.

## Open questions — which are C-stage measurements, which need a ruling

**1. The U stage's subject, and it is the one that could repeat P2-02 / P6-07 / P1-10. (DELEGATE RULING NEEDED.)** The registry names `permission-presets/src/index.ts` and `settings/settings/src/index.ts` as the consumer files. Measured, and the two answer differently:

- `settings/settings/src/index.ts` is the namespace-schema registry (`SettingsRegisterOptions` at `:52`) and contains the string `policy` **0 times**. It is policy-free.
- `permission-presets/src/index.ts` is NOT policy-free, and the distinction matters more than an absence would. It already carries a policy vocabulary — of a *different kind*. `PresetSpec.approval` is an `ApprovalPolicy` (`:63-64`), the projection tracks the last `approval/policy` payload (`:101-102`, reduced at `:141`), and it imports `@deepseek-ai/dsh-sandbox-policy` (`:18`). That is P2-11's approval/sandbox posture, not an authorization policy set: `ApprovalPolicy` decides whether a human is asked, while a Cedar policy set decides whether the action is permitted at all.

So the U question is sharper than "does the consumer mention policy". It is: **does a compiled Cedar policy set belong beside `ApprovalPolicy` on a preset, or is putting it there conflating two different decisions the program has deliberately kept apart?** P2-12 must[3] says a human answer is an input and never a grant; the same separation argues that "which preset am I on" and "what does the authorizer permit" are not the same field. The reading I cannot rule out from here is that the registry named the package whose name matched rather than the one that can hold the artifact. **I will not write a compiler whose only caller is its own tests, and I will not pick the consumer myself** — this is the shape BLOCKED-232 and §12.78 exist for.

**2. What "a finite declarative language" means when Cedar is already the language. (DELEGATE RULING NEEDED.)** Three readings, and they produce different epics: (a) dsh defines its own surface syntax that COMPILES to Cedar — the parser/compiler split the registry's C stage names, and the biggest of the three; (b) dsh defines a Cedar *schema* plus a conventions document, and "finite" means the schema closes the entity and action vocabulary — much smaller, and `validate` already enforces it; (c) dsh defines a JSON policy form that maps to `policyToJson`'s shape, so the "language" is a validated data format rather than a syntax. The card's residual line names `docs/policy/language.md as dsh's Cedar schema + conventions`, which points at (b); the registry's `parser.ts` + `compiler.ts` point at (a). **These disagree, and the disagreement is in the inputs rather than in my reading of them.**

**3. "Ten thousand historical fixtures" has no corpus, and inventing one would be the wrong fix. (DELEGATE RULING NEEDED.)** validation[1] asks for shadow replay over 10,000 historical ActionManifests. Measured: manifests exist as `action/manifest-appended` session events with a real production writer, but there is no stored corpus of ten thousand, and the recorded-session corpus is ~176 scenarios. Three options: generate 10,000 synthetic manifests (cheap, and proves the harness rather than the policy); replay whatever the corpus actually holds and report the real number (honest, and does not satisfy the clause as written); or treat 10,000 as the clause's shape rather than its arithmetic. **This is an A-class question about what the clause means**, which the lifecycle says is the delegate's.

**4. Where the version pin lives. (C-stage measurement, not a ruling.)** `PolicySetDigest` exists and every decision already carries it. Whether the pin is that digest plus a schema digest, or a separate declared version, is measurable at C by asking what a replay needs to be reproducible. I will measure rather than ask.

**5. Whether shadow evaluation reuses P0-05's gate or builds its own. (C-stage measurement, with one reading that may change the answer.)** P0-05 ships `FeatureGateState = 'off' | 'shadow' | 'enforce'` (`feature-gates/src/types.ts:36`) and a `FeatureGateShadowDecisionRecord` for the decision diff. Measured: **nothing in production writes a shadow decision record** — `grep -rn 'ShadowDecisionRecord\|shadowSummary' packages apps --include='*.ts'` excluding tests, `lib/` and the declaring package returns 0 hits — and `feature-gates` appears in no shipped bundle patch layer. The state enum is read by `apps/cli/src/profile-boot.ts:332-358` for an env override, so the VOCABULARY is on a production path while the shadow MECHANISM is not. So P2-10 reusing P0-05's gate means being its first production writer, which is a larger commitment than "reuse" suggests, and is worth the delegate knowing before C.

**6. must[2]'s redaction half has no owner yet. (C-stage measurement.)** `PolicyExplain.diagnostics` is `readonly string[]` carrying Cedar's diagnostics verbatim. Whether Cedar can emit a secret into them at all is measurable — it echoes policy text and entity uids — and the answer decides whether redaction is a filter this epic writes or a property it can freeze as already true.

## Delegate rulings, 2026-09-12 — the three open questions are closed

Recorded here in full because they change the epic's shape, and the sections above are kept as written so a reader can see what was asked and what was answered.

**1. A compiled policy set does not go on a preset.** `ApprovalPolicy` decides whether a human is asked; a policy set decides whether the action is permitted. Keeping those apart is deliberate. So the U consumers are **`settings/settings/src/index.ts`** — which pins which policy-set version and digest is in force, and is the clean configuration surface (0 `policy` hits) — plus **the Cedar provider's loading path** in `policy-engine-cedar`, which is where a fail-closed loader lives. **`permission-presets/src/index.ts` is named by the registry and deliberately not touched**, recorded as such with the measurement behind it: what it carries is P2-11's approval posture, not an authorization policy set.

Two consequences worth stating before the C stage, because both are gates this program has recently watched fail:

- `verify-usage-stage-subject` is satisfied. It requires the U stage, taken as a whole, to touch at least one consumer file the registry names, and `settings/settings/src/index.ts` is one. P3-01 failed this gate on candidate 5 by touching its consumer PACKAGE but not the named FILE; this epic's U must touch that file itself, not merely `settings`' package.
- `policy-engine-cedar/src/index.ts` is **not** in P2-10's `files[]`, so the loader half of U needs a `files-overlay` entry with a reason. Recorded now rather than discovered at freeze time.

**2. The language is a Cedar schema plus conventions — reading (b).** dsh does not define a second syntax that compiles to Cedar. A second language would be a second trust root, and it would re-verify the semantics §1.8 says this epic must not re-verify. `docs/policy/language.md` is dsh's Cedar schema and its conventions; "finite" is what the schema enforces by closing the entity and action vocabulary.

The registry's two C files are read against that ruling rather than against reading (a):

| registry C file | role under the ruling |
| --- | --- |
| `policy-language/src/parser.ts` | parsing CONSTRAINED BY the dsh schema: `checkParsePolicySet` plus `validate`, refusing any vocabulary the schema does not declare. Not a parser for a new syntax |
| `policy-language/src/compiler.ts` | producing the pinned artifact: the validated policy set plus its version and digest. Not a compiler from one language to another |

**`landsIn` is revised from `P2-10.C` to `P2-10.P` accordingly.** Under reading (a) the first production import of Cedar would have been the compiler's; under (b) there is no compiler in that sense, and the first import is the fail-closed loader's at the Provider stage. The audit record carries the revision and the reason, on P2-05's precedent of amending `landsIn` when the shape refined.

**3. "Ten thousand historical fixtures" splits into two readings, and the evidence states both separately.** The acceptance evidence is a replay over the REAL corpus — `action/manifest-appended` has a real production writer, and the recorded corpus is what it is; the evidence reports the real count rather than a target. The ten thousand becomes a DERIVED campaign at the F stage, generated by mutating real manifests, and it asserts the shape of the shadow report the way P4-12's crash campaign asserts its own distribution — because a campaign that does not check its own distribution can pass by being cheap, which is exactly what BLOCKED-225 measured. Two sentences in the evidence, never merged: real N, derived M.

This is an A-class restatement of the clause's word "historical", made by the delegate, recorded as overridable by the user, and going into the morning's decision list as an annotation rather than a blocker.

**4. Scope, from the shadow reading.** Reusing P0-05's gate means becoming its first production writer — measured above: zero production writers of the shadow decision record, and `feature-gates` in no shipped bundle. The delegate has narrowed must[1]'s shadow row to that commitment explicitly, so the C stage plans for writing the record rather than assuming a mechanism it can call.

## What this preFlight does NOT settle

**As written on 2026-09-12 it left three questions open; all three were ruled the same day and the rulings are recorded above.** What remains open is what it always said would be measured rather than asked: where the version pin lives (question 4), what the shadow record costs now that writing it is this epic's job (question 5), and whether Cedar can emit a secret into `diagnostics` at all (question 6). Those are C-stage measurements, reported not asked.

**First thing a re-reader should re-measure**: `grep -n 'policy' packages/interaction/permission-presets/src/index.ts packages/settings/settings/src/index.ts`. Question 1's weight rests on `settings` having 0 hits and `permission-presets`' hits being `ApprovalPolicy` and `sandbox-policy` rather than an authorization policy set — a first draft of this page asserted both were policy-free, which the grep falsified.
