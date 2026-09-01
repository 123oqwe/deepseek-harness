# Agent Note: Schema registry negotiation at real read boundaries

Status: implemented

English | [中文](2026-09-01-schema-registry-negotiation-at-real-read-boundaries.zh.md)

## Problem

`@deepseek-ai/dsh-schema-registry` (Epic P0-06's C-stage and P-stage) built a real `registerSchema`/`evolveSchema`/`negotiateSchema`/`getSchema`/`listSchemas` surface and bootstrapped every session-event and sdk-protocol schema at version 1.0, but nothing in the codebase called `negotiateSchema`/`getSchema` at any real read boundary — the registry was fully built and fully unused. Epic P0-06's must[4] requires session replay, SDK initialize, and plugin load to negotiate/verify a schema before use, and acceptance[1] requires an incompatible client to get a machine-readable error with no silent field loss.

Wiring the session-replay boundary at its wave-map-declared file, `packages/core/session/src/types.ts`, is not buildable: `@deepseek-ai/dsh-schema-registry` already depends on `@deepseek-ai/dsh-session` (a real value import — `KNOWN_SESSION_EVENT_TYPES`, consumed at module-evaluation time to bootstrap session-event schemas). Adding the reverse edge forms an ESM import cycle; verified empirically by attempting it: `dsh-session` becomes unloadable (`TypeError: KNOWN_SESSION_EVENT_TYPES is not iterable`). Separately, `core/session/src/types.ts` is a types-only module and contains no read boundary to wire at all — the actual session-replay read path lives in `@deepseek-ai/dsh-session-persistence-jsonl`.

## Decision

Real `negotiateSchema()` calls are wired into the actual read boundaries, not the wave-map's literal file guesses, with the deviations recorded as manifest patches (`tests/first100/adjudication.json#deliverablePathPatches`, BLOCKED-012's class):

- **Session replay**: `packages/session/session-persistence-jsonl/src/format.ts`'s `SessionLogScanner.consumeEventLine`, immediately after `JSON.parse` and before `decodeStorageRecord`. An unregistered event type is skipped (that is the existing `ignorable`/`known-event-types` mechanism's jurisdiction, not the registry's — every `KNOWN_SESSION_EVENT_TYPES` member is registered by construction, so the skip branch never admits a registered-but-incompatible payload). A registered type with an incompatible major throws `SchemaCompatibilityError` directly, outside any tolerant-corrupt-suffix heuristic.
- **SDK initialize**: `packages/sdk/server/src/server.ts`'s `HarnessSdkJsonRpcServer.initialize()`, as its first four statements, before any other handshake validation.
- **Settings load**: `packages/settings/settings/src/index.ts`'s `SettingsProvider.register()` (cold start) and `.publish()` (hot reload), before the owner's schemastery `resolve()`. Wired here rather than `packages/settings/settings/src/types.ts` because that file declares wire-view/projection types only — the negotiate-before-use point is the provider's runtime read path, not a type declaration. Each settings namespace self-registers its own `settings:${ns}` schema at `register()` time (register-if-absent; a namespace mounts and disposes repeatedly across a process's life).

Both substitute paths (`session-persistence-jsonl/src/format.ts`, `settings/settings/src/index.ts`) are absent from `spec/first100-owner-map.json`'s mechanically-tracked file→epic ownership map — shared infrastructure, not exclusively owned by any epic, so the deviation carries zero owner conflict (BLOCKED-012 condition 2).

`must[4]`'s "plugin load" and the wave-map's "settings load" are treated as the same boundary: `SettingsProvider.register()` is called by a plugin during its own Cordis load and is fiber-scoped to that plugin's lifetime, so the check fires at plugin-load time. It verifies the plugin's settings-section leaf object, not a plugin manifest/ABI schema — no plugin-manifest leaf object exists in the registry yet (that is P1-01/P1-08's future scope).

## Alternatives considered

**Wire session-replay negotiation directly into `core/session`.** Rejected: forms a real ESM cycle (proven, not assumed) and the declared file has no read boundary to wire regardless.

**Have `dsh-session` re-export a lazy/dynamic-import wrapper around the registry to avoid the cycle.** Not pursued: adds indirection to work around a dependency-direction problem that is more honestly fixed by wiring at the layer that already legitimately depends on both packages (`session-persistence-jsonl` already sits above both `dsh-session` and can depend on `dsh-schema-registry` without creating a cycle).

**Treat every unregistered session-event type as a negotiation failure.** Rejected: this was the first implementation attempt and is a real design bug, not a stricter-is-safer choice — it would preempt the existing `ignorable`/legacy-type mechanism's own jurisdiction over genuinely unknown types, rejecting sessions the current mechanism already handles correctly.

## Consequences

Three real, product-visible boundaries now negotiate a schema version before trusting a payload; an incompatible major fails with a structured `SchemaCompatibilityError` (schemaId, encountered/registered versions), never silently. The registry's declared scope boundary against `SESSION_FORMAT_VERSION` (BLOCKED-008: leaf-object versioning only, never the container format) stays intact — no negotiation call references or wraps it, and `packages/core/session/src/repair.ts`/`known-event-types.ts` remain untouched.

The wave-map's per-epic `files[]` declaration is not always literally buildable; `tests/first100/adjudication.json#deliverablePathPatches` gained an optional `epic` field so one epic can carry more than one patch in the same stage (BLOCKED-012), rather than the original one-patch-per-epic shape BLOCKED-001 introduced.
