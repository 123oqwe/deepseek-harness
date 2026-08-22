# Package Layering Rules

This document defines the canonical layer graph for all official and recovery packages.
The `scripts/architecture/check-layer-deps.mjs` checker enforces these rules in CI.

## Layer Assignments

| Layer | Packages |
|-------|----------|
| 0 (util) | util |
| 1 (kernel) | kernel, boot/kernel |
| 2 (schema/assurance) | schema, assurance |
| 3 (core/sdk/policy) | core, sdk, policy, action, migration, plugin, workspace |
| 4 (domain) | llm, shell, fs, sandbox, session, interaction, identity, settings, credentials, compaction, context, subagent, terminal, lsp, skill, web, workflow, todo, plan, preset, guard, hooks, memory, code, attachment, session_query |
| 5 (host/runtime) | boot, bundle, extensions, host, jobs, mcp, goal, spill, storage, runtime, run, support, feedback, schedule, test_support |
| 6 (client/examples) | client, examples |
| 7 (apps) | apps |

## Rules

1. **No upward dependencies.** A package at layer N may only import from packages at layer < N.
2. **No cycles.** The package dependency graph must be acyclic.
3. **Kernel isolation.** Layer 1 (kernel) packages must not depend on Cordis UI, specific model providers, or any layer > 1 package.
4. **Policy isolation.** Layer 3 (policy) packages must not depend on domain or host packages.
5. **Exemptions.** Packages may be exempted only by explicit entry in the checker's exemption list, with a documented reason.

## Enforcement

Run `pnpm architecture:layers` to check. The command exits non-zero if any upward dependency or cycle is detected.
This check is wired into `pnpm first100:architecture` and is blocking in CI.
