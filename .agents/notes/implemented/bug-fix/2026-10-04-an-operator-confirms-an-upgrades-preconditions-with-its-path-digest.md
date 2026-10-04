# Agent Note: An operator confirms an upgrade's preconditions with its path digest

Status: implemented

English | [中文](2026-10-04-an-operator-confirms-an-upgrades-preconditions-with-its-path-digest.zh.md)

## Problem

A plugin migration step could carry preconditions only in the internal plan type. Plugin Manifest v2 had no field for them, so a shipped plugin could not declare one. Any plan that did carry one was refused as `preconditions-undecided`, and no operator action could admit it (B-711b 1-5; P1-10 must[0]).

## Decision

- A Manifest v2 migration step may declare `preconditions`, each with a non-empty `id` and `requirement`. The validator and `spec/capability-manifest.schema.json` accept them, and the CLI carries them into the plan.
- A step's preconditions are part of the path digest, encoded after its versions. A step that declares none encodes only its versions, so the digest of a path without preconditions does not change.
- `planConfirmedUpgrade` admits a path with preconditions once the operator confirms its digest. Without a matching confirmation it refuses `preconditions-undecided`, listing each precondition and naming the digest that admits the path.
- The upgrade transaction and the CLI plan with it. The CLI passes `--confirm` whenever it is given, so one confirmation covers both a path's preconditions and an irreversible path's approval. `planUpgrade` itself is unchanged.

## Alternatives considered

- **Have the harness check preconditions.** It cannot tell whether a disk is writable or an external system is reachable, and a check it guessed at would admit an upgrade on an assumption.
- **Add a second flag for preconditions.** Two confirmations of one path could disagree, and the digest already names exactly what the operator saw.

## Consequences

- Editing a precondition's requirement changes the digest, so an earlier confirmation stops matching.
- The CLI refusal lists each precondition as `id (requirement)` and gives the `--confirm` digest.
- Not covered: whether a confirmed precondition actually holds is the operator's statement; nothing verifies it.
