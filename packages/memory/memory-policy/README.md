---
description: "P6-03 memory proposal policy for choosing, configuring, or debugging what becomes of a candidate memory write: auto-accept, human review, or reject, with a per-deployment review-confidence threshold."
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-policy

English | [中文](README.zh.md)

## Summary

This package decides what happens to a candidate memory write before it can be recalled: auto-accept it into active memory, hold it for human review, or reject it. Sensitive content, and content whose sensitivity nobody assessed, always go to review; a weakly-inferred (`derived`) claim below a per-deployment confidence bar goes to review; a normal, sufficiently-evidenced write is auto-accepted. Mount it wherever you mount `memory` — the base bundle ships it enabled, so a profile that turns `memory` on inherits it. Tune `reviewBelowConfidence` for how strict the store should be.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `memory`; `@deepseek-ai/dsh-memory`'s `propose` path reaches it through `ctx.get('memoryProposalPolicy')` and acts on the disposition it returns. The common path is to leave the default threshold in place and let normal writes auto-accept while sensitive and unassessed ones wait for a reviewer.

### When to choose it

The base bundle ships this plugin enabled, so you rarely mount it by hand — you get it whenever a profile enables `memory`. Raise `reviewBelowConfidence` for a shared store that should send more inferred claims to review; lower it for a personal store. Disabling it while `memory` is on is not a way to loosen the policy: `propose` then fails closed and holds every write for review.

### Minimal configuration

The plugin needs no configuration — the review-confidence bar defaults to 0.5.

```yaml
- id: memory-policy
  name: '@deepseek-ai/dsh-memory-policy'
```

| Field | Default | Meaning |
|---|---|---|
| `reviewBelowConfidence` | `0.5` | A `derived` claim whose writer confidence is below this goes to review rather than active memory |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-policy) is the exhaustive source for every accepted field and its JSDoc.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The observable behavior is fully covered in [Use this package](#use-this-package); this section explains the design and points at the code.

### Design philosophy

The decision is a pure function, `decideProposal`, kept apart from the service that applies it: the function reads only the proposal's own stated facts and the deployment's thresholds, so it is testable without a Context and cannot depend on anything else. The service is a thin provider that mounts `ctx.memoryProposalPolicy` and applies the function with its validated `Config`. Acting on a decision — storing `pending` or `active`, or refusing — belongs to `dsh-memory`'s `propose`, not here, and whether a claim traces to anything is P6-02's `isTraceable`, applied before this runs.

### Fail-closed by construction

`decideProposal` decides sensitivity before confidence, because a sensitive claim goes to review however sure its writer is, and treats an unstated sensitivity the same way active memory's index does — not admissible. `dsh-memory`'s `propose` completes the fail-closed stance: with no `memoryProposalPolicy` mounted it holds every write as `pending`, so a deployment cannot loosen the policy by removing it.

### Source map

| File | Role |
|---|---|
| [`src/proposal.ts`](src/proposal.ts) | The pure `decideProposal` and its decision/threshold types |
| [`src/index.ts`](src/index.ts) | Package entry: `MemoryProposalPolicyService` (mounts `memoryProposalPolicy`) and its `Config`, declared here so the config-catalog generator finds them, plus the `decideProposal` re-export and the decision types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the package-level contract is not enough.

- [`@deepseek-ai/dsh-memory`](../memory/README.md) — the seam whose `propose` consults this policy, and where the decision is acted on.
- [memory/ package map](../README.md) — the group and its packages.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-memory-policy) — every accepted config field and its meaning.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no prompt, schema, tool, or session event; its decision reaches a model only as the absence of a withheld (`pending`) record from `@deepseek-ai/dsh-memory-context`'s recall, which that package renders.

#### KV Cache effect

None. The policy runs at write time, decides a disposition, and adds nothing to any model request; a `pending` record is simply withheld from later recall until approved, so no request prefix changes on its account.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`must[0]` completeness and the review lifecycle are now built; conflict and erasure are the third slice.** Beyond sensitivity and confidence, this policy now holds a proposal that omits its intended use (`purpose`) or its TTL (`validUntil`) for review — an omitted `validUntil` is distinct from a stated `validUntil: null` ("no expiry"). `@deepseek-ai/dsh-memory` gained the review verbs a person acts on the held proposal with — `listPending`, `approve`, `reject` — where only a user principal decides. Still deferred, to the third slice: merge/supersede (a conflict decision), forget with a tombstone, and export carrying provenance and conflict status (`must[3]`, `acceptance[1]`, `acceptance[2]`).
- No runtime invariant companion is published: the service is stateless and owns no relation two observers could disagree about — it applies the pure `decideProposal` per request and stores nothing — so a checker would have nothing to reconcile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context, explicitly non-authoritative. The second slice adds the review lifecycle and the propagation rules; when it lands, the `reviewBelowConfidence` bar may need companion thresholds (for example a distinct bar for a shared versus a personal store), which is why the single field is validated `Config` rather than a constant.

</details>
