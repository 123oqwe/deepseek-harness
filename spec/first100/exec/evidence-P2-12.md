# Evidence package — P2-12 全局 Emergency Stop 与通用 Human Interaction Channel

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `d403d37413`, which is the **Contract stage only**. This page exists now so the C stage's own answer to question (2) is recorded rather than reconstructed later: it is **zero callers, by design**, and saying so here is what keeps a later reader from mistaking the contract for a shipped stop.

## Summary — what the C stage can and cannot answer

| clause | verdict at this stage |
|---|---|
| must[0] the five control verbs | subject exists; four are decided and `kill-execution-world` is specified and refused as unimplemented |
| must[1] the stop is broadcast by the kernel and persisted | **not yet** — no broadcast, no store; this is the P stage |
| must[2] a worker checks the stop before taking a new lease or action | predicate exists (`mayStartNewWork`); **no caller** — `run/lease/src/plugin.ts` reads no stop state |
| must[3] questions are separate from approvals; an answer never grants | closes at the type level and is cased |
| acceptance[0] no new external effects after a stop | **not yet** — needs the gate wired, which is Usage |
| acceptance[1] in-flight work terminates or is marked reconciliation-required | partially: routing is decided, settlement belongs to P4-06's outbox |
| acceptance[2] the stop survives a restart and needs an explicit release | decided as a VALUE; persistence is the P stage |
| acceptance[3] every surface agrees | **open** — the first half of OQ2 is unsettled, and one surface answers questions today |

## Question (2) for this stage, stated once

`git ls-files` over `@deepseek-ai/dsh-human-channel` and `@deepseek-ai/dsh-control-plane`, excluding `tests/` and `*.spec.ts`, finds **no importer anywhere in the repository**. That is the Contract stage's correct state and it is also the exact state BLOCKED-215 describes as a defect in a LATER stage — the difference is that this page says so, and P5-10's citations did not. The P and U stages are where question (2) must change, and the must[2] row above names the file that has to start reading the state: `packages/run/lease/src/plugin.ts`.

## The Usage stage's first production caller, and which profiles reach it

**First production caller: `packages/core/agent/src/dispatch.ts:285` (`advanceLeasedAgent`), reading `Agent.controlState`.** That is the one implementation of "this agent proposes a state change", and both production callers reach it — `@deepseek-ai/dsh-run` for the run's own progress and the agent loop at tool dispatch — so must[2]'s gate covers work nobody remembered to check. `packages/run/run/src/index.ts:1152` widened its own declared return to carry the new `'stopped'` reason through to its callers.

The gate answers THREE ways and the third is load-bearing: `'stopped'` refuses, `'running'` admits because a mounted channel says the run is live, and `'no-channel'` admits because this composition mounts none. A boolean would have collapsed the last two, which is the same collapse `Agent.leaseRefused` exists to undo one layer down — there, absence of a lifecycle hid a refusal and a second host kept dispatching against work another host held.

**Which profiles reach it (4.4b/4.4c), from `packages/boot/app-boot/src/profile.ts:154-175` rather than from a grep:**

| profile | layers `dsh-base` | question answerer | approval answerer | what a human can do |
|---|---|---|---|---|
| `web` | yes | **yes** (`ui-user-questions`) | **yes** (`ui-approval`) | answer and approve |
| `acp` | yes | no | **yes** (`dsh-acp`) | approve only |
| `headless` | yes | no | no | neither |
| `sdk` | yes | no | no | neither |
| `sdk-minimal` | **no** | no | no question service at all | neither |

Written as limitations, not as support: on four of the five profiles a question cannot be answered, so `ask` fails closed there, and the only surface on which real delivery can be observed is `web`. The control half is mounted in `dsh-base` by ruling — a stop is a cross-surface invariant, and mounting it only where questions can be answered would leave four profiles permanently unable to see a stop, which would make acceptance[0] and acceptance[2] vacuous rather than true.

**P4-06's frozen suites, before and after the `core/agent` change** (`packages/run/message-bus` entire, plus `core/agent/tests/arrival-dedup.spec.ts`, `subagent/tests/settlement-outbox.spec.ts` and `session-persistence/tests/write-behind.spec.ts`, which is every one of its ten live frozen entries): **9 files / 97 cases green before, 9 files / 97 cases green after.** `inbox.ts` is not touched by this slice.

## Observations while landing the Contract stage

Neither is a defect in this epic; both are readings a later reader would otherwise have to re-derive.

**Regenerating the tsconfig path aliases turned an already-red gate green, and removed seven aliases pointing at files that do not exist.** Adding two packages required `pnpm run gen-tsconfig-paths`, which emitted the three new aliases and also dropped `@deepseek-ai/dsh-baseline-preflight/invariant`, `@deepseek-ai/dsh-evidence-format/invariant`, `@deepseek-ai/dsh-feature-gates/invariant`, `@deepseek-ai/dsh-plugin-manifest/invariant`, `@deepseek-ai/dsh-principal/invariant`, `@deepseek-ai/dsh-schema-registry/invariant` and `@deepseek-ai/dsh-trust-kernel/invariant`. Checked one by one: none of those seven packages declares an `./invariant` export any more, and none has a `src/invariant.ts` — they are residue from the "omit unneeded invariant companions" simplification. `verify-tsconfig-paths` was measured **red before these two packages existed** (the two new package directories stashed away, the gate still reported the file stale), so the regeneration fixed pre-existing drift rather than creating any. No number was opened for it, per the delegate: the generator is the owner of that region and it has now run.

**The stop record is a persistent object that P0-06's registry does not know about, and that is a declared discipline with no enforcer.** P0-06's must reads "declare a schemaId, major/minor, compatibility rules and a migration for every persistent or wire object", and `emergency-stop.json` is one. It is NOT registered, by ruling: doing it inside this epic's Provider stage would touch P0-06's semantic surface and would create two sources of truth for one version number, since the file already carries its own and refuses an unknown one by name. The measurement that makes this a class rather than an oversight: the whole-repo production caller count for `registerSchema` is **one** (`packages/settings/settings/src/index.ts:455`), and P4-12's `action-ledger.sqlite` — an accepted epic's durable store — is unregistered for the same reason. Same shape as P0-03's `removalDate` checked against nothing and P0-06's own obligation transfer: a rule that exists in a clause and in no executed gate. Owner is P0-06's later work or this epic's Usage stage; it is folded into the standing "declared with no enforcer" item rather than numbered.

**`constraints` was red on untracked residue, not on a tracked file.** `packages/execution/execution-world/` existed in this worktree as `lib/` and `node_modules/` only — P3-01's C stage lives on another branch, so this branch has the build output and not the `package.json`. The gate reported "expected a package here (no package.json found)". Removing that untracked residue cleared it; nothing tracked was touched.
