---
description: "The action group map: the manifest that states what a tool call is about to do, and the ledger that keeps one external effect from happening twice, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/action

English | [中文](README.zh.md)

## Summary

The action group answers two questions about one attempted effect: **what is it** — a manifest naming the capability, the arguments in canonical form, and the side-effect class — and **has it already happened** — a ledger that reserves before a send and records the outcome after, so a retry cannot produce a second effect. The pair is deliberately separate: the manifest is the question a policy engine decides, and the ledger is the record that decision leaves behind. Neither registers a tool or reaches a model request; what a model observes is whether its call ran, never the bookkeeping.

Each package's own README sits one directory down and is English-only for now, which is why the names below are not links: this page would have to claim a Chinese counterpart that does not exist.

## Table of Contents

- [Packages](#packages)
- [What is not arrived yet](#what-is-not-arrived-yet)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| `action-manifest` | Epic P2-03's first-class ActionManifest: construction, RFC 8785 argument canonicalization, the content-addressed digest, and the side-effect classification a policy decision is taken against | — (a library; pure decision functions) |
| `action-ledger` | Epic P4-12's external-effect idempotency ledger: the reservation that authorizes one send, epoch fencing, and the receipt recorded after | `ctx.actionLedger` |

The manifest is the load-bearing idea. **The manifest IS the policy question** — a dispatch path that skipped the decision also skipped the manifest, which is why `assertManifestPrecedesExecution` refuses the order rather than trusting it, and why the ledger's reservation keys on the manifest's digest rather than on a caller-chosen id.

-----

<a id="what-is-not-arrived-yet"></a>
## What is not arrived yet

Taken from each package's own Known Limitations, because a reader comparing this group's prose to a running system should not have to discover the gaps by reading source.

- **The manifest's `requiresApproval` is recorded, not enforced.** No production code reads the flag to gate anything.
- **Every native tool call is currently unclassifiable**, so the fail-closed default is the standing case rather than an edge one.
- **The ledger reserves but does not resolve.** The production caller in the agent loop takes the reservation; the matching resolve is not wired, so `ambiguous` cannot tell "unknowable" from "merely failed".
- **No transport carries the idempotency key.** `idempotencyHeader` names the header a real provider would receive; nothing sends it yet.

-----

<a id="related-documentation"></a>
## Related documentation

- [Policy subsystem](../../docs/subsystems/policy.md) — the authoritative contract for what a manifest is FOR: `PolicyRequest` takes one as a required input, and `enforceManifestedAction` is called where a dispatch path has just appended it.
- [Core subsystem](../../docs/subsystems/core.md) — `ctx.actionLedger`, and the dispatch path that reserves against it.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in each package's README.

The open question the group has not settled is **what a `CapabilityRef` string may say**. Its grammar is deliberately unfixed and the manifest package deliberately does not import the capability-token vocabulary to pin it, so two producers could name the same capability differently and nothing would notice. Fixing it means deciding whether the manifest depends on the token seam or keeps its own names.

The second is **whether a recorded classification should ever be trusted verbatim**. `classifySideEffect` takes a declared class as given and requires approval only for `destructive`; a caller that under-declares is believed. That is defensible while every native call is unclassifiable anyway, and stops being defensible the moment classification starts working.

</details>
