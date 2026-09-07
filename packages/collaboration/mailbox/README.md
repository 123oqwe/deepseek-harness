---
description: "At-most-once directed messaging for Epic P5-11: address resolution before deduplication, and (from, id, epoch) identity so a redelivered message is recognised rather than re-applied."
kind: "package-reference"
---

# @deepseek-ai/dsh-mailbox

English | [中文](README.zh.md)

## Summary

A mailbox delivers a message to one addressee at most once. `decideDelivery` decides whether a given message may be delivered now, from the addressee and the delivery history the caller supplies.

## Table of Contents

- [Address before dedup](#address-before-dedup)
- [Identity is (from, id, epoch)](#identity-is-from-id-epoch)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Address before dedup

The addressee is resolved BEFORE the duplicate check. Checking dedup first would let a message addressed to nobody be recorded as delivered, and the mistake is then invisible: the sender sees a successful delivery and the intended reader never had an address to receive it at.

## Identity is (from, id, epoch)

A redelivery carries the same sender, id and epoch. Recognising the triple is what separates "this message again" from "a new message that happens to look alike": an id alone cannot tell them apart once a sender restarts and reuses its counter, and `from` is what keeps one participant's ids out of another's — a message id is unique only within its sender, which BLOCKED-140 measured the hard way.

## Model Experience

None, as this package exports a delivery decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No transport.** Delivery is decided here and performed by the caller; the package neither moves bytes nor persists a queue.
- **At-most-once, not exactly-once.** A caller that crashes between the decision and its own effect loses the message; recovering that needs the outbox pattern in `dsh-message-bus`, not this.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Epoch comparison assumes a sender's epochs advance monotonically across restarts. A sender that resets its epoch would make a genuinely new message look like a redelivery of an old one; nothing here detects that, and the fix belongs wherever epochs are minted rather than where they are compared.

</details>
