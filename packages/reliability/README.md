---
description: "The reliability group map: retry classification, one run-wide retry budget, and per-destination circuit breaking, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/reliability

English | [中文](README.zh.md)

## Summary

The reliability group decides whether a failed remote call is worth trying again, how much a run may spend trying, and when an endpoint stops being called at all. With it, every retry layer in a composition draws on ONE run-wide budget instead of each keeping its own, and a failing model endpoint is refused before a request reaches it. The family is optional and host-side only: it registers no tools, injects no prompts and writes no session events, so what a model observes is whether its request was made — never the machinery. Mount it when a composition talks to a remote model provider; a composition that does not can omit the whole group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`retry`](retry/README.md) | The failure taxonomy, the run budget's accounting, and the circuit-breaker Service Definition | `ctx.runRetryUsage` |
| [`retry-cockatiel`](retry-cockatiel/README.md) | Circuit-breaker provider: one `cockatiel` policy per destination | `ctx.circuitBreaker` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Reliability subsystem](../../docs/subsystems/reliability.md) — the authoritative contract: failure facts and classification, budget attribution to the delegation root, and per-destination breaking.
- [LLM Streaming subsystem](../../docs/subsystems/llm-streaming.md) — the adapter contract whose failures this group classifies, and the service that consults the breaker on the first chunk.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Both services are resolved by consumers with `ctx.get`, never `inject`: a hard dependency would stop `llm-retry` and `llm/llm` registering at all in every composition that mounts no retry family, including their own test compositions. Absence therefore has to read as capability absence at each call site, and both consumers fall back to their pre-epic behaviour rather than to an unlimited allowance.

`spendsRetryBudget`'s `hedged` input has no producer yet — hedging is P5-04's — so that rule is proven only against constructed input. The package README records it as a Known Limitation rather than as coverage.

</details>
