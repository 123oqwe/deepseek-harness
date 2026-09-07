---
description: "The single (message id, epoch) deduplication rule for Epic P4-06: key derivation and the seen-set decision, applied by both the message bus and the mailbox while each keeps its own precedence check."
kind: "package-reference"
---

# @deepseek-ai/dsh-intake-dedup

English | [中文](README.zh.md)

## Summary

`classifyDedup` decides whether an arriving message is a first arrival or a repeat, from the message's `(id, epoch)` identity and the set of keys the consumer has already applied. `dedupKey` derives that key. Nothing else is here.

## Table of Contents

- [Why a package](#why-a-package)
- [Identity is the pair](#identity-is-the-pair)
- [The precedence check stays with the caller](#the-precedence-check-stays-with-the-caller)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Why a package

`dsh-message-bus` and `dsh-mailbox` had each written this rule, with the same key derivation, the same caller-supplied seen-set and the same ordering — the second citing the first in a comment rather than importing it (BLOCKED-136). One rule with two implementations can drift, and the copy P4-06's clause is about was the one nothing called.

It is a package of its own rather than an export of either caller because of the layer direction. `collaboration` is capability-definitions and `run` is orchestration-runtime, so a mailbox importing the bus would be a definition depending on a runtime. Here both edges point down or sideways.

## Identity is the pair

A redelivery carries the same id; a sender that restarts and reuses a counter also carries the same id, for a message whose effect has not happened. The epoch separates them.

The key is length-prefixed — `${id.length}:${id}:${epoch}` — so an id containing the separator cannot collide with a different pair. Without the prefix, `('a:1', 2)` and `('a', '1:2')` produce one key, and consuming either silently suppresses the other. BLOCKED-138 records a durable store that dropped the prefix and hit exactly that.

## The precedence check stays with the caller

This module knows nothing about who may receive a message. The bus refuses a foreign tenant and the mailbox refuses a message addressed elsewhere; each runs its own check BEFORE this one. Consulting a seen-set with a key derived from a message the consumer may not act on would let that message suppress a later legitimate one sharing its key, and would reveal whether the key had been seen.

What counts as "may act on it" differs between the two. The dedup rule does not, which is why only the rule lives here.

## Model Experience

- **Model-visible surface:** none. No prompt text, tool schema, or tool result originates here.
- **Token cost:** none.
- **KV-cache effect:** none.

## Known Limitations and Deferred Work

- **The seen-set is supplied by the caller.** This module holds no state and has no opinion on where the set comes from; `dsh-message-bus`'s `bus.sqlite` provides a durable one, and a caller that assembles its own gets whatever durability it built.
- No runtime invariant companion is published: this package holds no state and observes nothing, so there is no owned relation two observers could disagree about. Its decisions are pure functions of their arguments, covered by unit cases in the two packages that apply them.
