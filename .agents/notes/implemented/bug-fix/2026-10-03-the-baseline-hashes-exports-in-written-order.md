# Agent Note: The baseline hashes exports in written order

Status: implemented

English | [中文](2026-10-03-the-baseline-hashes-exports-in-written-order.zh.md)

## Problem

`baseline-fingerprint.mjs` hashed every package manifest field after sorting object keys deep, so equal content hashed alike whatever its key order. For `exports` and `imports` the order is part of the meaning: Node resolves their conditions top to bottom, so `types` before `default` and `default` before `types` resolve differently. Swapping two conditions was therefore no drift, and `verify` passed a change that alters what a package resolves to (P0-01 blind review 1-2; A-594 observes it on a fixture checkout).

## Decision

- `exports` and `imports` are hashed from their JSON in the key order written; every other field keeps the sorted canonical form, so a reformat of an order-free field is still no drift.
- A drift in either field is reported as that manifest's `exports` or `imports`, as for any other field.
- The baseline format becomes 4. A format-3 baseline holds `exports` and `imports` hashes of the sorted form, so comparing it field by field would report spurious drift on every package whose conditions are not in alphabetical order; `verify` reports the format instead, and the committed baseline is recaptured.

## Alternatives considered

- **Sort keys everywhere except inside condition objects.** Which nested objects are condition maps is defined by Node's resolution rules, not by the JSON shape; hashing the two fields as written needs no such rule.

## Consequences

- Reordering conditions in a package's `exports` or `imports` is now a baseline drift that names the field.
- The committed `.dsh/baseline.json` is format 3 until it is recaptured from a full run of a tree that carries this change.
