/**
 * P4-06 must[0], Provider stage: what this package contributes to committing a
 * domain event together with its outbox records.
 *
 * The batching behaviour itself belongs to `SessionWriteBehind` and is proved
 * there, against the real controller — including that two separate `enqueue`
 * calls genuinely CAN be split across batches, which is the hazard
 * `commitWithOutbox` exists to remove. `SessionWriteBehind` is internal to its
 * package, so what is checked here is the part this package owns: that the
 * commit reaches the sink as exactly one group, in order, and refuses the
 * empty case.
 */

import { describe, expect, it } from 'vitest'
import { commitWithOutbox, type AtomicBatchSink } from '../src/index.ts'

/** Records each group handed to the sink, so splits are observable. */
function recordingSink(): AtomicBatchSink<string> & { groups: string[][] } {
  const groups: string[][] = []
  return { groups, enqueueAll: (entries) => void groups.push([...entries]) }
}

describe('P4-06 must[0]: a commit reaches the durable sink as one group', () => {
  it('hands the event and its record to the sink in a single call', () => {
    const sink = recordingSink()
    commitWithOutbox(sink, 'domain/committed', ['outbox/enqueued'])

    // One call is the entire guarantee: two calls could straddle a write.
    expect(sink.groups).toEqual([['domain/committed', 'outbox/enqueued']])
  })

  it('keeps a multi-record commit together and preserves its order', () => {
    const sink = recordingSink()
    commitWithOutbox(sink, 'domain/committed', ['outbox/a', 'outbox/b'])

    expect(sink.groups).toEqual([['domain/committed', 'outbox/a', 'outbox/b']])
  })

  it('refuses a commit with no records rather than appending a lone event', () => {
    const sink = recordingSink()

    expect(() => commitWithOutbox(sink, 'domain/committed', [])).toThrow(RangeError)
    // The refusal must leave nothing behind: a sink that had already received
    // the event would have committed it without the outbox the caller
    // believed it was writing.
    expect(sink.groups).toEqual([])
  })

  it('does not retain the caller\'s array, so a later mutation cannot reach the sink', () => {
    const sink = recordingSink()
    const records = ['outbox/enqueued']
    commitWithOutbox(sink, 'domain/committed', records)
    records.push('outbox/added-after')

    expect(sink.groups).toEqual([['domain/committed', 'outbox/enqueued']])
  })
})
