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
| `composition-root` | An assembly that composes the surfaces and everything beneath them into a runnable profile or entry binary. Not a seventh layer the others rank against: it sits above `surfaces-apps` and is depended on by nothing inside `packages/` | `packages/bundle/*`, `apps/*` |
| `test-support` | Test-time assembly of the thing under test. Outside the ranking for the same reason as a composition root: it may depend on any layer, and no production package depends on it (rule 6) | `packages/test-support/*` |

`scripts/architecture/layer-order.ts`'s `KNOWN_PACKAGE_LAYERS` is a curated, real subset of this assignment — not every workspace package. Computing every package's layer from its real position in the workspace tree is the U-stage scanner's job.

The vendored Cordis runtime (`@deepseek-ai/cordis`) sits outside this six-layer graph entirely: every harness package except the kernel takes it as a peer dependency (root `CLAUDE.md`), so it is not itself assigned one of the six layers above.

## Rules

1. **No upward dependencies.** A package may not depend on a package at a strictly higher layer. A **composition root** is the one position outside that ranking, and it carries two halves that must both be stated. First: a composition root **may depend on any layer**, because composing the whole stack into a runnable profile is what it is for. Second, and the half that makes the position a rule rather than an exemption: **no layer may depend on a composition root.** Without the reverse constraint, adding a top position would not add a rule, it would remove one — every edge a composition root participates in would become legal in both directions. The reverse constraint is what is actually enforced, and it is proven by mutation like rule 4, not asserted.

   The position exists because the six-layer sequence had no place for an assembly. Structurally, nothing under `packages/` depends on a bundle except another bundle: `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-acp-app` are depended on only by `apps/cli`, and `@deepseek-ai/dsh-sdk-app` only by `apps/cli` and `packages/bundle/sdk-minimal`. A composition root may depend on anything precisely because nothing depends on it, so it creates no inversion of control.
2. **Narrow event-type sharing is allowed.** A type-only import of a documented `*EventMap` declaration-merge target (`packages/AGENTS.md`: "Typed events use declaration merging and merge-extensible maps") may cross layers upward. This is the one exception to rule 1.
3. **Global-singleton bypass is forbidden**, regardless of layer direction. Reaching another layer's state through a shared mutable global or module-level singleton — instead of the capability-seam `ctx`-based channel — is a violation even where the equivalent `ctx`-based edge would be legal or where no layer boundary is crossed at all.
4. **Kernel isolation.** A `kernel`-layer package may never depend on a `providers`, `orchestration-runtime`, or `surfaces-apps` package, and gets no rule-2 exception: an upward kernel edge is a violation even when it is type-only. Its dependency on the vendored Cordis runtime is measured **per imported binding, not per package**, because the Trust Kernel is *pinned into* a Cordis `Context` by construction (`pinTrustKernel` calls `ctx.provide` and reads `ctx.root[Context.isolate]`), so a blanket "no Cordis" reading would forbid the mechanism the layer is defined by. Exactly one binding is therefore permitted to a `kernel`-layer package: `Context`, from `@deepseek-ai/cordis`. Every other binding is the composition machinery the kernel must not participate in (root `CLAUDE.md`: "The Trust Kernel is the one non-plugin exception") — `Service`, `Plugin`, `Fiber`, `Inject`, `Registry`, any other `@deepseek-ai/cordis` export, and every export of any other vendored package (`@deepseek-ai/cordis-loader`, `-hmr`, `-logger-console`, `@deepseek-ai/cosmokit`, `@deepseek-ai/schemastery`) — and importing one is a violation whether it is imported as a value or as a type. A composition root's own outgoing edges never reach [`classifyEdge`](../../scripts/architecture/layer-order.ts) either, and `PackageLayer` deliberately does not gain a seventh member: the position is resolved in `check-layer-deps.mjs` before ranking, so P0-04's frozen Contract-stage layer sequence is unchanged. Because the permitted-binding test decides whether a kernel-to-Cordis edge exists at all, only a forbidden binding reaches `classifyEdge`, which then returns `layer-violation` for it as a kernel edge leaving the six-layer graph.
5. **No unexempted cycles.** The package dependency graph must be acyclic, except for a cycle covered by an [`ExemptedCycle`](../../scripts/architecture/layer-order.ts) entry — a reason, an owner, an ISO `recordedDate`, and `adrNote`, a repo-relative path to the Agent Note recording the decision (this repo's concrete equivalent of an ADR; root `CLAUDE.md`: "Non-trivial changes MUST include an Agent Note"). Those entries, and the dated kernel-edge allowlist rule 7 defines, live in [`tests/first100/layer-cycle-exemptions.json`](../../tests/first100/layer-cycle-exemptions.json) — a data store the checker reads and never writes, so a gate cannot widen its own escape hatch.
6. **`packages/test-support/**` is outside the ranking, on the composition-root pattern.** A test-support package's job is to assemble the thing under test, so it may depend on any layer; and no production package depends on it. Both halves are enforced, and the second is the one that matters: a ranked package depending on `test-support/**` is a violation. The exclusion is declared here and at `TEST_SUPPORT` in the checker rather than left as a convenient default, because an undeclared exclusion and a quietly loosened assertion are the same defect — correct today, with the reason unwritten, so the next reader cannot tell whether it is still correct.
7. **A recorded kernel-edge exception expires.** A kernel edge that rules 1–4 forbid, that is genuinely required, and that cannot be removed from within the slice that finds it, is recorded in `tests/first100/layer-cycle-exemptions.json`'s `kernelEdgeAllowlist` with the edge, an `owner`, a `reason`, and an ISO `expires` date. A recorded entry suppresses that one edge's violation until its date passes; an entry whose `expires` date has passed is itself a violation, and an entry naming an edge that no longer exists is a violation too, so the list cannot rot into permanent cover. This is the epic gate's "kernel reverse edges and expired allowlist = 0".

## Detection

A real scanner resolves a dependency edge through three channels: the declared package.json graph (`dependencies`/`peerDependencies`), a TypeScript path-alias import, and a dynamic `require()`/`import()` call invisible to a static package-graph walk. Which channel found an edge never changes its verdict under the rules above — only the edge's layer relationship and its nature (an ordinary value dependency, a narrow event-type import, or a global-singleton bypass) do.

## Pass conditions and observations

`pnpm run architecture:layers` fails on exactly four zeros, and reports everything else. The distinction is deliberate: a gate that is permanently red in today's repository degrades into one nobody reads, and an unlabelled list of violations is read as accepted status quo.

**Pass conditions** — the gate exits non-zero on any of these:

| Zero | Source |
|---|---|
| unexempted cycles in the production package graph | acceptance[0] |
| kernel reverse edges | acceptance[1] and the epic gate |
| expired or stale `kernelEdgeAllowlist` entries | the epic gate |
| global-singleton bypasses (rule 3) | must[1] |

Plus two conditions the gate also gives up on: every package classified (the epic gate), and completion within 10 seconds (acceptance[2]).

**Observations** — reported, never failed on. A generic upward edge between two ranked layers is a finding. No registry clause requires zero of them: must[0] requires the order be *defined*, must[2] requires the three channels be *detected*, acceptance[0] is about cycles, and the epic gate names only the two zeros above. Findings are printed to stdout labelled `finding (not a failure)` and persisted to [`scripts/architecture/layer-findings.md`](../../scripts/architecture/layer-findings.md) by `--write-findings`, so they outlive a CI log.

## Enforcement

`pnpm architecture:layers` runs the real checker (`scripts/architecture/check-layer-deps.mjs`, U-stage) and must complete within 10 seconds, reporting the shortest violating cycle's path when the graph has an unexempted one. It is wired into CI as a blocking gate.
