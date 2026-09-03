---
description: "The type surface and TrustKernel-gated decision functions for Epic P2-02's attenuable Capability Token and sub-agent delegation: issuance, verification, narrowing-only attenuation, cascading revocation, a presence gate, and log-safe redaction."
kind: "package-library"
---

# @deepseek-ai/dsh-capability-token

## Summary

`dsh-capability-token` ships the type surface and decision functions
for Epic P2-02's attenuable Capability Token: the closed
`subject`/`tenant`/`capability`/`verbs`/`resources`/`constraints`/`expiry`/
`nonce`/`delegationDepth`/`parentDigest` token shape (must[0]); a
TrustKernel-gated issuance and verification surface, so only the real Trust
Kernel ever produces or accepts a signed token (must[1]); attenuation that
can only narrow a child token's `verbs`/`resources`/`constraints.budget`/
`expiresAt` relative to its parent, never widen them (must[2]/
acceptance[0]); and a presence gate the four consumer surfaces this epic
names — tools, plugin RPC, external Agents, and the ExecutionWorld — must
all pass before acting (must[3]). Cascading revocation across a delegation
chain (acceptance[1]) and log-safe redaction that never lets the raw token
reach a log or model-visible surface (acceptance[2]) round out the decision
surface.

`src/types.ts` carries the types and brand constructors; `src/attenuate.ts`
carries seven working decision functions (`issueToken`, `verifyToken`,
`attenuateToken`, `digestToken`, `isTokenRevoked`, `assertTokenPresented`,
`redactTokenForLog`), covered by `tests/token.spec.ts` in 36 cases. Token
digests are real SHA-256 over a canonical field list; token *signatures* are
a fixed marker byte sequence, because `TrustKernelSignatureRoots` carries no
key material — see [Known Limitations](#known-limitations-and-deferred-work).

No invariant companion is published because this package
constructs no token registry, nonce ledger, or revocation store to
check an owned relation over: `verifyToken`'s replay check and
`isTokenRevoked`'s cascading check both take their `seenNonces`/
`revokedDigests` sets as caller-supplied pure data, not from a durable
store this package owns. A real invariant — for example, "every
`CapabilityTokenLogRecord` this deployment has ever logged names a digest
some token this deployment actually issued or attenuated produced" — needs
this epic's Provider-stage registry (`src/index.ts`) and the real durable
store it builds; minting one here would either be empty or re-derive a fact
only this package's own in-memory fixtures produce, not an independent
second source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Every export in this package is a pure function over already-computed data
and a real `TrustKernelSignatureRoots` handle — no file, process, or Cordis
`Context` access:

```ts
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { attenuateToken, issueToken, verifyToken } from '@deepseek-ai/dsh-capability-token/attenuate'
import { CapabilityName, CapabilityTokenNonce, TokenBudget } from '@deepseek-ai/dsh-capability-token/types'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'

const { signatureRoots } = createTrustKernel()

const parent = issueToken(signatureRoots, {
  subject: PrincipalId('parent-agent'),
  tenant: TenantId('acme'),
  capability: CapabilityName('fs'),
  verbs: ['read', 'write'],
  resources: ['file:///workspace/a'],
  constraints: { budget: TokenBudget(1000) },
  expiresAt: Date.now() + 60_000,
}, CapabilityTokenNonce('root-nonce'))

// A child requesting the parent's exact budget is legal; one unit more is not.
const decision = attenuateToken(signatureRoots, parent, {
  subject: PrincipalId('child-agent'),
  verbs: ['read'],
  resources: ['file:///workspace/a'],
  constraints: { budget: TokenBudget(1000) },
  expiresAt: Date.now() + 30_000,
  nonce: CapabilityTokenNonce('child-nonce'),
})
// decision.accepted === true

const verification = verifyToken(signatureRoots, parent, { now: Date.now(), seenNonces: new Set() })
// verification.verified === true
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package; the
observable type contract is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **`PrincipalId`/`TenantId` are reused, never re-minted.** Both come from
  `@deepseek-ai/dsh-principal/types` (Epic P2-01, already accepted), so a
  token's `subject`/`tenant` name the same identity universe a
  `Principal`/`IdentityContext` already carries.
- **Only a real `TrustKernelSignatureRoots` handle can drive issuance,
  verification, or attenuation.** `issueToken`, `verifyToken`, and
  `attenuateToken` all take one as their first parameter — mirroring Epic
  P1-02's `@deepseek-ai/dsh-plugin-provenance/signature`'s
  `registerTrustAnchor`/`verifyPackageSignature` — so must[1]'s "TrustKernel
  签发/验证" is enforced by which functions a caller can even reach a
  successful call through, not by a runtime role check this package would
  otherwise have to trust a caller's self-report of.
- **A child token's `tenant`/`capability` are inherited, never
  requestable.** `TokenAttenuationRequest` has no `tenant`/`capability`
  field at all — `attenuateToken` copies both from the parent it is given.
  "Attenuate into a different tenant or capability" is therefore not a
  request this type can express, a stronger guarantee than a runtime
  tenant/capability-match check would give, and it collapses what would
  otherwise be two more `TokenAttenuationDenialReason` variants
  (`'tenant-mismatch'`/`'capability-mismatch'`) to zero.
- **`verbs`/`resources` are symmetric, empty-is-narrowest sets.** Both are
  plain `readonly string[]`, both subset-checked by `attenuateToken` the
  same way, and an empty array authorizes nothing under that field — never
  "unrestricted". This is the fail-closed reading; the alternative would
  make the narrowest-looking value the widest one.
- **Every decision function is pure.** Timestamps (`expiresAt`, `now`),
  nonces, and lineages are all caller-supplied, mirroring
  `@deepseek-ai/dsh-run/events`'s `occurredAt` idiom — none of these
  functions read a clock, generate randomness, or touch a store.
- **Revocation is a caller-supplied lineage check, not a store lookup.**
  `isTokenRevoked` takes the token's complete root-to-self digest chain
  (`TokenLineage`) and a revoked-digest set, both pure data. A real
  Provider-stage token store walks `parentDigest` hops to assemble the
  lineage (I/O this Contract stage's pure functions cannot do); this stage
  only fixes the shape of the membership check that makes acceptance[1]'s
  cascading invalidation a one-line set-intersection, however many
  attenuation hops separate a revoked ancestor from the token being
  checked.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The Capability Token type surface: `CapabilityToken`, `SignedCapabilityToken`, `TokenConstraints`, `TokenLineage`, every issuance/verification/attenuation request and decision type, and the `CapabilityName`/`CapabilityTokenNonce`/`CapabilityTokenDigest`/`TokenBudget` brand constructors |
| [`src/attenuate.ts`](src/attenuate.ts) | The TrustKernel-gated decision-function surface: `issueToken`, `verifyToken`, `attenuateToken`, `digestToken`, `isTokenRevoked`, `assertTokenPresented`, `redactTokenForLog` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`tests/token.spec.ts`](tests/token.spec.ts) — 36 cases: one per
  must[]/acceptance[] clause, with acceptance[0]'s
  four narrowable dimensions each covered by an exact-boundary pair (the
  parent's own limit, legal; one unit past it, illegal) plus a
  strictly-narrower positive case.
- `@deepseek-ai/dsh-principal` (`packages/identity/principal`) — this
  package's source for `PrincipalId`/`TenantId` (Epic P2-01, already
  accepted; this package has no README of its own yet).
- [`@deepseek-ai/dsh-trust-kernel`](../../kernel/trust-kernel/README.md) —
  this package's source for `TrustKernelSignatureRoots` and the real
  `createTrustKernel()` this package's own tests call to obtain one.
- `@deepseek-ai/dsh-run` (`packages/run/run`, Epic P4-01) and
  `@deepseek-ai/dsh-plugin-provenance` (`packages/plugin/plugin-provenance`,
  Epic P1-02) — this repo's other Contract-stage pure-decision packages,
  followed here for package layout and (for provenance) the
  TrustKernel-handle-as-gate idiom.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package exports types and pure decision functions
only and registers nothing model-facing. No export's return value is safe to
place directly into model-visible text — only
`redactTokenForLog`'s narrow, six-field output (acceptance[2]) is intended
to ever reach a log or model-visible surface.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A token signature is a fixed marker, not cryptography.** `issueToken`
  and `attenuateToken` sign with the constant bytes `01 02 03 04`, and
  `verifyToken` accepts any signature equal to them, so a signature binds
  nothing to a token's contents: an attacker who edits `verbs`, `resources`,
  or `expiresAt` and reattaches those four bytes passes `verifyToken`. The
  `trustRoot` parameter is unread in all three functions — holding a real
  `TrustKernelSignatureRoots` handle is a compile-time gate on who can call
  them, not a runtime check. `TrustKernelSignatureRoots` carries no key
  material pending the vendored Cordis `Fiber` fix
  (`docs/architecture/trust-kernel-boundary.md`).
- **No wiring into real durable storage or Cordis registration exists
  yet.** `packages/policy/capability-token/src/index.ts` is a plain barrel
  re-exporting `types`/`attenuate`, and
  `packages/core/agent-loop/src/runtime-context.ts` does not call into this
  package — this package alone cannot issue a token a real sub-agent
  delegation, tool call, plugin RPC, or ExecutionWorld boundary would
  actually enforce. `verifyToken`'s replay check and `isTokenRevoked`'s
  cascade both read caller-supplied sets, so nothing here persists a seen
  nonce or a revoked digest between calls.
- **`packages/kernel/trust-kernel/src/types.ts` was read, not modified.**
  This epic's file scope lists that file as a Contract-stage read (kind
  `P`) for the `TrustKernelSignatureRoots` handle's shape. No additive
  change to it was needed: every issuance/verification/attenuation function
  in this package already gates on that existing handle type, matching Epic
  P1-02's `@deepseek-ai/dsh-plugin-provenance/signature`'s identical
  precedent against the same file.
- **`packages/subagent/subagent/src/descriptor.ts` was read, not
  modified.** This epic's file scope lists that file as a Contract-stage
  read (kind `B`) for the sub-agent delegation framing must[0]'s
  `delegationDepth`/`parentDigest` names. No additive change to it was
  needed: a delegated child's authority is carried by which
  `SignedCapabilityToken` its parent hands it at delegation time (this
  package's own concern), not by a new durable field on the descriptor
  event — the descriptor already identifies a session-backed child by its
  own identity plus, on the live call, the parent's authorization, and adds
  no capability-token reference of its own to reconcile against. Should a
  later stage find a genuine reason to add one, that is that stage's change
  to make and justify, not this one's.
- **Resource narrowing is exact-value subset only.** `attenuateToken`'s
  `'resources-not-subset'` check treats `resources` as a plain set of exact
  string values — a child requesting `file:///workspace/a/foo.txt` against a
  parent scoped to `file:///workspace/a/*` is refused, not recognized as
  narrower. Glob- and prefix-aware resource-pattern narrowing is a later
  stage's job.

-----

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

None.

</details>
