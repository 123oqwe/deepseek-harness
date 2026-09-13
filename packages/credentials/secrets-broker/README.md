# @deepseek-ai/dsh-secrets-broker

Secret-lease vocabulary and state machine for Epic P3-06.

A `CredentialRef` names a stored credential. A `SecretLease` is what that ref resolves to for one use: a grant bound to a `Principal`, an `ActionId`, a `WorldId`, a recorded purpose and an expiry instant. All five are must[0]'s literal list, and each names an existing subject — a second vocabulary for the same facts would let two parts of the system disagree about which action a lease is for.

## What a lease decides

`decideRedemption` answers *may this lease be redeemed now*, and returns the credential or one closed reason it refused. Expiry is tested before the bindings and before the stored state: an expired lease refuses for being expired whoever presents it, so a refusal cannot tell a caller that some other principal would have matched.

Expiry is a fact about the clock rather than an event someone records. `effectiveState` reads a stored `issued` record as `expired` once `expiresAt` has passed, with no sweeper having run — which is what makes an expired lease unusable on the replay path, where by definition nothing swept.

Use revokes (must[2]): `afterRedemption` returns the record in `redeemed`, and the same lease presented again refuses. A stopped world ends every grant inside it, whatever each lease's own expiry says — `revokeWorldLeases` is that cascade, as a pure function of the records and the world id.

A terminal state is never rewritten. The first reason a lease stopped being usable is the one an audit keeps.

## Model Experience

No model-visible surface. This package decides; it renders nothing and adds no tool, prompt or session event.

## Known Limitations and Deferred Work

- **must[1], brokered injection, is not modelled.** A secret reaching a world without the ambient environment needs `WorldSecretsSpec.posture: 'broker-only'`, which `execution-world/src/local-provider.ts` refuses: only a separate address space can keep that promise. The transport waits on that shape; this package is the grant.
- **acceptance[1]'s leak surfaces are not covered here.** Whether a secret stays out of stdout/stderr, crash dumps and the session log is a property of the writers, not of the lease. The session-log half in particular has no redaction seam today — `session-telemetry`'s waterfall covers records sent to a backend and ships no rules.
