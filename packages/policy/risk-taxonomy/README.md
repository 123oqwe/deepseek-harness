---
description: "The eight-class risk vocabulary and pure classifier for Epic P2-04: organisation-policy-decided mapping of plugin-declared domain tags, classification confidence and grounds, and the unknown-classifies-higher default."
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
`tests/classify.spec.ts` covers them in 14 cases.

A plugin declares `domainTags` and nothing else: `ActionRiskSubject` has no
field through which a plugin could assert its own risk band, and the mapping
from tag to class comes entirely from the organisation policy passed in
(must[1]). Classification reports both `confidence` and `ground`, so a class
reached by a policy rule is distinguishable from the same class reached
because nothing matched (must[2]). An action no rule matches classifies at the
highest class rather than the lowest (must[3]), while a single unrecognised
tag beside a matched one does not escalate the whole action — otherwise the
default would fire on every real action, since no policy enumerates every tag.

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

This package is pure types and a pure function. It contributes no tool, no
prompt text, and no session event, so it adds no tokens to a model request and
has no KV-cache effect. What reaches a model is whatever a consuming
Consumer chooses to say about a classification; that choice belongs to the
consumer, not here.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

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
  of evidence this Contract stage does not have.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The open question is whether `confidence` should ever be anything but 1 or 0. Today it distinguishes "a rule decided this" from "nothing matched", which is all the Contract stage can honestly report. A finer grading needs a source of evidence about how well a tag fits an action, and no such source exists yet; inventing one here would produce a number that looks measured and is not.

</details>
