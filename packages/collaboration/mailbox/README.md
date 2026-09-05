---
description: "At-most-once directed messaging for Epic P5-11: address resolution before deduplication, and (id, epoch) identity so a redelivered message is recognised rather than re-applied."
kind: "package-reference"
---

# @deepseek-ai/dsh-mailbox

English | [中文](README.zh.md)

## Summary

A mailbox delivers a message to one addressee at most once. `decideDelivery` decides whether a given message may be delivered now, from the addressee and the delivery history the caller supplies.

## Address before dedup

The addressee is resolved BEFORE the duplicate check. Checking dedup first would let a message addressed to nobody be recorded as delivered, and the mistake is then invisible: the sender sees a successful delivery and the intended reader never had an address to receive it at.

## Identity is (id, epoch)

A redelivery carries the same id and a later epoch. Recognising the pair is what separates "this message again" from "a new message that happens to look alike" — an id alone cannot tell them apart once a sender restarts.

## Model Experience

None, as this package exports a delivery decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **No transport.** Delivery is decided here and performed by the caller; the package neither moves bytes nor persists a queue.
- **At-most-once, not exactly-once.** A caller that crashes between the decision and its own effect loses the message; recovering that needs the outbox pattern in `dsh-message-bus`, not this.
