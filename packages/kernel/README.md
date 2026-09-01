---
description: "The kernel package group: the minimal, non-replaceable Trust Kernel type surface every other part of dsh composes around, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/kernel

English | [中文](README.zh.md)

## Summary

The kernel group holds Epic P0-02's minimal, non-replaceable Trust Kernel boundary: the narrow, unforgeable capability surface — root identity, signature roots, a policy-enforcement entrypoint, audit-append, a secret-broker handle, and a sandbox-attestation verifier — the kernel may ever hand to the runtime, and nothing else. Everything else in dsh — models, tools, storage providers, workflow, memory providers, UI — stays an ordinary, replaceable Cordis plugin; see `docs/architecture/trust-kernel-boundary.md` for the full boundary and why none of the six capabilities is a Cordis Service. This group currently ships one package's Contract-stage slice only: the `TrustKernel` type surface, with no constructed value or `ctx.provide` wiring yet.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`trust-kernel`](trust-kernel/README.md) | Minimal, non-replaceable Trust Kernel capability surface: root identity, signature roots, policy enforcement, audit append, secret broker handle, sandbox attestation verifier | none yet (Contract-stage; no `ctx.provide` wiring) |

-----

<a id="related-documentation"></a>
## Related documentation

- [Trust Kernel boundary](../../docs/architecture/trust-kernel-boundary.md) — what the kernel owns, why none of it is a Cordis Service, and the plugin/never-plugin split around it.
- [Trust Kernel specification](../../spec/trust-kernel.md) — the normative capability surface and Epic P0-02's must/acceptance clauses.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
