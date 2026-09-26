# Agent Note: A direct tool call is manifested and decided before it runs

Status: implemented

English | [中文](2026-09-26-direct-tool-calls-are-manifested-and-decided.zh.md)

## Problem

BLOCKED-294; P2-03 acceptance[0], P2-05 acceptance[0]. `ToolRuntime.execute` is the public seam a plugin calls directly, and the Cordis tutorial teaches it. It checked the capability token, ran the `tools/pre-execute` waterfall and the guards, and then ran the tool, without appending an ActionManifest or asking the policy enforcement point. Lane A measured it on the shipped headless profile:
- A-434 (run 36204057122): a direct call on behalf of the root agent had no manifest and no decision, and a tutorial-style call with no agent had no decision. The token gate then refused both.
- A-462 (run 36212808158): a plugin tool's nested write, presenting the token the tool was admitted under, ran and wrote its file with no manifest and no decision.

## Decision

- **The seam records and decides first.** Where the Trust Kernel is pinned, `execute` appends the call's ActionManifest (origin `plugin-rpc`) to the calling agent's session and asks the enforcement point before the capability token is checked. A decision other than permit refuses the call, so a call the token gate would refuse still leaves both.
- **The enforcement point sees the token the call presents.** A plugin tool's nested call presents the token its own execution was admitted under, which the runtime hands the tool body; a plugin's own top-level call presents none. The point receives P2-02's audited projection of it.
- **A call with no agent is refused.** No session can record its manifest. The manifest is built but not appended, the enforcement point decides it at the fail-closed facts, and the kernel's audit records the decision; then the call is refused.
- **It asks whether this host may still act.** With or without a kernel, after the manifest and before the decision is acted on, which is the native path's order, an emergency stop or a run another host took over refuses the call (BLOCKED-345). An agent with no control channel and no lease is admitted, as on the native path.
- **One implementation.** The manifest request and the decision are the ones code mode's sub-dispatch uses, moved from `ptc.ts` into `external-effect.ts`. Code mode's manifests are unchanged byte for byte.
- **The manifest and the decision only where the kernel is pinned.** Every shipped profile pins one: `enforceTrustKernelPosture` (`apps/cli/src/profile-boot.ts:383`, called at `:643`) refuses to boot without it unless `DSH_TRUST_KERNEL_INSECURE` opts a development boot out, tested at `apps/cli/tests/trust-kernel-launch-posture.spec.ts:45`. A composition without a kernel has no enforcement point, and its direct calls append no manifest either, unlike the agent loop's own calls. The tools README records the asymmetry.

## Alternatives considered

- **Declaring the seam internal**, with a structural guard against shipped callers, which is BLOCKED-294's second closing path. It leaves a tool body's nested call, the one A-462 measured, unrecorded.
- **Manifesting every direct call that names an agent, kernel or not.** 231 direct calls in 63 test files name an agent, and their session logs would change where no enforcement point decides anything.

## Consequences

- A tool body's nested write is recorded before it runs and is decided by the enforcement point; A-462's case turns green.
- The tutorial shows the call with `agent` and says what a call without one gets.
- Three unit specs pinned a kernel with no decider for their token cases: `provider.spec` and `renewal.spec` in `capability-token-file`, and `capability-token-spawn.spec` in `subagent`. With no decider every decision is a refusal, so their direct calls would now stop before the token gate the cases exercise. They now pin the decider the shipped profiles pin, `endorseComposedDecision`, over a policy that permits their tools, as the shipped policy set does. Titles and assertions are unchanged; `provider.spec` and `capability-token-spawn.spec` are frozen under P2-02 [230].
- Not covered: four web e2e files (`background-job-list`, `replay-round-trip`, `schedule-after`, `shipped-composition`) make direct calls in a kernel-pinned web composition, and no first100 run executes them. The risk gate that asks an operator about an action is not applied on this seam (measured by A-471 and fixed separately).
- Verification: lane A's A-434, A-462 and A-472 on the shipped headless profile, and `packages/core/tools/tests/direct-seam.spec.ts`. The order mutation M-615-order, which appends the manifest after dispatch, turns A-462's case and the unit cases that observe the order red.
