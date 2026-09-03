---
description: "The Contract-stage type surface for Epic P6-07's session lifecycle -- listing/pagination, the retention taxonomy, deletion propagation, and corrupted-log recovery -- for maintainers picking up the RED-scaffold fix-round."
kind: "package-library"
---

# @deepseek-ai/dsh-session-lifecycle

## Summary

`dsh-session-lifecycle` fixes the type surface for Epic P6-07's session
lifecycle: tenant/workspace/status/time-filtered, cursor-paginated listing
whose cursor encodes a stable sort key so no page walk omits or duplicates a
session (must[0]/acceptance[0]); the soft-delete/legal-hold/hard-erase/archive
retention taxonomy, kept genuinely distinct rather than folded into one
deletion concept (must[1]); a structural gate that makes hard erase
impossible to authorize while a session is under legal hold
(acceptance[1]); deletion propagation to the query index, attachments,
memory, and artifacts per a declared policy (must[2]/acceptance[2]); and a
corrupted-log read that returns only the minimal recoverable prefix plus
evidence, never a fabricated full recovery (acceptance[3]).

This package currently ships this epic's Contract-stage RED scaffold only:
`src/retention.ts`'s disposition/legal-hold types and transition signatures,
`src/delete.ts`'s propagation types and hard-erase signature, and
`src/index.ts`'s listing/pagination and corrupted-log-read signatures are
real and epic-accurate, but every decision function (`archiveSession`,
`softDeleteSession`, `placeLegalHold`, `assertNoLegalHold`,
`propagateDeletion`, `hardErase`, `listSessions`,
`readSessionLogWithRepair`) throws `'not implemented: ...'` — the pure
decision logic itself is a later fix-round's deliverable, proven by
`tests/lifecycle.e2e.ts`'s real assertions against that (currently failing)
behavior. `SOFT_DELETE_POLICY` and `HARD_ERASE_POLICY` are the one
exception: real, already-correct declared data — the policies themselves —
not the adjudication logic under test.

No invariant companion is published. Every function in this package is pure
over caller-supplied data (`SessionLifecycleRecord`, `SessionDependents`, raw
log lines) — this Contract-stage slice constructs no real durable retention
store, query index, attachment store, memory store, or artifact store to
cross-reference against. A real invariant here — for example, "no session
whose durable record shows an active legal hold was ever hard-erased" —
needs a real store recording both facts independently; minting one now would
either be empty or re-derive a fact only this package's own in-memory
fixtures produce, not an independent second source. This mirrors
`@deepseek-ai/dsh-run`'s identical Contract-stage decision (first100 registry
P4-01) for the same reason.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Every export is a pure function over already-computed data — no export in
this package reads a file, spawns a process, or constructs a Cordis
`Context`; a later Provider-stage caller supplies real session records and
dependent-store inventories and calls these functions to decide and record
each lifecycle operation:

```ts
import { listSessions } from '@deepseek-ai/dsh-session-lifecycle'
import { archiveSession, assertNoLegalHold, placeLegalHold } from '@deepseek-ai/dsh-session-lifecycle/retention'
import { hardErase, propagateDeletion, HARD_ERASE_POLICY } from '@deepseek-ai/dsh-session-lifecycle/delete'

const page = listSessions(records, { filters: [{ kind: 'tenant', values: [tenantId] }], limit: 100 })
// page.nextCursor is absent once the walk has visited every matching record exactly once

const held = placeLegalHold(record, principalId, 'litigation pending', Date.now())
// held.disposition is unchanged -- legal hold is orthogonal to disposition

const proof = assertNoLegalHold(clearRecord) // throws LegalHoldBlocksErasureError if a hold is present
const result = hardErase(clearRecord, dependents, proof, Date.now())
// result.propagation.targets covers all four HARD_ERASE_POLICY target kinds
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the
observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Hard erase is an operation, never a disposition.** `SessionDisposition`
  has exactly three members — `active`, `archived`, `soft-deleted` — because
  a disposition describes a resting state a live record occupies. Hard erase
  destroys the record; modeling it as a fourth disposition value would
  invite exactly the conflation must[1] forbids. `hardErase` (`src/delete.ts`)
  is instead a one-way function returning `EraseResult`, a wholly different
  shape from `SessionLifecycleRecord`.
- **Legal hold is an independent marker, never a disposition value either.**
  A session can be `active`, `archived`, or `soft-deleted` while
  simultaneously under legal hold — folding the hold into the disposition
  union would force a false choice between the two. `LegalHold` is instead an
  orthogonal, independently-present field on `SessionLifecycleRecord`.
- **The legal-hold gate is structural (acceptance[1]).** `NoLegalHoldProof`
  mirrors `@deepseek-ai/dsh-principal`'s `AdminGrant` (first100 registry
  P2-01, this epic's predecessor): a module-private, compile-time-only
  `unique symbol` brand no plain object literal can satisfy without an
  explicit cast. `hardErase` requires one as a mandatory parameter, and the
  only producer is `assertNoLegalHold`, which throws
  `LegalHoldBlocksErasureError` when the record it is given carries an active
  hold. There is no argument position through which a caller can push a
  held session straight to `hardErase`.
- **`MemoryRef`/`ArtifactRef` are package-local, not re-minted from
  elsewhere.** No canonical branded id exists yet anywhere in this repository
  for a memory-store or artifact-store entry — no `packages/memory` or
  `packages/artifact` package exists, and `@deepseek-ai/dsh-run`'s own
  `ArtifactRef` (first100 registry P4-01, itself unlanded and not one of this
  epic's declared predecessors) answers a different question — which entity
  a Run event log cites, not which record a session's deletion must reach.
  `AttachmentId` (`@deepseek-ai/dsh-attachment`) and `SessionId` are real,
  already-shipped ids and are imported, never re-minted.
- **The listing cursor is package-local, not a reuse of
  `@deepseek-ai/dsh-session-query`'s `SessionSearchCursor`.** That brand's
  opaque encoding is owned by full-text-search pagination — a different
  pagination stream from this epic's filtered listing, which paginates over
  a stable sort key with no relevance ranking at all. Reusing the same brand
  for both would let a caller pass one cursor kind into the other's function
  without a type error, even though the two are never interchangeable. No
  change to `session-query`'s `cursor.ts` was needed: its existing shape (an
  opaque branded string with one mint function) already fully informed this
  package-local mint.
- **Pagination is keyset-based, not offset-based.** `listSessions` orders its
  candidate set by `(header.createdAt, header.id)` ascending before paging,
  so a page's `nextCursor` encodes a position in that fixed order rather than
  a numeric offset that a concurrent insert or delete could invalidate
  (acceptance[0]).
- **A deletion mode's propagation reach is declared data, not inline
  branching.** `SOFT_DELETE_POLICY`/`HARD_ERASE_POLICY` (`src/delete.ts`)
  are real, already-correct `DeletionPolicy` values — which of the four
  `PropagationTargetKind`s a mode reaches, and with what action — mirroring
  `@deepseek-ai/dsh-run`'s `LEGAL_RUN_TRANSITIONS` precedent for "declared
  facts a test checks expectations against, not the adjudication logic
  itself."

### Source map

| File | Role |
|---|---|
| [`src/retention.ts`](src/retention.ts) | The disposition/legal-hold taxonomy (must[1]) and the structural erase gate (acceptance[1]): `SessionDisposition`, `LegalHold`, `SessionLifecycleRecord`, `NoLegalHoldProof`, `LegalHoldBlocksErasureError`, and the Contract-stage RED-scaffold transition functions |
| [`src/delete.ts`](src/delete.ts) | Deletion propagation (must[2]) and hard erase (acceptance[1]/[2]): `PropagationTarget`, `DeletionPolicy`, `SOFT_DELETE_POLICY`/`HARD_ERASE_POLICY` (real), and the Contract-stage RED-scaffold `propagateDeletion`/`hardErase` |
| [`src/index.ts`](src/index.ts) | Listing/pagination (must[0]/acceptance[0]) and corrupted-log recovery (acceptance[3]); re-exports `./retention.ts` and `./delete.ts`'s public surface |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/lifecycle.e2e.ts`](tests/lifecycle.e2e.ts) — the Contract-stage RED
  scaffold: one or more cases per registry must[]/acceptance[] clause,
  including an exhaustive page-size sweep for acceptance[0]'s pagination
  guarantee.
- `@deepseek-ai/dsh-principal` (`../../identity/principal/src/types.ts`,
  `../../identity/principal/src/chain.ts`) — this epic's predecessor (first100
  registry P2-01); source of `TenantId`, `PrincipalId`, and the `AdminGrant`
  pattern `NoLegalHoldProof` mirrors. This package has no README yet itself
  (a pre-existing, already-documented gap — unrelated to this epic, not
  fixed here).
- [`@deepseek-ai/dsh-session`](../../core/session/README.md) — source of
  `SessionId`/`SessionHeader`/`SessionEvent`; `packages/core/session/src/repair.ts`
  is a distinct, already-shipped crash-recovery mechanism (an interrupted
  tail write) this package's corrupted-log read (a different failure mode:
  an unparseable record anywhere in the log) does not call into.
- [`@deepseek-ai/dsh-workspace`](../../workspace/workspace/README.md) —
  source of `WorkspaceId`.
- [`@deepseek-ai/dsh-attachment`](../../attachment/attachment/README.md) —
  source of `AttachmentId`.
- `@deepseek-ai/dsh-run` — this repository's other Contract-stage
  pure-decision package (first100 registry P4-01, not yet landed on this
  branch, so unlinked here), followed here for package layout, the "declared
  policy/table data" idiom, and the "no invariant companion yet" rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package exports types and pure lifecycle-function signatures only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No wiring into real durable storage, a real query index, or Cordis
  registration exists yet.** This package alone cannot list, page, delete,
  retain, or repair a real session — a later Provider/Usage-stage supplies
  real records and dependent-store inventories from the packages that own
  them (`packages/session/session-persistence`, `packages/session-query/session-query`,
  `@deepseek-ai/dsh-attachment`, and this epic's still-unbuilt memory and
  artifact stores).
- **`packages/session-query/session-query/src/cursor.ts` was read, not
  modified.** Its existing `SessionSearchCursor` shape (an opaque branded
  string with one mint function) fully informed this package's own
  `SessionLifecycleCursor` — see this README's Design philosophy above for
  why the two are deliberately separate brands rather than one shared type.
- **`NoLegalHoldProof` is compile-time-only, like `AdminGrant`.** It is
  defeatable by an explicit `as` cast, the same documented limit
  `@deepseek-ai/dsh-principal`'s `AdminGrant` already carries. Real
  revocation-race enforcement (a hold placed concurrently with an in-flight
  erase) needs a real durable retention store, which is a later stage's job.
- **`MemoryRef`/`ArtifactRef` are not reconciled with any real store's id
  type.** No memory or artifact store package exists yet anywhere in this
  repository for a later stage to reconcile against.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
