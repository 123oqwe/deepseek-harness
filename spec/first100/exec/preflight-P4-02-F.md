# P4-02.F — preFlight for the Fault/Qualification stage

Recorded before the first line of F code, at `41b522569e`. The delegate asked for one thing measured first, and the measurement changed what F owes.

## The question: does an empty `realized` make `verify-make-vs-use` report UNRECORDED?

**No — and the reason is worse than "no".** Measured two ways.

**By reading.** `verify-make-vs-use.mjs:171` carries the field-shape check, and its `REQUIRED` list is ten fields: `ledgerRow`, `card`, `verdict`, `adopted`, `rejectedAbsent`, `standardsOwned`, `residual`, `probes`, `gapCheck`, `recordedBeforeFirstLine`. **`realized` is not among them, and `grep -rn realized scripts --include='*.mjs' --include='*.ts'` returns nothing at all.** No script in this repository reads the field.

**By construction, because reading a script is not running it.** Two probes on this tree, each reverted immediately:

| probe | `first100:verify-make-vs-use` |
|---|---|
| `realized` set to the F shape with `adoptedOnPath: []`, `rejectedAbsent: true` | **exit 0**, `P4-02: VERIFIED` |
| `realized` **deleted entirely** | **exit 0**, `P4-02: VERIFIED` |

So the gate is indifferent to the field's content and to its existence.

**What that means for §4.3, and it is a finding rather than a convenience.** The lifecycle file says the F stage fills `preFlight.makeVsUse.realized` and that `verify-make-vs-use` must report VERIFIED for the epic — wording that reads as though the gate checks the filling. It does not. **The `realized` requirement is enforced by no gate**; it is kept by whoever remembers it, which is the shape this program has recorded as a recurring defect rather than an acceptable one. Writing it remains right — it is the F stage's claim that what was decided is what landed — but F must not report "the gate confirms my realized" because no gate does.

**A second-order finding: the scan built to catch exactly this did not catch it.** `verify-fields-are-read.mjs` exists to list fields the program writes and never reads — its own words, "something the program tells itself and then never asks". It reports 42 such candidates and `realized` is not one of them, because its `RECORD_PATHS` is five files (`ledger.json`, `command-freeze.json`, `p9-verification.json`, `flake-registry.json`, `EXEC-STATE.json`) and **`clause-subject-audit.json` is not among them.** Every preFlight field is therefore outside the scan's reach. Adding that one path is a one-line change that would surface `realized` and whatever else sits beside it — proposed, not done, because changing what a gate covers is a delegate decision and because the list it produces should be read before it is acted on.

## What F owes, clause by clause

`stages.F` declares one file, `packages/run/task-profile/tests/profile.spec.ts` — the same file C and P use. The registry's `fixtures{}` entries (`tests/first100/fixtures/P4-02.{contract,provider,composition,fault}.spec.ts`) are template placeholders; the freeze schema says outright that they never satisfy a `files` requirement, so F's subject is the package suite, not those paths.

- **validation[0]** — fixtures over four generic task kinds (code, research, external action, personal plan). **Already landed in C** as four literal profiles, and **P re-covers them as compiler inputs**. F's addition is not a fifth fixture: it is the fault direction over the same four — each kind compiled from an input that is structurally valid and semantically impossible to satisfy.
- **validation[1]** — conflicting constraints and missing information. C covers "two contradictory hard constraints are both kept, each with its own source"; P covers "nothing is invented from the goal text". **F owes the failure side**: a compile whose only structured input contradicts itself, and one where the thing missing is the thing the clause cares about (no identity, no trust, no budget, non-text goal — the four absences that each produce a different question or refusal).
- **validation[2]** — the profile is persisted and can be revised. **F cannot observe this in the package suite**, and that is the honest finding rather than a gap to paper over: persistence is the `run/task-profile` session event, which only exists once U wires the append. So either F's persistence half waits for U and is frozen there, or F freezes the *revision arithmetic* it can observe — that recompiling an unchanged goal yields the same `TaskProfileRef` and a changed one yields a different one, which is the property the revision chain rests on and which P already exercises. The second is real but is not "persisted"; the first needs U first. **This ordering question is open question 1 below.**

## TDD plan for F

Not a freeze. argv: `pnpm exec vitest run packages/run/task-profile --reporter=json`, one package, `expectExit` 0.

| case | clause |
|---|---|
| each of the four generic kinds compiles from an input whose constraints contradict, and both constraints survive with their own provenance | validation[1] — conflict is represented, not resolved |
| a compile with no identity, no trust state, no budget and a non-text goal refuses, and the refusal names the goal rather than the missing fields | validation[1] — missing information; the refusal order is itself a claim |
| a profile whose `confidence` is outside `[0, 1]` is refused at the durable boundary, not at compile time | acceptance[1] — validation exists for what comes back out of the log |
| a profile carrying a question about a field it also decided is refused, for both the side-effect and the constraint spellings | must[2] — both branches of the rule, not only the one C froze |
| recompiling an unchanged goal yields the same reference; changing any single structured input changes it | validation[2]'s revision arithmetic (see the open question) |
| a `TaskProfileRef` that is not a sha256 digest is refused | the revision chain's identity, C's case re-observed under F's argv |

Mutations, one per case, in the constant/value/dependency forms: keep only the first contradicting constraint; make the refusal name the missing field instead of the goal; widen the confidence bound; drop one of the two question branches; hash only part of the profile; loosen the digest pattern.

## Open questions this preFlight does NOT settle

1. **Does validation[2]'s persistence half belong to F or to U?** The event that persists a profile is written by U. F can freeze the revision arithmetic today and the persistence tomorrow, or wait and freeze both after U — the first makes F's cell honest sooner and splits one clause across two stages, the second keeps the clause whole and leaves F blocked on U. §12.46-B's half-splitting precedent exists for exactly this, which is why it is a delegate call rather than mine.
2. **Does `realized`'s unenforced status need an entry?** It is a real instance of the pattern BLOCKED-192 generalises — a record written and nothing reading it — but the remedy is either extending `verify-fields-are-read.mjs`'s `RECORD_PATHS`, or adding `realized` to `verify-make-vs-use`'s `REQUIRED` list at the F stage only, or accepting it as evidence for a human. Three different remedies with different costs, and picking one is not an executor's call.
