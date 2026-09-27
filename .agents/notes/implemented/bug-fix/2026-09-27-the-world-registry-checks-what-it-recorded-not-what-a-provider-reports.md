# Agent Note: The world registry checks what it recorded, not what a provider reports afterwards

Status: implemented

English | [中文](2026-09-27-the-world-registry-checks-what-it-recorded-not-what-a-provider-reports.zh.md)

## Problem

The P3-01 blind review of B-666 found two ways past the checks that BLOCKED-316 condition 3 asks for. `register` read a provider's id once, but binding compared the handle with the id the provider reported at that moment, so a provider could register under another id and rename itself to `local`. The registry handed providers its own mutable spec and digested it only after `create`, so a provider could clear the deployment's ceilings, report the digest of what it had changed, and bind; the binding's ceilings were read from that changed object. The review also found the tool guard's state non-monotonic: each attempt deleted the agent's refusal first and wrote the new one after `await create`, so a concurrent dispatch could run in between, and a later attempt that ended early erased a recorded mismatch.

## Decision

- `register` records the id a provider registered under, and the identity check compares the handle with that recorded id.
- `bindingFor` resolves the spec, deep-freezes a copy, and digests it before selection. Every provider sees only the frozen copy, the handle's digest must equal the precomputed one, and the binding's ceilings come from the copy. A `create` that throws, synchronously or not, creates no world.
- Concurrent `bindingFor` calls for one agent share one attempt. An attempt writes its refusal once, when it ends; a recorded identity or digest mismatch is cleared only by a successful binding, so a later attempt whose `create` fails, or that ends early, leaves it in place.

## Alternatives considered

- **Re-check the reserved-id table at binding.** It stops a provider from becoming `local` or `fenced`, but not from taking another third-party provider's id.
- **Write a pending refusal when an attempt starts, and treat a failed `create` as a refusal.** Every `danger-full-access` session's `create` is rejected by design and runs under `absent`, so its calls would all be refused; the pending kind would also change the `action/world-unbound` event's payload.

## Consequences

- A provider that writes to the spec it is handed now throws inside the registry's call; during selection that fails the binding attempt, during `create` it binds nothing.
- Selection order and the provider names in an `unavailable` refusal still read each provider's current `id`.
- This note supersedes in part [The world registry checks who built a world, and a session without the world it asked for says so](2026-09-26-the-world-registry-checks-who-built-a-world-and-declares-a-missing-one.md): the identity check, the digest check, and when the guard's refusal is written.
- Verification: A-559 (`tests/first100/fixtures/P3-01.world-identity.composition.spec.ts`) and `packages/execution/execution-world/tests/registry.spec.ts`.
