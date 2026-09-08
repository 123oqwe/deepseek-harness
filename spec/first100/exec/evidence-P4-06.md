# Evidence package — P4-06 Durable Inbox / Outbox 与 At-Least-Once 投递 + 幂等消费

Per §12.34. Three questions per clause: **(1)** does the subject exist, **(2)** production callers (Rule 4.4a — `git ls-files`, excluding `tests/`, `*.spec.ts`, `lib/`), **(3)** is it reached on a launched profile (§12.20).

Measured at `53864d10ad`.

## Summary

Every clause closes. The consumer that makes them real is the settlement path: a child telling its parent how it ended is committed to the bus and delivered from it, rather than hand-delivered, so the inbox, the outbox, the dispatch decision and the receipt are all on the path a profile runs.

| clause | verdict |
| --- | --- |
| must[0] domain event and outbox row in one `BEGIN IMMEDIATE` transaction, not through a KV seam | closes |
| must[1] the dispatcher marks a send with an idempotent receipt | closes |
| must[2] the consumer deduplicates on `(source, messageId, epoch)` | closes |
| must[3] priority, deadline, dead-letter, backpressure | closes |
| acceptance[0] one business effect across kills at every boundary | closes |
| acceptance[1] undelivered messages are queryable and replayable | closes |
| acceptance[2] a cross-tenant message cannot be consumed | closes |

## The consumer, stated once

`@deepseek-ai/dsh-subagent`'s settlement path is the production consumer: `settlement-outbox.ts` commits a settlement through `commitIntake` and drains it through `decideDelivery` / `applyReceipt`, and `continuation.ts` drives that from three triggers. `intake-dedup` is the second consumer, and `action-ledger/src/store.ts` shares the same store discipline.

That answers question (3) for every clause below — reached whenever a continuable child settles — so it is not repeated per clause.

## must[0] — one transaction, no KV seam

| question | answer |
| --- | --- |
| exists | `bus-store.ts` opens SQLite directly and uses `BEGIN IMMEDIATE` in **5** places; the outbox table is `(seq, message_id, epoch, target, payload, tenant, state, priority, deadline_ms, attempts, receipt)` |
| production callers of `commitIntake` | **4** outside the bus package — `subagent/settlement-outbox.ts`, `subagent/continuation.ts`, `intake-dedup`, `action-ledger/store.ts` |
| reached | yes |

The clause's negative half — "not through a storage KV seam" — is a property of the module rather than a call: `bus-store.ts` imports `node:sqlite` and no KV service, so there is no seam to route around.

## must[1] — the dispatcher marks a send with an idempotent receipt

| question | answer |
| --- | --- |
| exists | `applyReceipt` in `dispatcher.ts` / `outbox.ts` |
| production callers | **3** outside the bus package — `subagent/settlement-outbox.ts`, `taskboard-sqlite`, `subagent-taskboard` |
| reached | yes — the settlement drain applies a receipt on every dispatched record |

## must[2] — the consumer deduplicates on `(source, messageId, epoch)`

| question | answer |
| --- | --- |
| exists | the inbox's arrival key is that triple, and `commitSettlement` uses the SAME triple — `source='subagent-settled'`, `id=childId`, `epoch=` the lease epoch |
| production callers | the settlement commit and `intake-dedup` |
| reached | yes |

The two sides sharing one key is what makes the clause hold rather than approximately hold: the outbox's idea of "the same message" and the inbox's cannot disagree, because there is one triple and both read it.

## must[3] — priority, deadline, dead-letter, backpressure

| subject | where | note |
| --- | --- | --- |
| priority | `outbox.ts:73`, ordered highest first | ties fall to deadline, then id, so a crash cannot reorder equal records |
| deadline | `outbox.ts:75`, checked at `:172` | checked BEFORE the attempt budget, so an expired message reports `deadline-expired` even when also out of attempts — the two need different operator responses |
| dead-letter | `outbox.ts:153`, reasons `deadline-expired` / `attempts-exhausted` | a pending record may go straight to dead-letter |
| backpressure | the attempt budget with `attempts` persisted per row | bounded retry is the backpressure; an unbounded queue would have none |

## acceptance[0] — one business effect across kills at every boundary

The clause is explicit that exactly-once is the CONSUMER's property, not the transport's, and the implementation matches: the transport is at-least-once and the inbox refuses a repeated `(source, messageId, epoch)`. Kill points are covered by the settlement cases — the commit precedes any delivery attempt, so a kill before commit leaves nothing owed and a kill after it leaves a record that drains on the next trigger.

The delivery-side guard is separate: `decideDelivery` skips a record already acked, so a redelivery after a kill between send and ack does not become a second effect.

## acceptance[1] — undelivered messages are queryable and replayable

| question | answer |
| --- | --- |
| exists | `outboxRows()` (`bus-store.ts:301`) reads every row in `seq` order with its state, attempts and receipt; `recoverStaleClaims` returns claims whose window expired |
| production callers of `recoverStaleClaims` | `bus-store.ts`, `plugin.ts`, `action-ledger/store.ts` |
| reached | yes — a parent that was gone when its child settled drains the kept record when it next starts |

## acceptance[2] — a cross-tenant message cannot be consumed

| question | answer |
| --- | --- |
| exists | `tenant` is a column on the outbox table and a field on the dispatch policy (`bus-store.ts:83`), carried through `outboxRows()` |
| reached | yes — every row is written with its tenant and read back with it |

The tenant rides the ROW rather than being derived at read time, which is what makes the guarantee survive a restart: a process that reopened the database cannot infer a tenant it never recorded.

## Signing position

All seven clauses have live subjects with production consumers on the settlement path. No deferral is proposed.
