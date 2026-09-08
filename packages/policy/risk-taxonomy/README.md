---
description: "The eight-class risk vocabulary and pure classifier for Epic P2-04: organisation-policy-decided mapping of plugin-declared domain tags, classification confidence and grounds, and the unknown-classifies-higher default that stops short of the kernel hard-deny band."
kind: "package-library"
---

# @deepseek-ai/dsh-risk-taxonomy

## Summary

`dsh-risk-taxonomy` ships the risk vocabulary Epic P2-04's must[0] fixes —
`read`, `local-reversible`, `internal-write`, `external-communication`,
`destructive`, `financial`, `security-sensitive`, `safety-critical` — together
with the pure `classify` function that decides which class an action lands in.

`src/types.ts` carries the types; `src/classify.ts` carries the classifier,
the ascending risk order every comparison uses, and the kernel hard-deny list.
`tests/classify.spec.ts` covers them in 16 cases. `src/index.ts` re-exports the
types and the classifier; it declares no runtime value of its own, so importing
this package executes nothing.

A plugin declares `domainTags` and nothing else: `ActionRiskSubject` has no
field through which a plugin could assert its own risk band, and the mapping
from tag to class comes entirely from the organisation policy passed in
(must[1]). Classification reports both `confidence` and `ground`, so a class
reached by a policy rule is distinguishable from the same class reached
because nothing matched (must[2]). An action no rule matches classifies at the
highest POLICY-ADJUSTABLE class rather than the lowest (must[3]), while a single
unrecognised tag beside a matched one does not escalate the whole action —
otherwise the default would fire on every real action, since no policy
enumerates every tag.

The unknown default deliberately stops short of the kernel hard-deny band.
must[3] says an unknown action defaults higher and P2-03's acceptance[2] says
an unclassifiable one defaults to high risk **and requires approval**: both
name approval, not refusal. Defaulting into the hard-deny band would equate
"we do not know what this is" with "we know this is catastrophic", so
`safety-critical` is reached by a policy that DECLARES it. An organisation
that wants unknowns refused as well adds the default class to its own
hard-deny list, which is raising its bar rather than lowering the kernel's.

`classify` is pure and total: no I/O, no clock, no ambient policy. The same
action under two policies gives two answers, and neither is a property of this
module.

## Table of Contents

- [This is a third side-effect vocabulary, deliberately](#a-third-vocabulary)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="a-third-vocabulary"></a>
## This is a third side-effect vocabulary, deliberately

`@deepseek-ai/dsh-plugin-manifest`'s `SideEffectClass` and
`@deepseek-ai/dsh-action-manifest`'s `ActionSideEffectClass` classify
**mechanism** — what an operation touches. These eight classify **risk** —
what it costs when the operation is wrong. A wire transfer and a `rm -rf` are
both `process` under the mechanism taxonomies, and are `financial` and
`destructive` here.

The vocabularies share the spellings `read` and `destructive` with different
meanings, and in `action-manifest` `destructive` is additionally the
fail-closed default returned when classification fails entirely. Any mapping
between them must therefore be total and monotone, or a plugin could choose a
mechanism tag to obtain a lower risk band.

<a id="model-experience"></a>
## Model Experience

None, as this package registers no tool, prompt text, or session event, so nothing it owns reaches a model request.

#### KV Cache effect

Nothing here enters a request, so provider cache reuse is unaffected. What a model eventually reads about a classification is whatever a consuming Consumer chooses to say, and that choice belongs to the consumer.

## Known Limitations and Deferred Work

- No runtime invariant companion is published: this package holds no state and
  observes nothing — one frozen table and one pure function over caller-supplied
  values — so a checker would compare a value against itself rather than
  reconcile two independent observations.
- **The mechanism-to-risk mapping is not declared.** Nothing here maps
  `ActionSideEffectClass` onto a `RiskClass`, so an action carrying only a
  mechanism tag classifies under the unknown default. The mapping belongs with
  `ActionSideEffectClass`, in a file Epic P2-03 owns, and lands when that
  epic's acceptance clears.
- **`hardDenied` is reported, not enforced.** `classify` states that a class
  is refused outright; no runtime in this package refuses anything, because
  the enforcement point is a Consumer's. A caller that reads `riskClass` and
  ignores `hardDenied` is not stopped by anything here.
- **`confidence` is 1 or 0, not a measurement.** It distinguishes "a rule
  decided this" from "nothing matched". Any finer grading would need a source
  of evidence this package does not have.
- **No action declares domain tags yet.** Nothing in the harness supplies a
  `domainTags` value, so every real action classifies by the unknown default.
  Until tools declare their tags, a deployment's `riskRules` decide nothing
  and the classification carries no information beyond "undeclared".

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The open question is whether `confidence` should ever be anything but 1 or 0. Today it distinguishes "a rule decided this" from "nothing matched", which is all the Contract stage can honestly report. A finer grading needs a source of evidence about how well a tag fits an action, and no such source exists yet; inventing one here would produce a number that looks measured and is not.

</details>
