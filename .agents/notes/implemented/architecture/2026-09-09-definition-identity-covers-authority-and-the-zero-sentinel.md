# Agent Note: A workflow definition's identity covers what it may do, and a sentinel passed on unresolved stops a nested run dead

Status: implemented

English | [中文](2026-09-09-definition-identity-covers-authority-and-the-zero-sentinel.zh.md)

## Problem

P4-09 must[3] requires a nested workflow run to inherit and DECAY its capability token the way it already decays budget and worker limits. Two measurements, taken before writing code, changed what that meant.

**A nested run has no session of its own.** `startNested` admits the run and then launches it with `parent: parent.parentAgent` — the same `Agent` as the run above it. No session is created for a run anywhere in `workflow-worker-thread`. Model work happens one level down, where `startChild` calls `subagents.start(...)` and THAT child gets a session, on the path P2-02.U already wired to `deriveChild`. So the derivation this slice was going to add already ran; what did not happen was any decay, because `startChild` passed no `toolFilter` and a child of a nested run held exactly what a child of the root run held.

**The digest covered the body alone.** `computeDefinitionDigest` hashed `body` and nothing else, and `meta` cannot carry a declaration either: it is a closed field set that arrives on the REQUEST, and `assertBodyParses` rejects a body containing `export const meta`. A declaration stored beside the digest would leave the same body re-registrable under another name with a wider declaration and the same digest, so a bound derived from it would be widenable by re-registration.

## Decision

**A definition's identity is what it is and what it may do.** `RegisteredDefinition` gains `tools?: DefinitionToolDeclaration`, and `computeDefinitionDigest(body, tools)` hashes both under a canonical encoding: `allow` de-duplicated and sorted, every part length-prefixed so no concatenation is ambiguous. Order and repetition cannot change an identity; content can. This is a format change — every registered digest moves — which the pre-release stance permits and prefers over a shim.

An ABSENT declaration and an EMPTY one are deliberately different digests, because they mean opposite things: absent inherits the parent run's bound, `[]` is a run that may use no tools. Encoding them alike would make the most restrictive declaration unrepresentable, since it would read as "inherit everything".

`inheritToolBound` intersects at every level and only ever narrows: naming a tool an ancestor gave up grants nothing. The host applies the run's bound as `toolFilter` on every `subagents.start`, reaching the existing `deriveChild`. `ChildStartRequest` gains no such field — that request crosses the port FROM the worker, and a script naming its own filter would be choosing its own authority.

**A subagent is an attribution rule, not a retry or authority layer of its own** — recorded in P4-11's preFlight from the same session's measurement, and the reason the bound belongs to the run rather than to anything the child asks for.

## Alternatives considered

**Inherit-and-intersect with a caller-side declaration at the `workflow()` hook.** Rejected for now: `NestedStartRequest` carries no declaration, so at depth 1 the first version would decay nothing measurable, and the case proving it would observe an intersection of two identical sets — the shape 4.4a exists to reject. It remains addable later; must[3] does not need it.

**A sibling `tools` field outside the digest.** Rejected on measurement: it is exactly the widenable-by-re-registration hole described above.

**Recompute the bound from the parent's live token instead of storing it.** Rejected: a resumed run has no live parent, and the bound has to survive an interruption (below).

## The `resume` widening, closed in the same change

`resume` launched with no `nested`, so a resumed run recovered neither its ancestors, its decayed budget, nor its bound. For the first two that was a long-standing looseness; for the bound it is a WIDENING — an interrupted nested run comes back able to use tools its definition excluded. All three were missing for one reason: nothing persisted them. `WorkflowJournal` gains `nesting?: RunNesting`, written in the run's own durable record and read back by `resume`; the recorder falls back to the seed's nesting so the first persist after a resume does not erase what the resume just recovered.

## The zero sentinel: a nested run could not spawn an agent at all

`maxConcurrentAgents: 0` is a SENTINEL meaning "derive it from the host", resolved only on the root path. `startNested` passed the RAW configuration value as the parent's limits, `inheritWorkerLimits` copied it unchanged, and `nested?.limits.maxConcurrentAgents ?? …` could not rescue it because **zero is not nullish**. The nested worker started with a concurrency of zero: it announced ready and then waited forever for a slot that could not exist. No error, no child, no result.

Six nesting cases passed throughout, because not one of them spawned an agent inside a nested run — so every clause resting on nesting (acceptance[0]–[3], must[3]'s budget, token and trace decay) rested on a property nothing had checked. The sentinel is now resolved once, in `resolvedConcurrency()`, and both call sites use it.

**This is the counter-example to [`AGENTS.md`](../../../../AGENTS.md#conventions)'s "Explicit > implicit at package boundaries": defaulting is an explicit `resolve(request): Spec` step, never a hidden `?? default`.** The defaulting here was hidden twice over — the sentinel's meaning lived inside one expression in `launch`, and the fallback was a `??` that a zero walks straight past. Naming it is the point: this was not bad luck, it was the failure the rule predicts.

Isolating this took four probes, each changing one variable: a nested run without `agent()` passes; a nested run with `agent()` and no declaration hangs; a ROOT run with `agent()` passes; a nested run with `agent()` and no token plugin mounted at all hangs. The fourth removed capability tokens from the picture entirely.

## Consequences

Nine cases in [`nested-run.spec.ts`](../../../../packages/workflow/workflow-worker-thread/tests/nested-run.spec.ts) hold this, including the baseline that a nested run can spawn and settle, the declaration narrowing a real child's token, and the depth-2 intersection — the case depth 1 cannot show, because with one declaration an intersection is indistinguishable from an assignment. Four digest cases in [`registry.spec.ts`](../../../../packages/workflow/workflow-registry/tests/registry.spec.ts) hold the identity: a wider declaration changes the digest, reordering and repetition do not, absent differs from empty, and a registration whose digest omits its declaration is refused.

**Two verification lessons, both measured here rather than reasoned about.**

A cross-package signature change needs the REPOSITORY-wide `typecheck`. A package's own `tsc` resolves workspace imports through project references to a possibly stale `lib/types` and passes on the old signature; vitest strips types, so the missing arguments arrive as `undefined` and the behaviour happens to equal "unbounded", which keeps the tests green. Both layers missed a five-argument call to a seven-argument function; only the repo-wide gate caught it.

A `console.error` probe proves nothing in a passing test — this repo's vitest does not forward console output for tests that pass, so "it printed nothing" is not evidence. A probe must be shown to fire on a case known to reach the code before its silence is read as a result; writing to a file with `appendFileSync` is what made these probes valid.
