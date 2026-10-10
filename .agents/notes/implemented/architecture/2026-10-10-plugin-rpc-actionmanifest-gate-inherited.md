# Agent Note: A plugin's RPC tool inherits the ActionManifest/policy gate from the shared dispatch seam (P1-06 m4)

Status: implemented

## Problem

P1-06 slice 3 (requirement m4) must ensure a plugin's RPC-registered tool cannot invoke an action the ActionManifest/policy gate would deny — the plugin must not be able to bypass the manifest. The epic proposal framed this as wiring a plugin-specific ActionManifest gate into the plugin invoke path, with a "remove the gate → the call is admitted" mutation on that plugin-specific code.

Grounding the shipped design showed that premise does not hold. `@deepseek-ai/dsh-plugin-host-rpc` contains no enforcement code. `registerProxyTool` registers a plain `ctx.tools` ToolDefinition whose `execute` is `invokePlugin`; `invokePlugin` does no manifest check and has exactly one caller (that proxy `execute`), so there is no ungated route to the plugin. Every path that reaches a proxy tool already gates it, pre-execution, when a Trust Kernel is pinned: the public `ToolRuntime.execute` seam (`packages/core/tools/src/index.ts` `decideDirectCall`, origin `plugin-rpc`, refuse branch at :2137-2139) and the agent-loop (`appendActionManifest`, unconditional). This is the same gate native and code-mode tool calls pass through (Epic P0-02 acceptance[2]: a plugin cannot reach an unenforced tool through the public seam when a policy engine is mounted).

## Decision

m4 is satisfied by INHERITANCE from the shared, kernel-gated dispatch seam, not by code in the plugin host — so slice 3 adds no product code. It is closed by:

1. A witness (`tests/first100/fixtures/P1-06.slice3-rpc-registration.m4-actionmanifest-gate.spec.ts` + `loader/p1-06-slice3-m4/fake-plugin-m4.mjs`), green on the factory tip d6f82b704c, that mounts a Trust Kernel + a policy-engine stub (the `direct-seam.spec.ts` convention), registers two proxy tools over a real out-of-process plugin child, and observes: a policy-DENIED proxy action (dispatched with a VALID capability token) is refused before execute with NO `tool.invoke` frame crossing; a policy-PERMITTED action executes and crosses exactly one frame. The valid token isolates the ActionManifest/policy decision from the seam's zero-ambient-authority precondition.
2. A throwaway mutation of the one shared-seam refuse branch the witness traverses (`packages/core/tools/src/index.ts:2137-2139`), which flips the denied witness from refused-with-no-frame to admitted-with-one-frame, proving the refusal is load-bearing.
3. This limitation record (the plugin-host-rpc README and this note): the gate is inherited, kernel-gated, and has no clean plugin-specific mutation.

## Consequences

The no-bypass property holds only when a Trust Kernel (and a mounted policy engine) is pinned; a shipped `dsh` profile always pins one, and a bare harness that mounts neither (the slice-1 driver) dispatches unenforced by design — which is why the m4 witness must additionally mount a kernel + engine. Because enforcement lives in the shared seam shared with native and code-mode tools, there is no clean, plugin-specific mutation; this is the A-519 ① defense-in-depth pattern (a shared enforcement layer with no single-layer plugin-specific mutation).

## Alternatives considered

- **Add a plugin-specific ActionManifest gate in the plugin host (option B).** Rejected: redundant with the shared seam that already enforces every proxy dispatch; non-minimal (a new mechanism the shipped design does not have, §13); and a second enforcement point that can drift from or mask the first. `invokePlugin` runs inside tool execution, after the gate, so observing the decision there would need new plumbing for no added guarantee.
- **Record a plugin-RPC origin for a model→proxy dispatch.** The agent-loop records origin `native-tool-call` for a model-invoked proxy tool (the direct seam records `plugin-rpc`); relabeling would be an auditing change, not a bypass fix, and is out of m4's scope.
