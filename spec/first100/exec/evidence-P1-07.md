# P1-07 — the project trust boundary, and which profiles actually have one

The five published profiles' provider state, measured for the re-sign. The finding is not about whether the boundary works; it is about where it is mounted.

## The provider row, across every shipped bundle

`workspace-trust-local` is the only provider of the `workspaceTrust` seam. Measured by reading each bundle's patch rather than by inheritance reasoning:

| bundle | row present | state |
|---|---|---|
| `base` | yes | **`disabled: true`** |
| `headless` | no row | inherits base's disabled row |
| `acp-app` | no row | inherits base's disabled row |
| `sdk-app` | no row | inherits base's disabled row |
| `web-app` | no row | inherits base's disabled row |
| `sdk-minimal` | no row | does not layer over base at all |

`grep -rn workspace-trust-local packages/bundle/*/cordis*.yml` returns three lines, all in `base`, all part of the one disabled row. The only other composition in the repository naming it is `workspace-trust-local/tests/fixtures/workspace-trust.patch.yml`.

**So no published profile mounts a `workspaceTrust` provider.** The base comment says this is deliberate and gives the reason: with no grants, an enabled provider makes every workspace untrusted at once, which would stop project skills and the project's own `AGENTS.md` loading for every existing user.

## What an unmounted seam means to its consumers, measured

The two P1-07 consumers **fail open**, and the third — P2-05's policy fact — fails closed. That asymmetry is the substance of this page:

| consumer | absent-seam behaviour | source |
|---|---|---|
| `skill-filesystem` project skills | `if (trust === undefined) return true` — permitted | `skill-filesystem/src/index.ts` |
| `agent-instructions` project `AGENTS.md` | `trustState === undefined \|\| …permitted` — permitted | `agent-instructions/src/index.ts` |
| `readPolicyContextFacts` | `'untrusted'` when the seam is absent | `core/tools/src/external-effect.ts` |

Measured with a throwaway probe over this epic's own hostile-clone fixture, composing exactly what a shipped profile composes — `SkillRegistry` and `SkillFileSystem`, and **no** trust provider:

```
skills offered = ["attacker-agents", "attacker-dsh", "host-owned"]
```

The same fixture with a provider answering `untrusted` offers `["host-owned"]` alone. So on a shipped profile, a cloned repository's executable skills are offered to the model.

The probe was first written with a `console.error`, which printed nothing: vitest does not forward console output for passing tests, a trap already recorded in `.agents/notes/implemented/process/2026-09-10-failures-that-quietly-do-nothing.md`. It was redone as a deliberately failing assertion so the value appears in the diff. No file was left changed — `cmp` confirms byte-identity.

## The gap this leaves in the epic's own evidence

`skill-filesystem/tests/trust-gate.spec.ts` has three cases — `untrusted`, `trusted-read`, `trusted-execute` — and every one of them **mounts a provider**. There is no case for the unmounted seam, which is the only configuration any published profile actually runs.

The epic's cases therefore prove the boundary behaves correctly *when it is on*, and say nothing about the state every user is in. A reader checking that the suite is green learns that the mechanism works, not that any shipped profile has it.

## What this means for acceptance[0], stated rather than decided

acceptance[0] is: *clone a repository carrying a malicious configuration and open it — no subprocess, no network, no credential read.* The measurement above says the mechanism that would refuse those is not mounted on any profile a user can launch.

Two readings, and choosing between them is the re-sign's:

1. **The clause is about the mechanism.** It works, it is tested, and enabling it is one documented edit. Then the epic is accepted on the strength of the provider's own cases, and the shipped default is a separate product decision with its own rationale already written into `base`.
2. **The clause is about a shipped profile.** Then it is not satisfied by any published bundle, and the evidence a re-sign needs is a case over the composition a user actually gets.

This page does not argue for either. It records that the question is not answerable from the suite as it stands, because the suite never composes the shipped configuration.
