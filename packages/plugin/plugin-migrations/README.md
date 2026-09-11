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
- [must[2]: an operator confirms at the CLI, and the export comes first](#must2-an-operator-confirms-at-the-cli-and-the-export-comes-first)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## What this package deliberately does NOT do

**It does not perform an upgrade.** Epic P1-10's must[1] names six phases — freeze, snapshot, migrate in quarantine, validate, atomic switch, health check — and that is an ordering over real effects. A module that could perform one of them would be a second place the upgrade happens; the transaction is the Provider stage's.

**It does not decide preconditions.** A migration's preconditions are reported back to the caller, because this package cannot know whether a disk is writable or an external system is reachable. A precondition silently treated as satisfied would be an upgrade admitted on an assumption nobody made.

**It does not touch workspace files.** `PluginDataSnapshot` covers a plugin's own durable data, config and schema. A workspace path is a REFUSED input rather than an unsupported one: P3-11 owns workspace checkpointing, and the manifest's backup strategy is exactly where the two would blur.

## must[2]: an operator confirms at the CLI, and the export comes first

An irreversible upgrade proceeds only on an operator's explicit confirmation — a TTY prompt, or `--confirm-irreversible <path digest>` when there is no TTY. A non-interactive run with no flag is refused with nothing changed: an upgrade that proceeded on silence would make the approval a formality in the one case it exists for.

The confirmation names a DIGEST of the ordered steps, so it admits one specific conversion rather than "whatever this command decides to run". A manifest edited between the operator reading it and the upgrade running produces a different digest, and the confirmation stops matching instead of silently covering the new path.

The export is required BEFORE the confirmation is accepted. An operator confirming an irreversible conversion is confirming they can still get their data out, and accepting the confirmation first would let the export fail after the point of no return.

This deliberately does NOT use `@deepseek-ai/dsh-user-approval`. That seam's request carries a `toolName` and it throws outside an open turn, because its `approval/asked` + `approval/decided` pair must be turn-enclosed or a reload finds crash-tail garbage. A CLI upgrade is not in a turn, so borrowing it would be a misuse rather than a shortcut. A migration triggered from INSIDE a session — the self-modification flow — does belong to that seam, and is P1-11's.

Recording the confirmation in the transaction log, with the operator identity, the time and the export path, is the Provider stage's.

## Dev Note

A cycle is refused structurally and named as one rather than being discovered by a depth limit. The reason is the same one P4-09 recorded for self-recursive workflow definitions: an operator reading "these versions form a cycle" knows which declarations to fix, while one reading "too many steps" cannot tell a loop from a long history.

## Model Experience

None, as this package decides and orders a plugin upgrade that runs in `dsh plugin`, before any agent starts, and registers no tool, prompt text or session event.

#### KV Cache effect

Nothing here enters a model request; an upgrade happens between sessions, not inside one.

**Runtime invariant:** No runtime invariant companion is published: this package holds the migration vocabulary and pure judgements over a manifest's DAG the caller owns, so it constructs nothing whose state a checker could compare against a second reading.

## Known Limitations and Deferred Work

- **Nothing consults these decisions yet.** This is the Contract stage: the vocabulary and the judgements exist, and the transaction that would run them is the Provider stage's. A reader must not take these tests as evidence that any upgrade is transactional.
- **must[2]'s confirmation is decided here and prompted at the Provider stage.** This package decides whether a confirmation admits a path; the TTY prompt, the `--confirm-irreversible` flag, the export and the append-only transaction record are the Provider stage's. A migration triggered from inside a session belongs to `@deepseek-ai/dsh-user-approval` instead, and is P1-11's.
- **`refuseOutsidePluginStorage` compares already-resolved paths.** It resolves nothing itself, because resolution reads a filesystem. A caller passing an unresolved `../` path would be comparing strings that do not mean what they look like; resolving before the call is the caller's obligation and the Provider stage's to honour.
