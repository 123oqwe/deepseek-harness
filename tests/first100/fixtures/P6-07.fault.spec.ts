/**
 * P6-07 acceptance[3] on the shipped read path: a corrupted log reads back as
 * its minimal recoverable prefix together with the evidence of where and why
 * the prefix ends.
 *
 * `SessionLogScanner.finish()` returns that evidence as `corruption`, and the
 * scanner's own cases prove it (`session-persistence-jsonl/tests/jsonl.spec.ts`,
 * "scanLog unit"). These cases read through the seam a session load uses,
 * `sessionPersistence.open(id, 'read')` and `handle.read()`, on both storage
 * encodings: zstd, the shipped default, where a corrupt row can only end the
 * prefix inside a torn final frame, and uncompressed. The control reads an
 * undamaged log, so a reader that always reports corruption does not pass.
 * @module tests/first100/fixtures/P6-07.fault
 */

import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { type SessionEvent, type SessionHeader, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHandleReadResult, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { meta, oneTurnLog } from '../../../packages/session/session-persistence/tests/contract.ts'
import { logPath } from '../../../packages/session/session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'

/** The next turn's first row after `oneTurnLog()` (seqs 0..5): recoverable, so the prefix ends after it. */
const NEXT_TURN_START = JSON.stringify({ type: 'turn/start', seq: SessionSeq(6), time: 8, data: { turn: 2 } })
/** A committed row that does not parse. */
const CORRUPT_ROW = '{not json'

/**
 * Create a session and append `events` through the persistence seam.
 * @param persistence - the persistence under test.
 * @param header - the session header.
 * @param events - the events to append.
 */
async function writeLog(persistence: SessionPersistence, header: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
  const handle = await persistence.create(header)
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
}

/**
 * Read a session back through the seam a session load uses.
 * @param persistence - the persistence under test.
 * @param header - the session header.
 * @returns the handle's read result.
 */
async function readBack(persistence: SessionPersistence, header: SessionHeader): Promise<SessionHandleReadResult> {
  const handle = await persistence.open(header.id, 'read')
  try {
    return await handle.read()
  } finally {
    await handle.close()
  }
}

describe('P6-07 acceptance[3] (V6): the shipped JSONL read returns the recoverable prefix with its corruption evidence', () => {
  let root: string
  let ctx: Context

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'p6-07-fault-'))
    ctx = new Context()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it('zstd, the shipped default: a corrupt row in a torn final frame ends the prefix, and the read carries the evidence naming it', async () => {
    await ctx.plugin(JsonlSessionPersistence, { root })
    const header = meta('p6-07-v6-zstd', '/proj')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    // One more frame whose checksum never reached disk: the reader recovers
    // its plaintext as a torn tail, and that plaintext ends in a corrupt row.
    const frame = await compressZstdFrame(`${NEXT_TURN_START}\n${CORRUPT_ROW}\n`)
    await appendFile(logPath(root, '/proj', header.id, 'zstd'), frame.subarray(0, frame.length - 2))

    const read = await readBack(ctx.sessionPersistence, header)
    expect(read.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(read).toMatchObject({ corruption: { raw: CORRUPT_ROW, parseError: expect.stringMatching(/unparsable JSON/) as unknown } })
  })

  it('uncompressed: a corrupt final row ends the prefix, and the read carries the evidence naming it', async () => {
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const header = meta('p6-07-v6-none', '/proj')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())
    await appendFile(logPath(root, '/proj', header.id, 'none'), `${NEXT_TURN_START}\n${CORRUPT_ROW}\n`)

    const read = await readBack(ctx.sessionPersistence, header)
    expect(read.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(read).toMatchObject({ corruption: { raw: CORRUPT_ROW, parseError: expect.stringMatching(/unparsable JSON/) as unknown } })
  })

  it('control: an undamaged log reads back whole and carries no corruption evidence', async () => {
    await ctx.plugin(JsonlSessionPersistence, { root })
    const header = meta('p6-07-v6-control', '/proj')
    await writeLog(ctx.sessionPersistence, header, oneTurnLog())

    const read = await readBack(ctx.sessionPersistence, header)
    expect(read.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(read).not.toHaveProperty('corruption')
  })
})
