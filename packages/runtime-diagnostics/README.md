---
description: "The runtime-diagnostics group map: package-owned runtime invariant checks for live compositions, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/runtime-diagnostics

English | [中文](README.zh.md)

## Summary

The runtime-diagnostics group provides runtime self-checking and operator-visible diagnostics for DeepSeek Harness compositions. `invariants` runs package-owned checks that verify each package's durable event and data relationships while the composition is live; a violation surfaces as an error attributed to the package that owns the relationship, and a global switch and package-name filters control which checks run. `logger-stderr` writes the warnings and errors plugins log to stderr, where an operator sees them. Use `invariants` when a composition should verify its own runtime contracts, and rely on `logger-stderr`, which every shipped profile mounts, to see what plugins report.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`invariants`](invariants/README.md) | Runs package-owned runtime checks and reports each failure by owning package | registers on `ctx.invariants` |
| [`logger-stderr`](logger-stderr/README.md) | Writes plugin warnings and errors to stderr, prefixed `dsh: `; a host may route the lines | registers on `ctx.loggerStderr` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Runtime invariants subsystem](../../docs/subsystems/invariants.md) — the generated service reference: selection, installer, and companion contract.
- [Invariant runtime contracts Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md) — what a runtime invariant may assert and the mechanical gate enforcing companion wiring.
- [Package conventions](../AGENTS.md) — the `./invariant` companion rule every package follows.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
