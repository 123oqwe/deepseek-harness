# Agent Note: The world registry checks who built a world, and a session without the world it asked for says so

Status: implemented

English | [中文](2026-09-26-the-world-registry-checks-who-built-a-world-and-declares-a-missing-one.zh.md)

## Problem

BLOCKED-316, under P3-01 acceptance[1] and acceptance[2]. The world registry copied a created handle's `provider` and `spec` into the binding, the policy fact and the audit without checking them, and `register` was public, so a plugin's provider could claim to be `local` with any digest. A deployment that asked for a world no provider could hold, with no rule forbidding `absent`, ran its tools with no world and recorded nothing. Lane A wrote the red-first cases on the shipped headless profile (A-432, A-531): a forging provider was bound under its claim, registering under `local` did not throw, and the `network: none` request degraded silently.

## Decision

- **`local` and `fenced` are reserved.** `register` refuses a provider whose id is `local` or `fenced` unless `createLocalWorldProvider` or `createFencedWorldProvider` built it, recognised by object identity through a module-private set in each module, and the error names the id. A copy or a look-alike of either provider is refused like any other.
- **A handle is checked against the selection.** `bindingFor` binds only when the handle names the provider that selection chose and carries the digest the registry computes for the spec it asked for. A handle failing either binds nothing, and `refusalFor(agent)` names the failed check.
- **A call in that session is refused by a tool guard.** The registry registers a guard with the tool runtime, which every dispatch path passes before a tool body. The guard denies a call whose session's last binding attempt failed the check, naming the tool and the check. A guard, because it is monotonic: no `tools/pre-execute` listener can turn its denial into permission.
- **A world no provider can hold is a declared degradation.** When selection refuses, the call is not refused: it runs under the `absent` policy fact, which a deployment rule may refuse, and `readExecutionWorldFact` records `action/world-unbound` once per session with the selection's refusal. A failed check is recorded the same way.

## Alternatives considered

- **Refusing a call whose requested world no provider can hold.** In `danger-full-access` with a ceiling stated, on a host whose subprocess runtime holds no ceiling, selection refuses, and a refusal at dispatch would replace the shell tools' `WorldCeilingsRefusedError`, which names the mode and the ceilings (P3-10, `tests/first100/fixtures/P3-10.world-ceiling.spec.ts`). It would also refuse tools that start no process.
- **Throwing from `bindingFor`.** The native dispatch path reads the world before it appends the call, so a throw there ends the turn as a scheduler failure instead of producing a tool result.
- **A new `ExecutionWorldFact` variant that the enforcement point denies.** It would change the policy vocabulary, and the closed reason code a policy refusal carries cannot name which check failed.
- **Reserving through the plugin row that registers each shipped provider instead of through the factory.** The package exports every module under `src/`, so any marker a plugin row could hold is reachable by other plugins; the object a factory returns is what another plugin cannot forge. The factory route leaves `createFencedWorldProvider`'s `enforceableLimits` input, which the package README records as a known limitation of the class of P1-09's Known Limitation ⑧.

## Consequences

- A session whose selected provider returns a handle naming another provider, or a digest other than the spec's, binds no world, and each of its calls is refused before the tool body runs. The tool result names the check, and the session records `action/world-unbound`.
- A deployment asking for a world no provider can hold runs its tools as before, and the session now records why it has no world. A session with no world for another reason, such as no registry, no file-effect boundary, or a provider rejecting the create as in `danger-full-access`, records nothing new.
- Registering a provider this package did not build under `local` or `fenced` throws, naming the id.
- The guard runs after the risk gate, so a person can be asked to approve a call that the guard then refuses.
- Verification: A-432, A-531 and A-541 (`tests/first100/fixtures/P3-01.world-identity.composition.spec.ts`), `packages/execution/execution-world/tests/registry.spec.ts` and `world-fact.spec.ts`.

Superseded in part by [The world registry checks what it recorded, not what a provider reports afterwards](2026-09-27-the-world-registry-checks-what-it-recorded-not-what-a-provider-reports.md): the identity check, the digest check, and when the guard's refusal is written.
