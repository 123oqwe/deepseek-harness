---
description: "Plugin data-migration vocabulary and decisions for Epic P1-10: the manifest's migration DAG, preconditions, backup strategy and rollback support, plus the pure judgements over them — acyclic, admissible, reversible, reconcilable."
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-migrations

English | [中文](README.zh.md)

## Summary

`dsh-plugin-migrations` carries what a plugin's manifest declares about upgrading its own durable data, and the decisions over that declaration: whether the migrations can be ordered at all, which steps carry an installed version to the current one, whether the path can be undone, and whether a snapshot reconciles with the data it claims to cover.

Every export is a pure function. There is no I/O here and no service.

## Table of Contents

- [What this package deliberately does NOT do](#what-this-package-deliberately-does-not-do)
- [must[2] decides that approval is owed, and nothing asks yet](#must2-decides-that-approval-is-owed-and-nothing-asks-yet)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## What this package deliberately does NOT do

**It does not perform an upgrade.** Epic P1-10's must[1] names six phases — freeze, snapshot, migrate in quarantine, validate, atomic switch, health check — and that is an ordering over real effects. A module that could perform one of them would be a second place the upgrade happens; the transaction is the Provider stage's.

**It does not decide preconditions.** A migration's preconditions are reported back to the caller, because this package cannot know whether a disk is writable or an external system is reachable. A precondition silently treated as satisfied would be an upgrade admitted on an assumption nobody made.

**It does not touch workspace files.** `PluginDataSnapshot` covers a plugin's own durable data, config and schema. A workspace path is a REFUSED input rather than an unsupported one: P3-11 owns workspace checkpointing, and the manifest's backup strategy is exactly where the two would blur.

## must[2] decides that approval is owed, and nothing asks yet

`requiresApprovalAndExport` answers whether an irreversible upgrade owes a human decision and an export. It does not ask for one, and that is a measured limit rather than a staging convenience: [`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.md)'s request carries a `toolName` and it **throws outside an open turn**, while a plugin upgrade is a CLI command with neither. The refusal is not an oversight to route around — it protects the `approval/asked` + `approval/decided` audit pair that a reload would otherwise find as crash-tail garbage.

Reversibility is read from the migration's own declaration rather than derived from its backup strategy, because the two answer different questions. A snapshot makes the DATA restorable; reversibility is about whether the migration's effects are confined to that data. A migration that also rewrote an external system is irreversible however good its snapshot is, and must[2] exists for that case.

## Model Experience

No model-visible surface. This package registers no tool, contributes no prompt text and emits no session event. Token and KV-cache effects: none.

## Known Limitations and Deferred Work

- **Nothing consults these decisions yet.** This is the Contract stage: the vocabulary and the judgements exist, and the transaction that would run them is the Provider stage's. A reader must not take these tests as evidence that any upgrade is transactional.
- **must[2]'s approval has no asker.** Recorded above: the existing approval seam cannot serve a turn-less CLI upgrade. Which seam asks is an open ruling — a turn-less audit path, an upgrade that runs inside a session, or directing the approval half elsewhere — and it decides whether must[2] closes in this epic.
- **`refuseOutsidePluginStorage` compares already-resolved paths.** It resolves nothing itself, because resolution reads a filesystem. A caller passing an unresolved `../` path would be comparing strings that do not mean what they look like; resolving before the call is the caller's obligation and the Provider stage's to honour.

## Dev Note

A cycle is refused structurally and named as one rather than being discovered by a depth limit. The reason is the same one P4-09 recorded for self-recursive workflow definitions: an operator reading "these versions form a cycle" knows which declarations to fix, while one reading "too many steps" cannot tell a loop from a long history.
