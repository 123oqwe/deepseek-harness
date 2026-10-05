# Agent Note: An untrusted plugin registers over a JSON-only RPC before it runs out of process

Status: implemented

## Problem

Epic P1-06 asks for a host that runs a third-party plugin out of process (m0), lets it register tools, events and UI only over a capability-scoped RPC (m1), never hands it the host `Context`, raw credentials, functions or mutable references (m2), survives its crash with every registration revoked (m3), and keeps its tool calls inside the ActionManifest gate (m4). Today every plugin loads in-process with the real `ctx` (`app-boot`'s Loader mounts `cordis.yml` entries into one process), and the manifest's `executionMode` (`in-process|worker-thread|process|container`) is declared and validated but has no routing consumer — nothing acts on a plugin that declares `process`.

The whole epic cannot land at once. The first slice needs the registration boundary — the protocol, the host-side validation, and the wiring of a plugin's declared tools into the real registry — to exist and be exercised before a process actually spawns, so that the process host (slice 2), the ActionManifest pin (slice 3) and the crash/revoke semantics (slice 4) each build on a fixed seam rather than reinventing it.

## Decision

The first slice is a pure library, `@deepseek-ai/dsh-plugin-host-rpc`, carrying the seam's three roles and nothing that mounts: `src/types.ts`/`src/protocol.ts` hold the protocol and the fail-closed validators (Service Definition), `src/host-decoder.ts`'s `attachPluginRpcHost` binds one plugin session's transport and drives the handshake and registration loop (Provider), and `src/registration-consumer.ts`'s `registerProxyTool` turns one validated registration into a proxy `ToolDefinition` registered through `ctx.tools` (Consumer). It registers no Cordis service and no profile mounts it, so it is not in the SDK runtime closure yet — it joins when slice 2 supplies a process transport.

Only serializable JSON crosses the boundary (m2), as a structural property of the protocol rather than a runtime check: the wire types describe JSON, a proxy `ToolDefinition` carries no plugin code, and its output projection is a fixed host implementation keyed by the plugin's declared `render` mode because a function cannot cross a process boundary. A proxy tool's `execute` does not re-implement dispatch; it runs through the ordinary `ctx.tools.execute` path, so the ActionManifest gate and capability check run before the `tool.invoke` RPC is sent — the RPC is dispatch after the gate, not a second dispatch path (m4, pinned in slice 3). The `tool.invoke` frame carries a `CapabilityDigestView` (digest, resources, expiry), never the signed capability token, which stays host-side.

The host validates every inbound frame at the process boundary against the protocol shapes and the plugin's trusted manifest, and refuses fail-closed: a protocol or manifest-digest mismatch, a tool name the manifest does not declare, or an invalid payload closes the session rather than continue with a plugin whose declared and actual behavior disagree. Each registration's disposer is held by the session and released by the single disposer `attachPluginRpcHost` returns, so a session's teardown — which slice 2 binds to the plugin process's lifecycle — leaves no live registration.

The transport is consumed structurally (`PluginRpcTransport`), not as the SDK's `JsonRpcLineTransport` type, so the slice-2 process transport and slice 1's in-memory test transport both satisfy it and this package depends on neither the SDK transport nor the manifest parser (tool names arrive as trusted strings).

## Alternatives considered

- **A Cordis service with an `attach` method.** Rejected: slice 1 has no provider until slice 2, so a service contract would have zero current callers — the package rules forbid building a service ahead of its consumer. A library function taking `ctx` is the plugin-installer precedent and defers the mount decision to slice 2.
- **Reuse the August `feat/p1-06-plugin-host` prototype** (`plugin-host` + `plugin-host-protocol`, a supervisor/rpc/crash-isolation pair). Rejected as a base: it predates the capability-seam, ActionManifest-gate and `ctx.effect` conventions and would have to be rebuilt to honor them; it is retired, not extended.
- **Enforce the manifest-declared check inside the plugin or the schema.** Rejected: the refusal of an undeclared tool is enforced in the host's registration operation and closes the session, because a check the plugin could bypass is not enforcement. The one obligation left to the caller — that `declaredTools` comes from the trusted locked manifest, never from the untrusted plugin — is documented on the option and carried into slice 2's wiring.

## What we gave up

Third-party tools get no custom rich rendering (§10(c)): the host renders a plugin's canonical value with a fixed text/JSON projection. Events and UI registration are deferred to later slices (§10(b)): slice 1's plugin→host allow-list is the handshake, the tool methods, and `log`. The non-unit real-composition proof waits for slice 2, since slice 1 makes no process; slice 1 is exercised with an in-memory transport and the slice's red-first cases. The Chinese projection of this note and of the package README, and the documentation gates, are a deferred doc-sync follow-up.
