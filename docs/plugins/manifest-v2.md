# Plugin Manifest v2

English | [中文](manifest-v2.zh.md)

Plugin Manifest v2 (Epic P1-01) is a static capability declaration a plugin package carries under `package.json`'s `dsh` field, so an installer, a policy engine, or an administrator can know what a plugin accesses, exposes, and modifies before it ever executes. This page covers the format's fields and rules; the type contract and validation logic live in [`@deepseek-ai/dsh-plugin-manifest`](../../packages/plugin/plugin-manifest/README.md), and the wire schema is [`spec/capability-manifest.schema.json`](../../spec/capability-manifest.schema.json) (JSON Schema, draft 2020-12).

## Where a manifest lives

`package.json`'s `dsh` field already carries two shapes: `dsh.profile` (a profile's bundle list) and `dsh.bundle` (a bundle's `cordis.patch.yml` pointer — see [`architecture.md#profiles-and-bundles`](../architecture.md#profiles-and-bundles)). A Plugin Manifest v2 declaration is a third shape, `dsh.manifestVersion === 2`, additive to (never replacing) those: a package may carry a manifest alongside a bundle patch.

```jsonc
{
  "dsh": {
    "manifestVersion": 2,
    "tools": [ /* … */ ],
    "executionMode": "in-process",
    "compatibility": { "dshVersionRange": ">=0.1.0 <1.0.0" }
  }
}
```

## Fields

`executionMode` and `compatibility` are always present; every other field is an array or object a plugin includes only for the capabilities it actually has — an absent field means "declares none of this kind."

| Field | Declares |
|---|---|
| `services` | Cordis Service Definitions/Providers/Consumers this plugin provides or requires, by `ctx` key |
| `tools` | Model- or user-facing tools this plugin registers, each with the effect fields below |
| `skills` | Skills this plugin contributes, kebab-case named per `@deepseek-ai/dsh-skill`'s `SKILL_NAME` grammar |
| `mcp` | MCP servers this plugin connects to, and each server's resources and prompts |
| `events` | Cordis events this plugin emits or intercepts, with `@deepseek-ai/cordis`'s own `DispatchMode` |
| `filesystem` | Path patterns this plugin reads from or writes to, outside any one tool's own declaration |
| `network` | Host patterns this plugin may reach, outside any one tool/MCP declaration |
| `process` | Command patterns this plugin may spawn, outside any one tool declaration |
| `secrets` | Credentials this plugin requests, by key and justification |
| `uiSurfaces` | Host-rendered UI surfaces this plugin contributes to |
| `dataStores` | Named storage domains this plugin owns |
| `migrations` | Schema migration steps this plugin's data stores require |
| `executionMode` | How this plugin's own code executes: `'in-process'`, `'worker-thread'`, `'process'`, or `'container'` |
| `compatibility` | The harness version range this manifest is valid for |

## Every Tool/MCP capability declares four effect fields

Each entry in `tools`, each MCP server in `mcp.servers`, and each remotely-sourced entry in `skills[].remoteProvider` declares:

- **`sideEffectClass`** — `'none'`, `'read'`, `'write'`, `'network'`, `'process'`, or `'destructive'`, the highest-impact effect that applies.
- **`authAudience`** — who may invoke it without further per-call confirmation: `'model'` (autonomous tool-calling), `'user'` (requires human origination or confirmation), `'service'` (harness-internal only). At least one audience.
- **`allowedDestinations`** — the filesystem paths, network hosts, or process commands it may reach. A Tool's list may be empty (a pure computation reaches nothing); an MCP server's or a remote Skill Provider's list may not — a remote provider always connects somewhere, so an empty list is itself an undeclared network destination.
- **`dataClassification`** — `'public'`, `'internal'`, `'confidential'`, or `'secret'`, the sensitivity of data it may read, produce, or transmit.

An MCP server and a remotely-sourced skill provider additionally declare `transport` (`'stdio'` or `'streamable-http'`, matching `@deepseek-ai/dsh-mcp-client`'s real transport union) and `authMechanism` (`'none'`, `'header-credential'`, `'oauth'`, or `'mtls'`).

## Static data, never generated code

A manifest is literal JSON embedded in `package.json`; nothing about reading one imports, `require`s, or otherwise executes the plugin package's own code. `@deepseek-ai/dsh-plugin-manifest`'s validator rejects a value carrying a function, a `symbol`, or `undefined` nested inside an array — none of these can survive `JSON.parse`, so their presence proves the value was built by running code rather than parsing a file.

## Legacy `dsh.bundle` compatibility

A package carrying only the pre-existing `dsh.bundle` format (no `dsh.manifestVersion`) is still read, but classified `'legacy-untrusted'`: the old format declares no capability at all, only a patch-file pointer, so there is no declared permission surface to trust. A production profile denies a `'legacy-untrusted'` or a `'missing'` declaration by default.

## Wildcard permissions

A destination pattern of exactly `'*'`, `'**'`, or `'/'` is maximally broad for its kind and is flagged as a wildcard-permission request — the schema/type surface's detectable half of the installer's "missing, wildcard, or declaration/observation mismatch quarantines" gate; the installer decision itself is a later stage's runtime concern.

## Fault tolerance against adversarial input

The static-data check walks the *whole* raw `dsh` value, not just the fields the schema recognizes — an attacker-controlled manifest cannot avoid this walk by hiding a hostile value under an unrecognized property name. That walk used unbounded recursion until Epic P1-01's Fault stage: a manifest that was merely *deep* (a few thousand levels of nesting under any field, not a large one) overflowed Node's call stack, an uncaught `RangeError` that crashed the caller — `pnpm plugin:verify`, or a whole profile boot mid pre-mount admission — instead of a clean validation failure. The walk is now iterative (an explicit work stack, not the JS call stack), so depth alone cannot crash it; a deeply nested manifest is validated or rejected on its actual content like any other input. Capability names throughout this format (`tools[].name`, `services[].ctxKey`, and friends) are ordinary string data compared through `Set`, never used as a plain object's property key, so a name like `'__proto__'` or `'constructor'` behaves exactly like any other string, including through `compareDeclaredToObserved`'s declared-vs-observed comparison.
