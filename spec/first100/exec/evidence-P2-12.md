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
| `sdk` | yes | answerable by the embedding host (`human/question`); **no handler ships** | no | answer a question only if its host implements the request |
| `sdk-minimal` | **no** | no | no question service at all | neither |

Written as limitations, not as support: on four of the five profiles a question cannot be answered, so `ask` fails closed there, and the only surface on which real delivery can be observed is `web`. The control half is mounted in `dsh-base` by ruling — a stop is a cross-surface invariant, and mounting it only where questions can be answered would leave four profiles permanently unable to see a stop, which would make acceptance[0] and acceptance[2] vacuous rather than true.

**The SDK's question path: 4.4b only, and labelled as such.** `HarnessSdkJsonRpcServer` answers the `user-questions/request` waterfall by sending the protocol's first server-to-client request, `human/question` (`packages/sdk/protocol/src/types.ts`, schema ids `sdk-protocol:HumanQuestionParams` / `:HumanQuestionResult`, registered in the schema registry's bootstrap like every other wire payload). Four cases in `packages/sdk/server/tests/human-question.spec.ts` drive it with a test-side handler standing in for an embedding host, which is what makes them **4.4b — the service can do it** — and not 4.4c. Two mutations: answering with an empty answer instead of delegating reddens exactly the fail-closed case; never sending reddens all four.

**What the SDK path does NOT prove.** No production reach. Nothing in this repository registers a `human/question` handler, so on a shipped `sdk` profile the chain ends at `dsh-user-questions`' `NO_PROVIDER` — fail closed, by absence, and asserted by its own case. **4.4c for questions is the Web surface's to prove**, through the real `ui-user-questions` answerer, and that citation stays separate: a surface whose answerer this epic wrote could not be its own production evidence, and "the SDK supports questions" is the sentence that would hide the difference.

**The question goes to the SEAM, and no bundle row names a surface.** `ControlPlaneService.ask` puts the question through `ctx.userQuestions`, so which answerer replies is the profile's own business: `ui-user-questions` on `web`, an embedding host over `human/question` on an SDK profile, none on `headless` or `sdk-minimal`. The `web-app` bundle needed no change at all — naming a surface inside the service would have made one profile's answerer a dependency of every profile's stop, which is the opposite of what acceptance[3] asks for. Two mutations hold the wiring: dropping the seam's answer, and never putting the question to the seam, each redden exactly the two delivery cases.

**The seam is faked in `service.spec.ts`, on purpose.** Those cases prove this service's wiring — question reaches the seam, the seam's answer settles the waiting point, the asker resumes. Observing a REAL answerer is a profile-level observation and stays separate, because a file that proved both would be deciding which surface counts.

**No waiting point crosses the wire.** JSON-RPC's request id correlates the question with its answer, and the waiting point is how the answer reaches the asker inside the host process. Putting it on the wire would publish an internal routing key and let a client answer a question it was not asked.

## must[0]'s `ask question` verb: which path reaches production, and which does not

**Two different things are true and they are not the same claim.**

**The SEAM path reaches production.** `tool-ask-user` → `ctx.userQuestions.ask` → an answerer. On `web` that is 4.4c with real-browser evidence: `apps/web/tests/question-composer.e2e.ts` (collected by `vitest.web.config.ts:27`) boots the shipped composition under Playwright, renders the real composer, answers through it, and asserts the turn completes with the answer in the log. On an SDK profile the same foreground path now continues over `human/question` to the embedding host — 4.4b here, with 4.4c belonging to whoever embeds, since no handler ships.

**The CONTROL-PLANE path — the waiting-point registry and its settlement — is 4.4b only.** `controlPlane.ask`, `settle` and the waiting-point registry have **zero production callers**, and the limitation is specific rather than general: the one consumer they were designed for, a subagent asking a human, is **deliberately refused** by `ctx.userQuestions.ask`'s `DELEGATED_CALLER` check (`packages/interaction/user-questions/src/index.ts:101-105`), whose message tells the child to put the question in its final result instead. So this is not "a caller has not been written yet" — it is "the intended caller is a flow this harness has decided against", and changing that is the product decision recorded as (B1) in BLOCKED-215.

**BLOCKED-215's shape, one level up, named before it could be repeated.** Wiring a channel whose only production trigger does not exist is exactly what that entry reports. The narrower fix — parent registers the waiting point, child merely waits — was measured and refused for that reason: a child is blocked by the refusal above, and a parent's own question goes through the foreground path that blocks inside its turn and needs no waiting point. Building it would have produced wired code with no caller, deliberately. No 4.4c fixture was written for this path, because a fixture for it would prove a route production does not have.

**P4-06's frozen suites, before and after the `core/agent` change** (`packages/run/message-bus` entire, plus `core/agent/tests/arrival-dedup.spec.ts`, `subagent/tests/settlement-outbox.spec.ts` and `session-persistence/tests/write-behind.spec.ts`, which is every one of its ten live frozen entries): **9 files / 97 cases green before, 9 files / 97 cases green after.** `inbox.ts` is not touched by this slice.

## The base mount's replay condition, and the three wrong diagnoses it cost

**Verdict: zero differences, in four slices.** `scripts/session-snapshot-corpus.corpus.ts` 2 passed; `snapshots/session/headless.snapshot.ts` 84 passed and 1 skipped; `snapshots/acp/acp.snapshot.ts` 15 passed; `snapshots/sdk/sdk.snapshot.ts` 16 passed. Sliced by file because the aggregate run was killed by the host's memory watchdog **before executing a single case** (`Pages free` ≈ 65 MB, load 13.8) — a kill with zero cases is not a zero-diff reading, and reporting it as one would have been the failed-probe-as-measurement shape this program keeps catching.

**The first run of those slices failed 55 cases, and the cause was `pnpm install --lockfile-only`.** Every install while adding these packages used that flag, which updates the lockfile and does NOT create the workspace symlink, so `packages/bundle/base/node_modules/@deepseek-ai/dsh-control-plane` did not resolve. `plugin-package-inventory-deepseek` resolves every active Loader entry's owning package through real Node resolution (`src/index.ts:117`), so it threw `cannot resolve active package "@deepseek-ai/dsh-control-plane"` — which reached the SDK slice as `JsonRpcResponseError: cannot create effect on inactive context`, an error naming a cordis fiber and pointing nowhere near the cause. A real `pnpm install` fixed it: the same slice went 16/16 failing to 16/16 passing.

**What made it tractable was measuring the baseline first.** Removing ONLY the bundle row — one file, rather than stashing the whole change — turned 16 failures into 16 passes, which established that the mount was at fault before any theory about why. Two theories were then wrong, and both are worth keeping:

1. **A mixed plugin form.** The service default-exported its class AND named-exported a module-level `Config`, which `packages/AGENTS.md` warns makes the Loader discard a namespace. That was a real violation and is fixed (`static Config` inside the class, per `RunPlugin`), and it was **not** the cause.
2. **A lifecycle hook that nothing calls.** The store was opened in a method named `start()`. Cordis runs a symbol-keyed `[Service.init]` (`vendor/cordis/src/service.ts:13`); `start` is called by nothing, so the channel stayed undefined and every reader threw "reached before its mount became active". That was a real defect, caught by this package's own cases rather than by the replay, and is fixed — but it also was not the replay's cause.

The lesson worth carrying: in this repository a new package that is only ever installed with `--lockfile-only` passes typecheck, lint, its own suites and a direct `dsh --profile` boot, and fails only in a composition replay, reported as something else entirely.

## Two defects I wrote and then caught, recorded because the shapes recur

**A delivery function that took the answer and ignored it — BLOCKED-215 rebuilt, in the epic assigned to not repeat it.** The first `ControlPlaneService` had `deliverToAsker(answer)` look up the user-questions service, return `undefined` when it was present, and never touch `answer`. `undefined` means delivered, so every settlement reported success and no caller was ever resumed. **The tell was the unused parameter**, which is the same signal one layer up: BLOCKED-215's optional third constructor parameter was present in the signature and absent from the behaviour. The fix is not a better stub — it is registering the caller's continuation at the only moment it exists, inside `ask`, keyed by the waiting point, because an answer arrives out of band and nothing else can reunite it with the caller. The delegate's named mutation (the registry does not settle) now reddens exactly the two delivery cases, by timeout, which is what "the asker was never resumed" looks like from outside.

**`ctx.get('agents')` fell to cordis's untyped overload, so a method that does not exist compiled.** I wrote `registry.agents()`; the real method is `list()` (`packages/core/agent/src/index.ts:624`). It type-checked. The loose surface is exactly identifiable: `get` has two overloads (`vendor/cordis/src/reflect.ts:17-19`) — a typed `get<K extends string & keyof this>(name: K): undefined | this[K]`, and a fallback `get(name: string): any` for names outside the typed `Context` surface. `agents` becomes a key of `Context` only through the declaration merge in `@deepseek-ai/dsh-agent`'s index, and this module imported `Agent` from `@deepseek-ai/dsh-agent/types`, which does not execute that merge — so the fallback overload took the call and every method name passed. `dsh-user-questions` carries `import type {} from '@deepseek-ai/dsh-agent'` for this precise reason.

Fixed in both directions and measured: with the empty type import added, re-introducing `registry.agents()` fails as `TS2339: Property 'agents' does not exist on type 'AgentRegistry'`. Separately, the publish loop is extracted as `publishControlState` with its own cases, so the side effect carrying must[2]'s whole reach is coverable — an agent the broadcast skips reads `'no-channel'` at the gate and takes new work, and nothing inside a mounted method could have observed that. Recorded as an observation rather than numbered: the lesson is that a typed-service lookup is only typed where the merge is in scope, and the empty type import is what puts it there.

## Observations while landing the Contract stage

Neither is a defect in this epic; both are readings a later reader would otherwise have to re-derive.

**Regenerating the tsconfig path aliases turned an already-red gate green, and removed seven aliases pointing at files that do not exist.** Adding two packages required `pnpm run gen-tsconfig-paths`, which emitted the three new aliases and also dropped `@deepseek-ai/dsh-baseline-preflight/invariant`, `@deepseek-ai/dsh-evidence-format/invariant`, `@deepseek-ai/dsh-feature-gates/invariant`, `@deepseek-ai/dsh-plugin-manifest/invariant`, `@deepseek-ai/dsh-principal/invariant`, `@deepseek-ai/dsh-schema-registry/invariant` and `@deepseek-ai/dsh-trust-kernel/invariant`. Checked one by one: none of those seven packages declares an `./invariant` export any more, and none has a `src/invariant.ts` — they are residue from the "omit unneeded invariant companions" simplification. `verify-tsconfig-paths` was measured **red before these two packages existed** (the two new package directories stashed away, the gate still reported the file stale), so the regeneration fixed pre-existing drift rather than creating any. No number was opened for it, per the delegate: the generator is the owner of that region and it has now run.

**The stop record is a persistent object that P0-06's registry does not know about, and that is a declared discipline with no enforcer.** P0-06's must reads "declare a schemaId, major/minor, compatibility rules and a migration for every persistent or wire object", and `emergency-stop.json` is one. It is NOT registered, by ruling: doing it inside this epic's Provider stage would touch P0-06's semantic surface and would create two sources of truth for one version number, since the file already carries its own and refuses an unknown one by name. The measurement that makes this a class rather than an oversight: the whole-repo production caller count for `registerSchema` is **one** (`packages/settings/settings/src/index.ts:455`), and P4-12's `action-ledger.sqlite` — an accepted epic's durable store — is unregistered for the same reason. Same shape as P0-03's `removalDate` checked against nothing and P0-06's own obligation transfer: a rule that exists in a clause and in no executed gate. Owner is P0-06's later work or this epic's Usage stage; it is folded into the standing "declared with no enforcer" item rather than numbered.

**`constraints` was red on untracked residue, not on a tracked file.** `packages/execution/execution-world/` existed in this worktree as `lib/` and `node_modules/` only — P3-01's C stage lives on another branch, so this branch has the build output and not the `package.json`. The gate reported "expected a package here (no package.json found)". Removing that untracked residue cleared it; nothing tracked was touched.
