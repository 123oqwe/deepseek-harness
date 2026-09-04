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
4. **Kernel isolation.** A `kernel`-layer package may never depend on a `providers`, `orchestration-runtime`, or `surfaces-apps` package, and gets no rule-2 exception: an upward kernel edge is a violation even when it is type-only. Its dependency on the vendored Cordis runtime is measured **per imported binding, not per package**, because the Trust Kernel is *pinned into* a Cordis `Context` by construction (`pinTrustKernel` calls `ctx.provide` and reads `ctx.root[Context.isolate]`), so a blanket "no Cordis" reading would forbid the mechanism the layer is defined by. Exactly one binding is therefore permitted to a `kernel`-layer package: `Context`, from `@deepseek-ai/cordis`. Every other binding is the composition machinery the kernel must not participate in (root `CLAUDE.md`: "The Trust Kernel is the one non-plugin exception") — `Service`, `Plugin`, `Fiber`, `Inject`, `Registry`, any other `@deepseek-ai/cordis` export, and every export of any other vendored package (`@deepseek-ai/cordis-loader`, `-hmr`, `-logger-console`, `@deepseek-ai/cosmokit`, `@deepseek-ai/schemastery`) — and importing one is a violation whether it is imported as a value or as a type. Because the permitted-binding test decides whether a kernel-to-Cordis edge exists at all, only a forbidden binding reaches [`classifyEdge`](../../scripts/architecture/layer-order.ts), which then returns `layer-violation` for it as a kernel edge leaving the six-layer graph.
5. **No unexempted cycles.** The package dependency graph must be acyclic, except for a cycle covered by an [`ExemptedCycle`](../../scripts/architecture/layer-order.ts) entry — a reason, an owner, an ISO `recordedDate`, and `adrNote`, a repo-relative path to the Agent Note recording the decision (this repo's concrete equivalent of an ADR; root `CLAUDE.md`: "Non-trivial changes MUST include an Agent Note"). Those entries, and the dated kernel-edge allowlist rule 6 defines, live in [`tests/first100/architecture.layers.json`](../../tests/first100/architecture.layers.json) — a data store the checker reads and never writes, so a gate cannot widen its own escape hatch.
6. **A recorded kernel-edge exception expires.** A kernel edge that rules 1–4 forbid, that is genuinely required, and that cannot be removed from within the slice that finds it, is recorded in `tests/first100/architecture.layers.json`'s `kernelEdgeAllowlist` with the edge, an `owner`, a `reason`, and an ISO `expires` date. A recorded entry suppresses that one edge's violation until its date passes; an entry whose `expires` date has passed is itself a violation, and an entry naming an edge that no longer exists is a violation too, so the list cannot rot into permanent cover. This is the epic gate's "kernel reverse edges and expired allowlist = 0".

## Detection

A real scanner resolves a dependency edge through three channels: the declared package.json graph (`dependencies`/`peerDependencies`), a TypeScript path-alias import, and a dynamic `require()`/`import()` call invisible to a static package-graph walk. Which channel found an edge never changes its verdict under the rules above — only the edge's layer relationship and its nature (an ordinary value dependency, a narrow event-type import, or a global-singleton bypass) do.

## Enforcement

`pnpm architecture:layers` runs the real checker (`scripts/architecture/check-layer-deps.mjs`, U-stage) and must complete within 10 seconds, reporting the shortest violating cycle's path when the graph has an unexempted one. It is wired into CI as a blocking gate.
