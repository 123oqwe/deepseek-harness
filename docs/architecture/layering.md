# Package Layering

Epic P0-04 (`建立分层依赖与禁止环规则`) defines the layer sequence every `packages/*/*` workspace package composes from, and the rules a dependency-graph checker enforces against it. This page names the layers and rules precisely; [`scripts/architecture/layer-order.ts`](../../scripts/architecture/layer-order.ts) is the real contract (types, the layer sequence, and the classification functions), and [`tests/architecture/layer-deps.spec.ts`](../../tests/architecture/layer-deps.spec.ts) exercises it. The real repo-wide scan — walking every workspace `package.json`, resolving tsconfig path aliases, and finding dynamic `require()`/`import()` calls — is `scripts/architecture/check-layer-deps.mjs`, a later slice; this page and `layer-order.ts` define the rules that scanner will enforce, not the scan itself.

## The layer sequence

Six layers, low to high. A package may only depend on a package at a strictly lower or equal layer, subject to the exceptions below.

| Layer | Role | Example packages |
|---|---|---|
| `kernel` | The Trust Kernel boundary: root identity, signature roots, policy enforcement, audit append, secret-broker handle, sandbox-attestation verifier ([boundary](trust-kernel-boundary.md)) | `@deepseek-ai/dsh-trust-kernel` |
| `protocol-types` | Wire-protocol and generated type definitions, with no capability logic and no concrete provider | `@deepseek-ai/dsh-typert-protocol`, `@deepseek-ai/dsh-sdk-protocol` |
| `capability-definitions` | A capability family's Service Definition — the abstract seam a provider implements and a consumer depends on ([capability seam](../glossary.md#capability-seam)) | `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-shell` |
| `providers` | Concrete Service Provider implementations of a capability definition | `@deepseek-ai/dsh-llm-deepseek`, `@deepseek-ai/dsh-bash-local` |
| `orchestration-runtime` | Composition and execution: the agent loop, agent services, and the plugins that wire capabilities together at runtime | `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-agent` |
| `surfaces-apps` | User- and operator-facing surfaces: the web client and the HTTP/host gateway | `@deepseek-ai/dsh-client-web`, `@deepseek-ai/dsh-host-webserver` |

`scripts/architecture/layer-order.ts`'s `KNOWN_PACKAGE_LAYERS` is a curated, real subset of this assignment — not every workspace package. Computing every package's layer from its real position in the workspace tree is the U-stage scanner's job.

The vendored Cordis runtime (`@deepseek-ai/cordis`) sits outside this six-layer graph entirely: every harness package except the kernel takes it as a peer dependency (root `CLAUDE.md`), so it is not itself assigned one of the six layers above.

## Rules

1. **No upward dependencies.** A package may not depend on a package at a strictly higher layer.
2. **Narrow event-type sharing is allowed.** A type-only import of a documented `*EventMap` declaration-merge target (`packages/AGENTS.md`: "Typed events use declaration merging and merge-extensible maps") may cross layers upward. This is the one exception to rule 1.
3. **Global-singleton bypass is forbidden**, regardless of layer direction. Reaching another layer's state through a shared mutable global or module-level singleton — instead of the capability-seam `ctx`-based channel — is a violation even where the equivalent `ctx`-based edge would be legal or where no layer boundary is crossed at all.
4. **Kernel isolation.** A `kernel`-layer package may never depend on the vendored Cordis runtime, a `surfaces-apps` package, or a concrete model `providers` package.
5. **No unexempted cycles.** The package dependency graph must be acyclic, except for a cycle covered by an [`ExemptedCycle`](../../scripts/architecture/layer-order.ts) entry — a reason, an owner, an ISO `recordedDate`, and `adrNote`, a repo-relative path to the Agent Note recording the decision (this repo's concrete equivalent of an ADR; root `CLAUDE.md`: "Non-trivial changes MUST include an Agent Note").

## Detection

A real scanner resolves a dependency edge through three channels: the declared package.json graph (`dependencies`/`peerDependencies`), a TypeScript path-alias import, and a dynamic `require()`/`import()` call invisible to a static package-graph walk. Which channel found an edge never changes its verdict under the rules above — only the edge's layer relationship and its nature (an ordinary value dependency, a narrow event-type import, or a global-singleton bypass) do.

## Enforcement

`pnpm architecture:layers` runs the real checker (`scripts/architecture/check-layer-deps.mjs`, U-stage) and must complete within 10 seconds, reporting the shortest violating cycle's path when the graph has an unexempted one. It is wired into CI as a blocking gate.
