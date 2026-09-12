# preFlight — P3-01 U (一等公民 ExecutionWorld Capability Seam,Usage 阶段)

Written 2026-09-12 by lane B at `e94d39ca6b`, the candidate-4 lane B段 tip. Table first, per the same discipline as C and P: every row below is a measurement or a declared decision, and the rows marked **RULING** are the ones a reader must settle rather than infer.

## A correction to the assignment, stated first

The instruction says "U 的 must 对**四条** acceptance". **P3-01 declares three acceptance clauses**, not four (`tests/first100/registry.json`, `epics[P3-01].acceptance`): cross-provider equivalence, fail-closed selection, unforgeable handle. It also declares three `validation` items, and the already-frozen C/F case titles label the outcome clause `validation[3]` — a 1-based label this program's titles use. So this page answers **three acceptance clauses plus the one validation clause**, and says so rather than inventing a fourth row to match the count.

## Open question 1 from the C-stage preFlight: RESOLVED, and the answer changes the plan

The C preFlight could not establish what the ledger's `planError` meant by "attach the world handle via the sandbox-policy runtime-context snapshot contribution pattern, no loop edits". **It is measured now.** The pattern is two registrations in `packages/sandbox/sandbox-policy/src/index.ts`:

| line | what it is |
|---|---|
| `:132` | `ctx.sessionProjections.register({ key: 'sandboxMode', … })` — the durable fold of the `sandbox/mode` override |
| `:140-152` | `ctx.inject(['systemPrompt'], scope => scope.systemPrompt.context({ name: 'sandbox:policy', order, text }))` — a **system-prompt context section** |

**The consequence is the important part: that pattern is MODEL-VISIBLE.** A `systemPrompt.context` section is rendered into the runtime-context snapshot the agent loop logs as a `user/message` sourced `@deepseek-ai/dsh-system-prompt` — which is exactly what `packages/core/agent-loop/src/runtime-context.ts` projects and retains. So following the planError literally means *telling the model which world it is running in*, which under the repository's **model-visible ⟺ logged** rule requires a session event and re-records every snapshot fixture that would then carry the line.

**RULING 1 — this page proposes NOT to contribute a context section in U, and therefore NOT to touch `runtime-context.ts`.** The reasons, in order of weight:

1. **The model cannot act on it.** What the model needs to know about its confinement is *what it may touch*, and `sandbox:policy` already says that. "You are in world `w-7f3a` minted by provider `local`" is an audit fact, not a capability fact; it changes no tool call the model would make.
2. **acceptance[0] asks for the opposite.** The clause requires one `ToolExecution` to move between providers *without changing manifest or policy semantics*. Putting the world into the model-visible prompt makes the provider identity part of the model's input, so the same action in two worlds produces two different request bodies — the KV-cache prefix and the logged history both diverge. The C stage already refused to put the world in the `ActionManifest` for the digest version of this argument; the prompt is the same argument one layer out.
3. **The cost is measurable and large.** Every recorded-session fixture carrying a runtime-context snapshot would need re-recording, and the layout/refresh machinery around those fixtures is the thing that cost this program a 56-fixture accident once already.

**So the registry's two declared U files become one touched and one not.** `packages/core/tools/src/types.ts` is touched; `packages/core/agent-loop/src/runtime-context.ts` is **deliberately not**, and this row is the declaration of that rather than an omission a reader has to notice. If the delegate overrules, the work is additive and this page's other rows do not change.

## Consumer census — who actually takes a world, measured

| consumer | where | state today |
|---|---|---|
| the policy question's `world` field | `packages/policy/policy-enforcement/src/index.ts:256` | **hardcoded `world: { kind: 'absent' }`** at the single enforcement point |
| the Cedar translation | `packages/policy/policy-engine-cedar/src/index.ts:87` | `world: request.world.kind` — reaches the rule engine as the string `'absent'`, always |
| the fact type | `packages/policy/policy-engine/src/types.ts:97` | `ExecutionWorldFact = { readonly kind: 'absent' }` — one variant, so no rule can match on it |
| the audit record | `packages/core/tools/src/types.ts:28` `ToolWorldBinding` | declared by C; **zero producers** (`git ls-files \| xargs grep -ln` finds the declaration, two subsystem pages, one planning doc) |
| the mount | every `cordis.patch.yml` | **no row anywhere** names `execution-world`; the only repo-wide grep hit is `packages/bundle/web-app/lib/tsconfig.tsbuildinfo`, a build artifact |

**The two dispatch paths, and the reader position between them.** Both paths call the same sequence — `classifyActionRisk` → `readPolicyContextFacts` → `appendManifestThenGate` → `enforceManifestedAction`:

| path | classify / read | enforce |
|---|---|---|
| native tool call | `agent-loop/src/tool-calls.ts:250-251` | `:597` |
| code-mode embedded | `core/tools/src/ptc.ts:689,692` | `:269` |

`readPolicyContextFacts` (`core/tools/src/external-effect.ts:216`) exists because of **BLOCKED-201**, and its own comment states the finding this stage inherits: *"A field a path may omit is a field every path eventually omits"* — before that reader existed, every shipped policy question carried fail-closed defaults and no rule about trust or risk could match however it was written. `world` is the **last field still in that state**: it is not omitted by the paths, it is hardcoded at the enforcement point, which is the same defect one step further in.

## The U must-table

| clause | what U must do | where | 4.4b / 4.4c |
|---|---|---|---|
| must[0] the four types + the operations | nothing new — C declared them and P delivered the provider operations | — | closed in C/P |
| must[1] nine dimensions | nothing new | — | closed in C |
| must[2] the old SandboxExecution is the local provider's compat layer, **not hardcoded in the Agent Loop** | the dispatch path must obtain its world from a **registry it does not construct**, so no loop file names `local` | new provider-registry service + `bundle/base` row; reader in `external-effect.ts` | **4.4c** — the row is what makes it reached |
| acceptance[0] a `ToolExecution` moves between providers without changing manifest/policy semantics | record the world **beside** the dispatch, never inside the manifest or the prompt; prove the manifest digest is byte-identical across two providers for one action | new `action/world-bound` session event (`ignorable: true`), declared beside `action/risk-gated` at `core/tools/src/index.ts:2587` | **4.4b** for the cross-provider half (a second provider must be constructed — see the limitation below); 4.4c for the recording |
| acceptance[1] fail closed, never degrade | the policy question must carry a world fact that can be **refused**: `ExecutionWorldFact` needs a second variant, and `enforceManifestedAction` must stop hardcoding the first | `policy-engine/src/types.ts:97`, `policy-enforcement/src/index.ts:256`, new reader in `external-effect.ts` | **4.4c** — both shipped dispatch paths reach the reader |
| acceptance[2] the handle cannot be forged | nothing new — P closed it by construction (module-private symbol + `WeakMap` on object identity) | — | closed in P |
| validation[3] one typed outcome whatever stopped the world | nothing new in U; F owns the kill/timeout/lost-contact matrix | — | F |

**The shape of the change, in one sentence per file, so the table is implementable rather than suggestive:**

1. `packages/policy/policy-engine/src/types.ts` — `ExecutionWorldFact` gains its second variant, carrying the world id, the provider id and the confinement digest. **RULING 2:** this is the cross-epic edit the C preFlight said it could not authorise (open question 3). P3-01 owns the *producer* half of BLOCKED-178 and `policy-engine/README.md:31,:99` already records the split, so the edit belongs here; it is additive, and `policy-engine-cedar:87` already passes `request.world.kind` through, so the Cedar context gains a value without a translation change.
2. `packages/policy/policy-enforcement/src/index.ts` — `world` moves from a hardcoded literal into `EnforcementInput`, exactly as `facts` did under BLOCKED-201. The fail-closed value stays `{ kind: 'absent' }` and now has **one producer** instead of being invisible at the enforcement point.
3. `packages/core/tools/src/external-effect.ts` — `readExecutionWorldFact(ctx, agent)`, beside `readPolicyContextFacts`, so the two dispatch paths cannot answer the same question differently. An unmounted registry reads as `absent`, which is the restrictive value.
4. `packages/core/tools/src/index.ts` — the `action/world-bound` event declaration.
5. `packages/execution/execution-world/src/plugin.ts` (new) — the provider registry as a service. Registration is an effect (`ctx.effect()` returning the disposer), per the repository's registration rule, with the HMR-disposal case its own test.
6. `packages/bundle/base/cordis.patch.yml` — the row, beside the four sandbox rows at `:244-261`. Inherited by `acp-app`, `headless`, `sdk-app`, `sdk-minimal` and `web-app`, which is what answers 4.4c's third question by the row rather than by the code existing.

## The two limitations P declared: which one U closes

| P-stage declaration | status after U |
|---|---|
| **acceptance[1]'s policy half is unprovable** — `ExecutionWorldFact` has one variant, so no policy can refuse on where an action runs | **CLOSED by U**, and this is the stage's main content: the second variant plus a real producer at both dispatch paths means a Cedar rule can finally match on the world, and the fail-closed `absent` becomes a value a rule can distinguish rather than the only value there is |
| **acceptance[0]'s cross-provider half is unproved** — only a local provider exists | **STILL OPEN, and stays open in U.** A second provider is not in this epic's scope (must[2] scopes it to the local compat adapter), so the swap is provable only against a constructed provider from validation[1]'s conformance suite. U narrows it to a stated, testable claim — *the manifest digest and the policy question are byte-identical for one action run under two providers* — and proves that against a fake second provider. That is the P4-08 acceptance[2] shape, declared here at freeze time, not discovered at sign-off |

## What this page does NOT settle

1. **RULING 1** (no model-visible context section, `runtime-context.ts` untouched) and **RULING 2** (the `policy-engine` type edit) are decisions this page makes and declares; either can be overruled, and neither is silently assumed.
2. **Whether the conformance suite belongs to U or to F.** validation[1] ("a fake world conformance suite every provider must pass") is the only way the cross-provider half is ever provable. U needs a fake second provider for its own digest-equivalence case; whether that grows into the full suite here or in F is unsettled, and building half a suite twice is the failure mode to avoid.
3. **`WorldAttestation` against what.** The C preFlight's open question 4 is untouched: the Trust Kernel's `sandboxAttestationVerifier` returns `false` unconditionally (P0-02's deliberately inert slot), and whether the world seam wires that entrypoint is still unanswered. U does not need it — acceptance[2] closed by construction in P — so this stays open rather than being answered by the first thing that compiles.
