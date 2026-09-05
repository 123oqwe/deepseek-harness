---
description: "Registered workflow definitions and nested-run limits for Epic P4-09: content-digest identity, monotonic per-name versions, run references that pin a digest rather than a name, registration-time recursion refusal, and nested budget decay under depth, agent and token ceilings."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-registry

## Summary

`dsh-workflow-registry` gives a workflow definition a stable identity and bounds what its nested runs may consume. `src/types.ts` holds the registered definition, the reference a run records, and the nesting decision; `src/version.ts` holds the digest, the version rules, and registration-time recursion refusal.

## Table of Contents

- [A run pins a digest, not a name](#a-run-pins-a-digest-not-a-name)
- [Loading executes nothing](#loading-executes-nothing)
- [Recursion is refused before depth is consulted](#recursion-is-refused-before-depth-is-consulted)
- [A nested budget decays](#a-nested-budget-decays)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## A run pins a digest, not a name

A name can be repointed at different code; a digest cannot. A run recorded against a name could not be reproduced, so `RunDefinitionRef` carries the digest — and the name too, because a report identified only by a hash forces every operator to resolve it.

The digest is computed over the **body alone**. Including the name or version would give one source two identities, and a run recorded under either could not be recognized as the same work.

`canResumeAgainst` answers by digest and never by version: a newer version under the same name does not make an old run resumable, because that is different code the run never referenced. Upgrading is a deliberate migration.

## Loading executes nothing

A definition's `body` is `string`, and every function here either hashes it or pattern-matches it. Nothing parses, evaluates, or instantiates it, so a definition whose body would throw or exfiltrate if evaluated registers and resolves exactly like any other — which is what acceptance[0] asks, and a covered case demonstrates with a hostile body.

`declaresNestedCall` is a textual check for the same reason. Parsing would mean building an evaluator, and over-reporting is the safe direction: a false positive refuses a registration a human then inspects, while a false negative admits a definition that recurses forever at run time.

## Recursion is refused before depth is consulted

`admitNestedRun` looks for the child's digest on the ancestor chain **first**. A depth limit does eventually halt a recursive definition, but it reports the same failure for a workflow that calls itself and for one that is merely deeply composed — and those need different responses. Reporting depth for a self-call would tell an operator to raise a limit when the real defect is a definition that never terminates.

## A nested budget decays

A child receives what remains, minus the call that started it, clamped to the deployment ceiling. Passing the parent's budget through unchanged would let every run in a tree believe it holds the full allowance, and the total would be bounded by nothing.

## Model Experience

No model-visible surface. The package exports decision functions and types; it renders no prompt text, defines no tool, and contributes no session event, so it consumes no tokens and cannot affect KV-cache reuse.

## Known Limitations and Deferred Work

- **The signer is recorded, never verified.** `SignerIdentity` is provenance a registration claims. Whether it is genuine is `@deepseek-ai/dsh-plugin-provenance`'s question, and today that cannot be answered — `verifyPackageSignature` trusts a first-seen issuer (P1-02's acceptance lock). Nothing here may be read as evidence a definition's signature is real.
- **Recursion detection is textual and single-hop.** `isSelfRecursive` finds a definition that nests its own name. A cycle through two definitions (A nests B, B nests A) is not detected at registration; `admitNestedRun`'s ancestor check catches it at run time.
- **No store.** Registration and resolution are decisions over data the caller supplies; nothing persists a registry.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The token budget is clamped but not decremented per nested run, unlike the agent budget. That asymmetry is deliberate for now — an agent call is a countable event at nesting time, while token consumption is only known afterwards — but it means a wide tree of nested runs can each inherit the same token allowance. Whether the parent should reserve a share up front, or the ceiling should be enforced by a running total the runs report into, is undecided.

</details>
