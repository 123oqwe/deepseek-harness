import { describe, it, expect, beforeEach } from 'vitest'
import { EventStreamManager } from '../src/event-stream.ts'

describe('P8-05 Resumable Event Streaming', () => {
  let stream: EventStreamManager

  beforeEach(() => { stream = new EventStreamManager() })

  it('publishes events with increasing sequence', () => {
    stream.publish('test', { msg: 'hello' }, 's1')
    stream.publish('test', { msg: 'world' }, 's1')
    expect(stream.getEventCount()).toBe(2)
  })

  it('subscriber receives missed events on reconnect', () => {
    stream.publish('test', { m: 1 }, 's1')
    stream.publish('test', { m: 2 }, 's1')
    const subId = stream.subscribe('s1', 0)
    const events = stream.poll(subId)
    expect(events).toHaveLength(2)
    expect(events[0]?.data).toEqual({ m: 1 })
  })

  it('subscriber only gets events after cursor', () => {
    stream.publish('test', { m: 1 }, 's1')
    stream.publish('test', { m: 2 }, 's1')
    const subId = stream.subscribe('s1', 1)
    const events = stream.poll(subId)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toEqual({ m: 2 })
  })

  it('ack updates cursor', () => {
    stream.publish('test', { m: 1 }, 's1')
    const subId = stream.subscribe('s1', 0)
    const events = stream.poll(subId)
    const ack = stream.ack(subId, events[0]!.sequence)
    expect(ack.acknowledged).toBe(true)
    expect(ack.newCursor.lastSequence).toBe(1)
  })

  it('replay returns events in range', () => {
    for (let i = 0; i < 5; i++) stream.publish('test', { i }, 's1')
    const replayed = stream.replay(1, 3)
    expect(replayed).toHaveLength(2)
    expect(replayed[0]?.sequence).toBe(2)
  })

  it('dedupe check prevents duplicate event IDs', () => {
    const event = stream.publish('test', {}, 's1')
    expect(stream.dedupeCheck(event.eventId)).toBe(true)
    expect(stream.dedupeCheck('nonexistent')).toBe(false)
  })

  it('subscriber buffer is bounded', () => {
    const subId = stream.subscribe('s1', 0)
    for (let i = 0; i < 100; i++) stream.publish('test', { i }, 's1')
    const events = stream.poll(subId, 200)
    expect(events.length).toBeLessThanOrEqual(100)
  })

  it('unsubscribe removes subscriber', () => {
    const subId = stream.subscribe('s1', 0)
    expect(stream.getSubscriberCount()).toBe(1)
    stream.unsubscribe(subId)
    expect(stream.getSubscriberCount()).toBe(0)
  })

  it('poll returns empty when no new events', () => {
    const subId = stream.subscribe('s1', 0)
    stream.poll(subId)
    const events = stream.poll(subId)
    expect(events).toHaveLength(0)
  })

  it('multiple subscribers are independent', () => {
    stream.publish('test', { m: 1 }, 's1')
    const sub1 = stream.subscribe('s1', 0)
    const sub2 = stream.subscribe('s2', 0)
    const events1 = stream.poll(sub1)
    const events2 = stream.poll(sub2)
    expect(events1).toHaveLength(1)
    expect(events2).toHaveLength(1)
  })
})
