/**
 * What the shipped session list path costs at N sessions, measured on a CI
 * runner so P6-07 acceptance[0]'s million-session fixture can be sized
 * (approved/P6-07.md V2, delegate ruling on ① option (b)). A measurement, not
 * an acceptance case: the only assertion is that every written session was
 * listed.
 *
 * The fixture is N header-only sessions in the JSONL persistence's own layout
 * and default encoding (one directory per session, one zstd header frame per
 * file), written the way the persistence writes a header
 * (`JSON.stringify(toHeaderLine(header))` in one checksummed frame). The cases
 * then time one `JsonlSessionPersistence.list()` and one
 * `sessionQuery.listSessions()`, which the controller's list calls once per
 * request. Each case records its readings in `task.meta.p607`, which the JSON
 * reporter carries next to the case's `duration`.
 * @module tests/first100/measure/P6-07.million
 */

import { execFileSync } from 'node:child_process'
import { statfsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { meta } from '../../../packages/session/session-persistence/tests/contract.ts'
import { logPath, toHeaderLine } from '../../../packages/session/session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'

/** Sessions written: one tenth of acceptance[0]'s million, to extrapolate from. */
const N = 100_000
/** The working directory every session header records. */
const CWD = '/p6-07-measure'

/** Free bytes and free inodes on the filesystem holding `path`. */
function freeSpace(path: string): { readonly bytes: number; readonly inodes: number } {
  const stats = statfsSync(path)
  return { bytes: stats.bavail * stats.bsize, inodes: stats.ffree }
}

/**
 * Attach readings to a case, where the JSON reporter's `meta` carries them.
 * @param task - the running case.
 * @param task.meta - the case's metadata object.
 * @param readings - the numbers to record.
 */
function record(task: { meta: object }, readings: Readonly<Record<string, number>>): void {
  Object.assign(task.meta, { p607: readings })
}

/** Megabytes, rounded. */
function mb(bytes: number): number {
  return Math.round(bytes / 1_048_576)
}

describe(`P6-07 acceptance[0] sizing: the shipped list path over ${N} sessions (measurement)`, () => {
  let root: string
  let ctx: Context

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'p6-07-measure-'))
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(SessionQueryEngine, {})
  })

  afterAll(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })

  it(`writes ${N} header-only sessions in the persistence's zstd layout`, async ({ task }) => {
    const before = freeSpace(root)
    const started = performance.now()
    for (let index = 0; index < N; index += 1) {
      const header = meta(`p6-07-measure-${String(index).padStart(7, '0')}`, CWD)
      const path = logPath(root, CWD, header.id, 'zstd')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`))
    }
    const writeMs = performance.now() - started
    const after = freeSpace(root)
    const duKB = Number(execFileSync('du', ['-sk', root], { encoding: 'utf8' }).split('\t')[0])
    record(task, {
      sessions: N,
      writeMs: Math.round(writeMs),
      writeUsPerSession: Math.round(writeMs * 1_000 / N),
      duMB: Math.round(duKB / 1_024),
      freeBytesUsedMB: mb(before.bytes - after.bytes),
      inodesUsed: before.inodes - after.inodes,
      freeMBAfter: mb(after.bytes),
      freeInodesAfter: after.inodes,
    })
  })

  it('lists every session once through JsonlSessionPersistence.list()', async ({ task }) => {
    const persistence: SessionPersistence = ctx.sessionPersistence
    const started = performance.now()
    const listed = await persistence.list()
    const listMs = performance.now() - started
    const memory = process.memoryUsage()
    record(task, {
      listMs: Math.round(listMs),
      listUsPerSession: Math.round(listMs * 1_000 / N),
      heapUsedMB: mb(memory.heapUsed),
      rssMB: mb(memory.rss),
    })
    expect(listed).toHaveLength(N)
  })

  it('lists every session once through sessionQuery.listSessions(), as each controller list request does', async ({ task }) => {
    const started = performance.now()
    const records = await ctx.sessionQuery.listSessions()
    const listMs = performance.now() - started
    const memory = process.memoryUsage()
    record(task, {
      listMs: Math.round(listMs),
      listUsPerSession: Math.round(listMs * 1_000 / N),
      heapUsedMB: mb(memory.heapUsed),
      rssMB: mb(memory.rss),
    })
    expect(records).toHaveLength(N)
  })
})
