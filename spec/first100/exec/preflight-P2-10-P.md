# preFlight — P2-10 Provider stage

Supplements `preflight-P2-10.md`, its rulings of 2026-09-12, and `preflight-P2-10-C.md`. Written before the first line of P-stage code; everything measured at `430e0164aa` plus the C stage's own tree. **Table only, no code.**

## The component that stopped existing, and why

The rulings of 2026-09-12 argued about where a **fail-closed loader** belongs — ruling 1 put it in U, ruling 2 at the Provider stage, and the adapt record's `landsIn` sat on that crack. The argument is now void, because the measurements below dissolved the component it was about: **P2-10 builds no loader, because the mechanism a loader would provide already exists in `settings` and belongs to nobody here.** Delegate ruling of 2026-09-12 (the one that stands): reuse it, and do not build a second holder.

What remains is a smaller and sharper mapping:

| component | stage | why |
| --- | --- | --- |
| `parsePolicySet` — the refusal frozen at C | C, already done | it is the `validate` callable everything below hands around |
| **registering a policy namespace with `@deepseek-ai/dsh-settings`, supplying `parsePolicySet` as its `validate`** | **P** | registration is the act of PROVIDING policy into the running system — the write side |
| **the engine reading the already-parsed section from settings, enforcing at a real dispatch point, and the shipped-bundle mount** | **U** | the read side, plus composition |
| holding the last valid policy set | **nobody in P2-10** | `settings` holds it; see §1 |

`settings/settings/src/index.ts` is touched by both stages, in opposite directions: **P registers, U reads.** That is the honest reason `verify-usage-stage-subject` is satisfied — the registry's named consumer file is genuinely on both sides of this epic, rather than touched to satisfy a gate.

**One consequence for the record**: Cedar's first production import is not at P. It happened at C — `parser.ts:16` and `compiler.ts:26` — which is why the adapt disposition now records `LANDED … in parser.ts/compiler.ts` and carries no `landsIn`.

**And one correction a reader of the disposition needs, pointed at from here rather than made there.** The make-vs-use card's `residual` line names "a fail-closed loader that keeps the last valid set", and `clause-subject-audit.json`'s `residual` field transcribes it verbatim, as a transcription must. **That line is superseded by this page**: `settings` already keeps the last valid value and already refuses a bad section at registration (§1), so no such loader is built and the component does not exist in P2-10. The card is not edited and the transcription is not edited — a quoted source saying what it said is the point of quoting it — and the correction lives here, where prose is allowed to disagree with a quote.

## Three measurements, two of which delete work

### 1. "Fail closed and keep the last valid version" is already implemented — generically, in `settings`

`validation[2]` asks that a bad policy load fail closed and keep the last valid version. `preflight-P2-10.md` recorded this as "**neither half exists**". Re-measured, both halves do, and not in `policy-engine-cedar`:

| reading | source |
| --- | --- |
| `SettingsRegisterOptions.validate?: (value: T) => void` rejects a resolved section its owner could not act on, "for constraints its schema cannot express" | `packages/settings/settings/src/index.ts:83-86` |
| once the owner is registered, a stored section that fails `validate` **keeps the namespace's last good value and warns**, exactly as a schema failure does | `:77-79`, and the implementation at `:743-752` — `publish()` catches, logs `settings: keeping last good "%s" after invalid stored section`, and `continue`s, so other namespaces still commit |
| at registration there is no last good value yet, so a stored section that already fails **rejects the registration itself** | `:79-81` |

The last row is fail-closed-at-boot; the middle row is keep-last-good-at-reload. Both clauses of validation[2], owned by the package whose job that is.

"Already tested" is a claim this page checks rather than asserts — three named cases in `packages/settings/settings/tests/settings.spec.ts` cover exactly these paths:

| case | line | which half |
| --- | --- | --- |
| `refuses a write its owner could not act on, and keeps the last good value for a stored one` | `:97` | both, including the comment at `:124` recording that at cold start there is no last good value to keep |
| `keeps the last good value for an invalid section while other namespaces commit` | `:556` | keep-last-good on reload, plus the isolation P2-10 depends on — one bad namespace does not stop the others |
| `keeps the last good value (no silent field loss) when a hot-reloaded section declares an incompatible major` | `:607` | the same behaviour reached through a schema-version failure rather than a `validate` failure |

So P2-10 inherits a mechanism with its own coverage. What it must add is a case proving the POLICY namespace is wired to it — that a policy set failing `parsePolicySet` leaves the previously accepted set in force — not a re-proof of the mechanism.

### 2. Today's policy load is fail-LOUD, and takes the boot with it

| reading | source |
| --- | --- |
| the provider validates at construction and `throw`s when the probe fails: `policy set does not parse, so no policy would be enforced: …` | `packages/policy/policy-engine-cedar/src/index.ts:220-238` |
| the probe is an `isAuthorized` with an empty context, whose only question is whether the set PARSES — it does **not** see an unknown context key (measured at C) | `:224-232`, and `preflight-P2-10-C.md`'s probe table |
| `Config.policies` has no default: a deployment states its set | `:47-49` |

A throw in a `Service` constructor fails the mount, so an invalid set today takes down the boot rather than keeping a last-good one. **That probe-throw is deleted at U**, when the set's source moves from `Config` to the namespace P registers — not softened, deleted, because keeping it would mean two things decide what happens to a bad set.

### 3. Reusing P0-05's gate costs a bundle row, and is not P's

| reading | source |
| --- | --- |
| `resolveFeatureGate` and `evaluateFeatureGate` ship as real, callable Provider-stage code, generic over the decision type: `evaluateFeatureGate<T>(gateId, state, legacy, candidate, keepFields)` | `packages/migration/feature-gates/src/index.ts:266-272` |
| `evaluateFeatureGate` has **zero production callers** — outside the declaring package and outside `tests/`, only type-level references remain (`identity/principal/src/index.ts:24` in a doc comment; `apps/cli/src/dump-config.ts:17` and `profile-boot.ts:18` importing types) | measured 2026-09-12 |
| `feature-gates` appears in **no** shipped bundle patch layer: `grep -rn 'feature-gates' packages/bundle/*/cordis.patch.yml` returns nothing | measured 2026-09-12 |
| `redactDecisionSummary(summary, keepFields)` is a real allowlist over an own-property check, building onto a null-prototype object, so a `summary` carrying its own `__proto__`- or `constructor`-named field cannot smuggle one through | `feature-gates/src/index.ts:196-207` — read as code, not from its module doc |
| the summary a gate compares is `Readonly<Record<string, JsonValue>>`, and its own doc states that only the `keepFields` allowlist ever leaves the module | `:209-215` |

Writing the first shadow record therefore requires `@deepseek-ai/dsh-feature-gates` to enter a shipped patch layer — a composition change with a snapshot obligation, which is U's, not a P-stage import.

**And `keepFields` must exclude `PolicyExplain.matched`.** The mechanism is an allowlist, so this is a decision about what to name, not a filter to write: `ClosedDecision.reason` is a closed `PolicyReasonCode` and safe to summarise, while matched policy ids would carry rule names into a record P0-05 owns and this epic does not. `PolicyExplain` is declared audit-only at `policy-engine/src/types.ts:205-210` — "Never returned to a model or an ordinary plugin" — and a shadow record is neither of those but is also not the audit trail, so naming `matched` would move it to a third place with no such declaration.

## The P table

Three columns: what P can DECIDE, what P must BUILD, and how a wrong build fails — the third written as the symptom a reader would see.

### must

| clause | P decides | P builds | how a wrong build fails |
| --- | --- | --- | --- |
| must[0] — a finite declarative language with no arbitrary code execution | **nothing new.** The vocabulary and its refusal were decided and frozen at C. P decides only that the refusal reaches a real configuration surface, as the namespace's `validate` | the namespace registration, and `policy-language/src/index.ts` as the package's one entry — today three bare re-exports; P gives it the function a registrant calls without reading three modules | A second entry point. A registrant importing `./parser.ts` directly will eventually import `./compiler.ts` too, and the ORDER — parse before pin — becomes its responsibility rather than the package's, which is exactly what `compilePolicySet` already got right |
| must[1] — unit tests, shadow evaluation, version pin, diff explain | the **pin's landing**: a compiled set carries `pin`, and the decision vocabulary already carries `PolicySetDigest` per decision (`policy-engine/src/types.ts:202`). P decides whether these are one value or two, and the answer is **two, with the pin the wider one** — the digest is over ids and sources (`policy-engine-cedar/src/index.ts:147-154`), the pin adds the vocabulary and the engine version | the pin carried on the namespace's resolved value, so a reload that changed the set is visible as a changed pin | Collapsing the pin into the digest. A replay could then not distinguish "the policies changed" from "the engine that reads them changed" — the single question acceptance[2]'s impact report exists to answer |
| must[2] — explain reports matched rules and a safe summary, exposing no secrets | that redaction is **structural, not a filter** — decided at C. P decides nothing further: the shadow record and its allowlist are U's, with the bundle row that carries them | — | (nothing at P; the failure mode moves with the row to U, where a cast through `RedactedJsonValue` would compile clean and ship the secret, that brand having no runtime content — `feature-gates/src/types.ts:150`) |

### acceptance

| clause | P decides | P builds | how a wrong build fails |
| --- | --- | --- | --- |
| acceptance[0] — a policy file cannot reach network, filesystem or environment | **nothing to build, and one thing not to build.** The settings provider owns the document; the namespace value arrives already parsed, so no policy path is opened by this epic at all | one frozen case pinning that the package opens no file and imports no `node:fs` | Building a policy-file reader "so the namespace can be seeded". It creates the I/O surface the clause denies, in the name of satisfying the clause — the trap C recorded, one stage later |
| acceptance[1] — same input and version, same output | **where the pin is observed**, which is the half C could not close: C proved the function is deterministic; P decides that the REGISTERED set carries its pin, so two runs can be compared at all | the pin on the namespace's resolved value, and a case that registers twice over the same document and compares | A pin computed per decision instead of per registration. Correct and useless: identical on every row, and silent about the only event it exists to mark, which is a reload that changed the set |
| acceptance[2] — replay historical ActionManifests and produce an impact report | the report's PRODUCER — its shape was decided at C. P decides it replays through the SAME evaluation path enforce uses, never a second evaluator | the replay entry, taking a manifest stream and two pinned sets | A replay that builds its own Cedar request. The moment it does, a difference it reports is its own mapping's, and `toCedarRequest` — the one mapping P2-05 froze and C's schema is checked against — is no longer the single subject |

### validation

**Completeness, asked and answered honestly.** The delegate asked whether every clause with a P component has a row. The first version of this page had only validation[2], and the check found two more. Both are below; nothing else in the registry's nine clauses has a Provider-stage component — must[0..2] and acceptance[0..2] are all covered above, and no acceptance[3] exists.

| clause | P decides | P builds | how a wrong build fails |
| --- | --- | --- | --- |
| validation[0] — parser fuzz, resource exhaustion, conflict tests | **only the exhaustion third, and only its bound.** Fuzz and conflict are F's: conflict resolution is Cedar's forbid-overrides-permit, which §1.8 forbids re-verifying, and fuzzing a parser is a campaign, not a provider. What is P's is that **nothing bounds a policy set anywhere today** — measured: no length, size or count limit in `policy-language/src/*.ts`, and none in `settings/settings/src/index.ts` either. A namespace accepts whatever the document holds | the bound, at the registration, over the COMPLETE set — policy count and total source bytes, per the repository rule that a limit is applied where the complete emitted value is known | A bound inside `parsePolicySet` instead. The parse is per-policy; a limit there caps one policy and lets ten thousand of them through, which is the exhaustion the clause names. It would also make C's frozen refusals grow a fourth reason after freeze |
| validation[1] — shadow replay over ten thousand historical fixtures | **that the replay entry is P's and the corpus is not** — ruling 3 split the clause into a real-N acceptance replay and a derived-M F campaign. P decides the entry replays through the same evaluation the enforce path uses, and that it reports the real N rather than a target | the replay entry itself, shared by both readings, so the F campaign extends a measured path rather than writing a second one | Two replay paths, one for the real corpus and one for the campaign. The campaign's job is to assert its own distribution (BLOCKED-225); a campaign running through its own private path proves things about that path, and the real-N number stops being comparable to the derived-M one |
| validation[2] — a bad policy load fails closed and keeps the last valid version | that **`settings` already owns both halves** (§1), so P supplies the `validate` function and the registration, and nothing else of that mechanism | the registration whose `validate` is `parsePolicySet` | Caching the accepted set in the provider "so the engine does not re-resolve". That cache is a second holder of "the last valid set"; the first failed reload puts the two out of step, and the audit then carries decisions against a set no operator can name |

### What P must NOT take

- **Not a policy set of its own.** The provider does not hold one. This is the row below.
- **Not the engine's decision.** P registers and pins; U is where an already-parsed set answers a real request and where the constructor's probe-throw is deleted.
- **Not the bundle mount.** `@deepseek-ai/dsh-feature-gates` entering a shipped patch layer is a composition change with a snapshot obligation — U's.
- **Not `permission-presets`.** Unchanged from C: ruled out, deliberately untouched, because it carries P2-11's approval posture.
- **Not a second corpus.** Ruling 3 splits the ten thousand into a real-N acceptance replay and a derived-M F-stage campaign; P builds the replay entry, not the corpus.

## The one thing P can get wrong that no later stage can fix

**Letting the provider hold the policy set.** Every shape that does — a path in `Config`, an accepted-set cache, a re-read on a timer — recreates what `settings` already implements, inside the one package whose job is to ask Cedar a question. The failure is not at the moment it is written: it is at the first reload that fails validation, when the namespace keeps its last good value and the provider keeps a different one. From then on `ClosedDecision.policySet` names a digest of a set no operator can point at, and no later stage removes the second holder without changing what every audit row already meant.

## Open, and to be measured at P rather than asked

1. Whether a settings namespace value can hold a `Record<string, string>` of policy sources directly, or whether the JSON-safe constraint (`SettingsNamespaceView.value: JsonValue`) needs a wrapper object. Measurable by registering one.
2. Whether the pin belongs on the namespace's resolved value or is recorded once per registration as a session event. The `Model-visible ⟺ logged` rule decides it: if the pin ever reaches a model or a user-visible explain, it needs an event.
3. What `validate` throwing actually produces at registration time versus at `publish()` — the doc comment says the registration is rejected in the first case and the last good value kept in the second, and the two paths (`:79-81`, `:743-752`) should be observed rather than read, because validation[2]'s freeze rests on the difference.
