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

## The answerer census: why enabling the provider is not one decision

Recorded for [BLOCKED-214](BLOCKED-QUEUE.md#blocked-214). The user's ruling is that the factory default should be ON with a first-time authorization prompt. Whether that prompt can be PUT is a per-profile fact, and it is not the same on all five.

`askForReadTrustOnce` (`agent-instructions/src/index.ts`) needs three things, and only the third varies:

| precondition | state |
|---|---|
| a mounted `workspaceTrust` provider | supplied by enabling the row |
| an attached principal on the session | **supplied by P2-01 U2** — without it the ask is never put, which is what that function's own comment records |
| an `approval` service that can ANSWER | **profile-dependent** |

`approval.request()` reaches `decide()`, which returns `'rejected'` under the `never` policy and otherwise dispatches to the registered answerers — **with none registered it returns `'unavailable'`**. Every production answerer in the repository, excluding tests, generated files and the API catalog:

```
packages/acp/acp/src/index.ts                        ctx.on('approval/request', …)
packages/client/ui-approval/src/client/index.ts      ctx.remote.$on('approval/request', …)
```

Which profiles mount one:

| profile | answerer | effect of enabling the provider row |
|---|---|---|
| `acp-app` | `dsh-acp` | the prompt is put and can be granted |
| `web-app` | `ui-approval` | the prompt is put and can be granted |
| `headless` | **none** | the ask returns `unavailable`; the workspace stays untrusted, permanently, with no in-session grant |
| `sdk-app` | **none** | same |
| `sdk-minimal` | **none** | same, and it does not layer over base at all |

`agent-instructions/src/index.ts` already states the consequence — "no answerer (`'unavailable'`) … leaves the workspace untrusted" — so on the three profiles without one, an enabled provider is a boundary that refuses everything and can never be satisfied. That is the situation `base`'s comment warned about; what is new here is which profiles it is true of, and why.

`/trust-skills` is not an escape: it reaches the same `approval.request()` and the same absent answerer. (Its other obstacle is gone — `hasOpenAuditBracket` now accepts a `command/run` bracket, closing BLOCKED-205's half of it — but an open bracket does not produce an answerer.)

## The two absent-provider defaults, and why they do not both dissolve

The delegate's instruction is to write these up as resolved once a provider is always mounted. They resolve only as far as "always" actually reaches, and they point in **opposite** directions:

| site | absent-provider default | direction |
|---|---|---|
| `core/tools/src/external-effect.ts` | `'untrusted'` | fail CLOSED — policy sees the strictest fact |
| `agent-instructions/src/index.ts` | `undefined` → permitted | fail OPEN — the project's files load |

On a profile that mounts the provider, both branches become unreachable and the defaults stop mattering. On a profile that does not, both stay live — and the asymmetry means the same missing provider makes the policy engine stricter while leaving the trust boundary off. Any claim that these defaults are "dissolved by the provider always being present" is true per profile, not repository-wide, unless every published profile mounts it.

## The shipped posture after BLOCKED-214, stated plainly

The user ruled (A) — factory default ON with a first-time authorization — and then ruled its unattended half to be a persistent trust record. Both halves have landed, and the resulting posture is a change every operator will notice, so it is written here rather than left to be inferred from two bundle rows.

**On `headless`, `sdk-app` and `sdk-minimal`: a workspace is UNTRUSTED until a record exists.** While untrusted, the project's own `AGENTS.md` does not load and the project's skills are not offered. These profiles register no `approval/request` answerer, so the one question `askForReadTrustOnce` puts settles `'unavailable'` and cannot grant anything.

Two entry points write the record, and both write the SAME record the ordinary check reads:

| entry point | what it writes |
|---|---|
| `dsh --trust-workspace[=read\|execute\|none]` | a record before any session exists; bare flag means `read` |
| `/trust-skills` | `trusted-execute`, after the host user confirms in-session |

**On `acp-app` and `web-app` the first-time prompt works as (A′) delivered it**, because those two mount an answerer.

**The flag is not a bypass, and the difference is structural rather than documented.** Its entire effect is one `grantTrust` call. Every Consumer still resolves through `stateFor` against a fresh `{canonicalPath, device, inode, birthtimeMs}` observation, so a workspace trusted by the flag still loses trust when the directory is replaced, its symlink retargeted, or a different directory takes its path. The frozen supplement's swap case is that proof: the flag ran, another directory took the granted path, and the check refused.

**What an operator gives up by not granting.** Nothing the model needs to work — only the project's own instructions and skills, which are content the opened directory supplied. That is the trade acceptance[0] asks for.

**What the corpus now records.** Every recorded `headless` session whose cwd resolves to a project root carries an `approval/asked` + `approval/decided` pair for `workspace-trust`, resolving `unavailable`. The pair is the durable evidence that the boundary refused; the alternative — refusing silently — would leave the one refusal an operator most needs to see with no trace at all.

### One residual this posture inherits

A shipped profile constructs its Trust Kernel with **no `auditSink`** (`apps/cli/src/profile-boot.ts`), so the grant/revoke transitions the provider appends reach no reader — [BLOCKED-191](BLOCKED-QUEUE.md#blocked-191), which applies to these transitions exactly as it does to P2-05's decisions. The provider APPENDS, proven in `workspace-trust-local/tests/provider.spec.ts` against a kernel whose sink is configured. Until 191 closes, the `approval/asked` pair in the session log is the only trust evidence a shipped profile actually retains.
