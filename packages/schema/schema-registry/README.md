---
description: "Unified schema registry for persisted and wire-protocol leaf objects: schemaId identity, major/minor versioning, compatibility-rule enforcement, and read-time negotiation."
kind: "package-reference"
---

# @deepseek-ai/dsh-schema-registry

English | [中文](README.zh.md)

## Summary

`dsh-schema-registry` gives every persisted and wire-protocol LEAF object — session-event payload shapes, SDK protocol wire types, and future leaf objects such as settings shapes — a `schemaId`, a major/minor version, and a real compatibility rule: an additive change bumps only `minor`; a deletion, rename, or semantic change requires a `major` bump and a migration function. It is orthogonal to `SESSION_FORMAT_VERSION` (`@deepseek-ai/dsh-session`), which continues to govern only the session log's own container format — this registry never references, wraps, or proxies it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Registering a schema's first version

```ts
import { brandString } from '@deepseek-ai/dsh-brand'
import { identityMigration, registerSchema, type SchemaId } from '@deepseek-ai/dsh-schema-registry'

registerSchema(brandString<SchemaId>('my-package:MyPayload'), { major: 1, minor: 0 }, identityMigration)
```

A schema's first version has no true predecessor payload, so its migration is the identity function. `registerSchema` rejects a second registration under the same `schemaId` — it never silently replaces an existing entry.

### Evolving a schema

`evolveSchema` enforces the version-bump rule from the declared `FieldChange`s: a change set that is entirely `'additive'` may only bump `minor`; a change set containing any `'breaking'` change must bump `major` by exactly 1 and reset `minor` to `0`. A mismatched bump is rejected before anything is committed, and the prior version stays in the schema's `history`.

```ts
evolveSchema(
  id,
  [{ field: 'newField', kind: 'additive', reason: 'optional, ignorable-safe' }],
  { major: 1, minor: 1 },
  identityMigration,
)
```

### Negotiating compatibility

`negotiateSchema(schemaId, encounteredVersion)` is the read-time check a consumer (session replay, SDK initialize, plugin load) uses before trusting a payload written at a possibly different version. Same `major` is always compatible, regardless of minor difference; a different `major` or an unregistered `schemaId` returns a structured `SchemaCompatibilityError` — never a bare string, and the function never inspects or strips a payload's fields, so it cannot itself cause silent field loss.

```ts
const result = negotiateSchema(id, encounteredVersion)
if (!result.compatible) {
  // result.error is a SchemaCompatibilityError: { code, schemaId, encounteredVersion, registeredVersion }
}
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `registerSchema`/`evolveSchema`/`negotiateSchema`/`getSchema`/`listSchemas`, plus the bootstrap that registers every known session-event and SDK-protocol schema |
| [`src/types.ts`](src/types.ts) | `SchemaId`, `SchemaVersion`, `FieldChange`, `RegisteredSchema`, and error-code types |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; see file) |

### Bootstrap registrations

Importing this package registers, at version 1.0 with an identity migration: every type name in `KNOWN_SESSION_EVENT_TYPES` (`@deepseek-ai/dsh-session`) as `session-event:<type>`, and every named wire type `@deepseek-ai/dsh-sdk-protocol`'s `src/types.ts` documents (via its own schemaId doc comment on each interface) as `sdk-protocol:<TypeName>`. The protocol list is mirrored by hand in `src/index.ts` — protocol's package exports carry no runtime value for it — and must stay in sync when a wire type is added or removed there.

### Deferred: real migration bodies

Every migration registered in this C-stage slice is the identity function, because every current registration is a schema's own first version, which has no predecessor payload to transform. A real, non-identity migration body for a schema's second-and-later version is a later, P-stage concern (`migrate.ts`).

### Deferred: wiring into read paths

`negotiateSchema` is a complete, real function, but no call site yet invokes it during session replay, SDK `initialize`, or plugin load — that wiring is a later, U-stage concern.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None; this is an internal versioning and negotiation library with no tool surface or model-visible output.

#### KV Cache effect

No direct effect; nothing in this package places content into a model request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Real migration bodies are deferred** — every currently registered schema is at its own first version, so every migration function here is the identity function; a real transformation body lands with a schema's second version in the later `migrate.ts` P-stage slice.
- **Not yet wired into a read path** — `negotiateSchema` is real and tested but no session-replay, SDK-initialize, or plugin-load call site invokes it yet; that integration is a later U-stage slice.
- **The SDK-protocol schemaId list is hand-mirrored** — `src/index.ts`'s `PROTOCOL_WIRE_SCHEMA_IDS` must be kept in sync by hand with the schemaId doc comments in `@deepseek-ai/dsh-sdk-protocol`'s `src/types.ts`; nothing currently cross-checks them automatically.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
