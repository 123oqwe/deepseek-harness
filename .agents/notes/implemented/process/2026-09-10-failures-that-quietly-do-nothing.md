# Agent Note: Failures that quietly do nothing are not found by reading the code

Status: implemented

English | [中文](2026-09-10-failures-that-quietly-do-nothing.zh.md)

## Problem

Threading `delegatingSession` through the persistent subagent descriptor needed five edits: the type, the `CONTINUABLE_DESCRIPTOR_KEYS` whitelist, the snapshot write, `parseSubagentDescriptor`'s field-by-field rebuild, and the reactivation read in `continuation.ts`. Four were made after reading the path end to end and concluding every link was wired. The value was still `undefined` on every cold resume.

The fifth place was `parseSubagentDescriptor`, which rebuilds the payload field by field and silently drops anything not on its list. Reading the code did not find it, because finding it required suspecting that a fifth link existed at all. A probe written directly above the derivation found it in one run:

```
applyComposition delegating=detached-run-session parent=cold-delegating-parent
applyComposition delegating=undefined            parent=cold-delegating-parent
```

Three defects in this program share that shape, and all three present externally as correct behavior:

- `static inject = [..., 'agents']` on the workflow engine. A missing hard dependency makes Cordis not register the service **at all**, so every composition without an agent registry lost the whole engine. The 53 resulting failures reported `unknown tool "workflow"` and `reading 'start' of undefined`; none named `inject`.
- `parent.dispose?.()`. `dispose` lives on `AgentHandle`, not on `Agent`, so the optional chain made the call a no-op and a detached case passed with its launcher never ending. Repo-wide typecheck named it; the test could not.
- A durable field written but never rebuilt on read, above.

Two further measurement errors made the same class harder to see. `console.error` probes prove nothing in this repo — vitest does not forward console output for passing tests, so "it printed nothing" was read as "it did not run" when the probe had in fact run. And `expect(x.isRevoked?.(token) ?? true)` is an assertion that passes when the mechanism is absent, so it tested nothing about the mechanism.

## Decision

Three practices, each of which would have caught the above at the point it was introduced:

**A value that must survive a boundary is proved by observation at the far side, not by tracing the writes.** For durable fields the far side is a read after a real restart — not a same-context reactivation, which is a hot path that never opens the descriptor.

**Silence from a probe is evidence only after the probe is proved to fire.** Run it first on a case known to reach the line; if that prints nothing, the probe is broken, not the code. In this repo that means `appendFileSync`, not `console`.

**An assertion must fail when the mechanism is absent.** `?.()`, `?? true`, and optional-property reads inside expectations all convert "not there" into "passed". Assert at the call, on the observed effect.

The mechanical half is `SUBAGENT_DESCRIPTOR_FIELDS` plus the round-trip case in `service.spec.ts`: the legal-field list and the rebuild are two lists that must agree, and the case now drives the payload from the first so a new field cannot be covered by omission.

## Alternatives considered

**Pin `delegatingSession` alone with a regression case.** Rejected: it closes the one field and leaves the next one to be found the same way. The defect is the disagreement between two lists, so the guard belongs on the disagreement.

**Derive the accepted field list by reflecting over the parser.** Rejected: the parser's acceptance is expressed as straight-line code with no runtime list to read, and introducing one purely for the test would move the same duplication somewhere less visible.

**Require repo-wide typecheck after every edit.** Already required after cross-package signature changes, and it caught `parent.dispose?.()`. It cannot catch an unwritten field: `undefined` is a legal value of an optional field, so nothing is ill-typed.

## Consequences

Bought: a durable-field gate with teeth — removing the rebuild fails the equality, and adding a field to the whitelist alone fails the sample assertion naming the new field. `SUBAGENT_DESCRIPTOR_FIELDS` gives the test the schema to drive from.

Cost: one new public export whose only consumer is a test. It is exported rather than kept private because the alternative (a hand-written payload) is precisely what allowed a field to be added without coverage. The sample map must gain an entry when the schema does; that is the gate, not an inconvenience.
