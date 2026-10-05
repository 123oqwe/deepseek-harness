# @deepseek-ai/dsh-plugin-host-process

The out-of-process Provider for the P1-06 plugin host RPC seam. `spawnPluginHost`
runs one untrusted plugin in its own Node subprocess, wires the child's stdio to
a line-delimited JSON-RPC transport, and attaches the slice-1 host registration
seam (`@deepseek-ai/dsh-plugin-host-rpc`). The child is a separate OS process, so
the host `Context`, its services, credentials, and the trust kernel are
structurally unreachable from the plugin; the companion `child-runtime` module
runs inside that subprocess and exposes only a `tools` service that forwards
registrations over the RPC. When the child exits — orderly, crash, or kill — the
session's registrations are revoked.

Routing a real profile's layers to this Provider lives in the `dsh` boot
(`apps/cli` `composeProfile` / `boot()`): a third-party layer (not the
installation's own copy) runs here regardless of what its manifest claims
(fail-safe), and a trusted layer runs here when its manifest declares
`executionMode: 'process'`.

## Model Experience

No direct model-visible text. A plugin's tools, once registered over the RPC,
appear in the model's tool list as ordinary tools — their names, descriptions,
and parameter schemas are exactly what the plugin registered, rendered by the
host's fixed text/JSON projection (a plugin cannot ship a render function across
the process boundary). Each `tool.invoke` the host sends the plugin is stamped
with the invoking dispatch's own capability (principal + digest view + deadline),
never a signed token and never anything model-visible. A plugin tool call costs
the same tokens and KV-cache as any other tool: its schema participates in the
prompt and its result in the transcript; the process boundary and the stamped
identity add nothing to either.

## Known Limitations and Deferred Work

- **Process-first, not OS confinement.** This isolates the host's in-process
  capabilities from the plugin (process boundary + capability-scoped RPC +
  scrubbed environment), but does not confine the child at the OS level: the
  child can still make raw filesystem and network syscalls under the user's
  identity. OS confinement of the child (sandbox / microVM) is the sandbox layer
  (P3-12 must[2] / P3-09), a separate execution world.
- **One tools channel.** `child-runtime` exposes only a `tools` forwarding stub;
  a plugin that calls any other service from its context is outside this slice's
  contract. Events and UI surfaces are later P1-06 slices.
