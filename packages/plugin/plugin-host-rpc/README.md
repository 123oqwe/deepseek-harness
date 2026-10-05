---
description: "Epic P1-06 slice 1: the capability-scoped RPC registration seam between a host and an untrusted plugin. Only serializable JSON crosses the boundary; the host validates every frame, registers a plugin's manifest-declared tools as proxy ToolDefinitions whose execute dispatches one host-stamped tool.invoke through the ordinary ActionManifest-gated path, and binds every registration to the plugin session so it is revoked on exit. The process transport that spawns the plugin is slice 2."
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-host-rpc

## Summary

`dsh-plugin-host-rpc` is the capability-scoped RPC registration seam for Epic P1-06's out-of-process plugin host (m1, m2). A plugin runs in its own process and may register tools, events, and UI descriptions only over this RPC, sending purely serializable JSON: a host `Context`, a credential, a function, or a mutable reference cannot cross, because the wire carries only JSON (m2 is a structural property of the protocol, not a runtime check). The host validates every inbound frame at the process boundary against the protocol shapes and the plugin's trusted, locked manifest; it does not trust the plugin's declared TypeScript.

Slice 1 ships three seam roles as a library:

- **Service Definition** (`src/types.ts`, `src/protocol.ts`): the protocol — method allow-list, the four-element invocation identity, the closed refusal codes, and the session lifecycle. `validateHello` and `validateToolRegistration` are the fail-closed validators.
- **Provider** (`src/host-decoder.ts`): `attachPluginRpcHost` binds one plugin session's transport, runs the `host.hello` handshake, and drives the registration loop. A fail-closed refusal (`PROTOCOL_VERSION_MISMATCH`, `MANIFEST_MISMATCH`, `NOT_DECLARED`, `INVALID_PAYLOAD`) closes the session.
- **Consumer** (`src/registration-consumer.ts`): `registerProxyTool` turns one validated registration into a proxy `ToolDefinition` and registers it through `ctx.tools`. The proxy carries no plugin code; its `execute` sends one `tool.invoke` stamped with the host's four-element identity, and its output projection is a fixed host implementation keyed by the declared render mode.

The transport is consumed structurally (`PluginRpcTransport`), so the slice-2 process transport and an in-memory test transport both satisfy it without this package depending on the SDK transport implementation.

## Use this package

```ts
import { attachPluginRpcHost } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context // a host context composing the `tools` service
declare const options: import('@deepseek-ai/dsh-plugin-host-rpc').PluginRpcHostOptions

// The process provider (slice 2) supplies the transport, the trusted manifest
// facts, the minted session id, and the derived capability. The returned
// disposer revokes every registration this session made and closes the
// transport; slice 2 binds it to the plugin session scope.
const disposeSession = attachPluginRpcHost(ctx, options)
// ... later, on plugin exit / crash / protocol violation:
disposeSession()
```

`attachPluginRpcHost` is transport-agnostic and makes no process: slice 1 is exercised with an in-memory `PluginRpcTransport`. `options.declaredTools` MUST come from the trusted, locked manifest — never from anything the untrusted plugin influences — or the manifest-declared refusal is meaningless.

## Understand the implementation

A proxy tool's `execute` does not re-implement dispatch: it runs through the ordinary `ctx.tools.execute` path, so the ActionManifest gate and the capability check run before the RPC is sent (m4 — slice 3 pins this). The `tool.invoke` frame carries a `CapabilityDigestView` (digest, resources, expiry), never the signed capability token, which stays host-side (§10(a)). Every registration's disposer is held by the session and released by the returned disposer, so a session's teardown leaves no live registration.

## Model Experience

A plugin's registered tool appears to the model exactly like a native tool: `schemas()` exposes only its name, description, and parameters, never the render mode, risk-domain tags, timeout, or any RPC/transport vocabulary. Each registered tool adds its schema to the model's tool list, with the same token cost as a native tool of the same schema size; there is no additional per-call token or KV-cache effect, since the RPC is invisible to the model — a plugin tool result is an ordinary tool result. A plugin that registers no tool changes nothing the model sees.

## Known Limitations and Deferred Work

- **No process transport yet.** Slice 1 is a library consumed by slice 2, which spawns the plugin process and supplies the `PluginRpcTransport`. The non-unit real-composition test (booting a profile that mounts a plugin out-of-process) belongs to slice 2; slice 1 is exercised with an in-memory transport.
- **`declaredTools` is a caller trust obligation.** The host refuses an undeclared tool name, but only the caller can guarantee `declaredTools` came from the trusted, locked manifest rather than the untrusted plugin. Slice 2 wires it from the trusted source.
- **No custom rich rendering for plugin tools (§10(c)).** A function cannot cross the process boundary, so a plugin tool's output is rendered by a fixed host projection keyed by the declared `render` mode (`text` or `json`); a plugin cannot ship its own `render`/`presentationMeta`/`finalizeContent`.
- **Event and UI registration are later slices (§10(b)).** Slice 1's plugin→host allow-list is the handshake and the tool methods plus `log`; `events.subscribe`/`events.emit`/`ui.describe` are not yet accepted, and the event whitelist is empty.
- **Bilingual projection deferred.** The Chinese README and the documentation gates are a follow-up (doc-sync / translation on invocation), not part of this source slice.

## Dev Note

This package publishes no `./invariant` companion: it constructs no owned registry or mutable relation whose divergence an independent observer could check. Its registrations are observed through `ctx.tools` (the tool registry's own disposal proof), and its refusals are observed through the executor, not through a relation this package owns.
