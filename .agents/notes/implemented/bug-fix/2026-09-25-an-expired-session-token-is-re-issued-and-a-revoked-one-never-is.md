# Agent Note: An expired session token is re-issued, and a revoked one never is

Status: implemented

English | [中文](2026-09-25-an-expired-session-token-is-re-issued-and-a-revoked-one-never-is.zh.md)

## Problem

BLOCKED-331. A session token lives `sessionTokenTtlMs` (24 hours by default), and the provider re-issued a root only when the session held none or its tools had grown. A session that outlived its token kept running while every tool call was refused as expired, and nothing renewed it. A delegated token carries its parent's expiry and was never re-derived at expiry, and attenuation did not check the parent's expiry, so a child started after its parent's token expired was born expired. `revokeSession` dropped the session's token from memory, so its calls were refused as presenting no token rather than as revoked, and a restarted mount issued the revoked session a fresh root. Lane A measured the root, child and workflow cases on the shipped headless profile (A-372, A-390, A-390b).

## Decision

- **At expiry the token is re-issued under the same policy, and the session is not ended** (the delegate's ruling). `whenSessionToken` asks at each call whether the held token has expired. A root is re-issued with the same subject, tenant, capability and verbs, and with resources read from the registry at that moment. A delegated token is re-derived under the same filter from its parent's current token, which is renewed first.
- **One renewal at a time per session.** A caller arriving while a session's issuance or re-derivation is in flight waits for it, so parallel children re-deriving from one expired parent mint one parent token and all derive from it.
- **Revocation is final.** `revokeSession` leaves the session holding its revoked token, and the tool gate refuses it as revoked. `needsIssue` and the re-derivation skip a revoked token. Minting a root or deriving a child first asks the durable record whether any token of that session was revoked, right before the service records the new token, so a restarted mount issues nothing either. Nothing is derived from a revoked parent.
- **The gate asks revocation before expiry.** An expired token is renewed and a revoked one is not, so a token that is both stays refused as revoked.
- **`CapabilityTokenService.attenuate` takes the time** and refuses a parent that has expired at that time as `parent-expired`, so no child is minted already expired. The time is a parameter, as it is for `verify`, which is how the service case injects it.
- **Inside a `run_code` program the token is not renewed, and the refusal says so.** A program presents the token of the `run_code` call that started it for its whole run (`ptc.ts`), and P2-05's policy decides the program's calls on that same token. Renewing it inside the program would split the authority a call presents from the authority the policy decided on. An expired refusal of a call a program made names the program and says that the next `run_code` call presents a re-issued token.

## Alternatives considered

- **End the session at expiry, with a reason.** Not chosen by the delegate: no P2-02 clause asks for it, and it would cap every long-lived host at the TTL.
- **Re-issue inside the program.** Not chosen, for the policy reason above.
- **Check the parent's expiry in `attenuateToken`.** Not chosen: the decision functions take no time; the service already takes the time for `verify`.
- **Keep dropping the token at revocation and let the gate refuse a missing one.** That was the old behavior: the refusal read as "none was presented", and every new issuance path would have had to remember not to re-issue.

## Consequences

- A long-lived session keeps working past the TTL. Each re-issue records one root, so the store grows by one root per TTL for each active session.
- A native dispatch presents one token for every call of its step, so a call that starts after that token expired is refused as expired; the next dispatch presents a re-issued token.
- A delegated session whose parent session has ended cannot be re-derived when its token expires, and its calls are refused as expired from then on. This package's README records it with the detached-run limitation.
- `CapabilityTokenService.attenuate` takes a required `now`, and `TokenAttenuationDenialReason` gains `parent-expired`.
- BLOCKED-330's native composition case builds its refusal from a revoked token, since a one-millisecond TTL would now be re-issued at every dispatch.
