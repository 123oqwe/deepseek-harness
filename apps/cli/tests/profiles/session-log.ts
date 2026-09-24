/**
 * Read back what a launched profile wrote under its harness home: the durable
 * session log, and the host user id the launch resolved.
 *
 * Shared by the profile e2e files that inspect one, because the reading is not
 * obvious and getting it wrong is silent: the JSONL backend appends a Zstandard
 * frame per batch, so a one-shot decompress of the file returns the FIRST
 * frame — the header alone — and every assertion about events then runs
 * against an empty list.
 *
 * @module apps/cli/tests/profiles/session-log
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { HOST_USER_ID_FILE_NAME } from '@deepseek-ai/dsh-host-user-id'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'

/** One record of a durable session log, as the log's own JSONL lines carry it. */
export interface SessionLogRecord {
  /** Event type, or `session` for the header record that opens the log. */
  type: string
  /** Event payload; absent on records that carry none. */
  data?: Record<string, unknown>
}

/** A session log's bytes and the records they decode to. */
export interface SessionLog {
  /** The file as stored, for a caller asserting something about the container. */
  compressed: Buffer
  /** Every record, in file order, across every frame. */
  records: SessionLogRecord[]
}

/** A log as any reader here returns it: its records, and the stored bytes when the reader kept them. */
export type ReadLog = Pick<SessionLog, 'records'> & Partial<Pick<SessionLog, 'compressed'>>

/**
 * Read the one session log under a profile's session storage.
 * @param sessionsRoot - the directory a profile persists sessions into.
 * @returns the log's bytes and its records in file order.
 * @throws when the directory holds no `.jsonl.zstd` file, or one ends mid-frame.
 */
export async function readSessionLog(sessionsRoot: string): Promise<SessionLog> {
  const files = await readdir(sessionsRoot, { recursive: true })
  const log = files.find(file => file.endsWith('.jsonl.zstd'))
  if (log === undefined) throw new Error(`no persisted session log under ${sessionsRoot}`)
  const compressed = await readFile(join(sessionsRoot, log))
  const { frames, tornStart } = scanZstdFrames(compressed)
  if (tornStart !== undefined) throw new Error(`session log ends mid-frame at byte ${tornStart}: ${log}`)
  const records = frames
    .flatMap(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as SessionLogRecord)
  return { compressed, records }
}

/**
 * Read every session log under a profile's session storage, for a run that
 * persists more than one session (a launcher and the sessions it delegated to).
 * @param sessionsRoot - the directory a profile persists sessions into.
 * @returns each log's bytes and records, one entry per `.jsonl.zstd` file, in directory order.
 * @throws when a log ends mid-frame.
 */
export async function readSessionLogs(sessionsRoot: string): Promise<SessionLog[]> {
  const files = (await readdir(sessionsRoot, { recursive: true })).filter(file => file.endsWith('.jsonl.zstd'))
  return Promise.all(files.map(async (file) => {
    const compressed = await readFile(join(sessionsRoot, file))
    const { frames, tornStart } = scanZstdFrames(compressed)
    if (tornStart !== undefined) throw new Error(`session log ends mid-frame at byte ${tornStart}: ${file}`)
    const records = frames
      .flatMap(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
      .map(line => JSON.parse(line) as SessionLogRecord)
    return { compressed, records }
  }))
}

/**
 * Read the one session log under a profile whose `sessions` row writes
 * uncompressed JSONL (`compression: none`, which `sdk-minimal` configures).
 * @param sessionsRoot - the directory a profile persists sessions into.
 * @returns the log's records in file order.
 * @throws when the directory holds no `.jsonl` file, or more than one.
 */
export async function readPlainSessionLog(sessionsRoot: string): Promise<Pick<SessionLog, 'records'>> {
  const files = (await readdir(sessionsRoot, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  const [file] = files
  if (file === undefined || files.length > 1) {
    throw new Error(`expected one plain session log under ${sessionsRoot}, found ${files.length}: ${files.join(', ')}`)
  }
  const text = await readFile(join(sessionsRoot, file), 'utf8')
  return { records: text.trim().split('\n').map(line => JSON.parse(line) as SessionLogRecord) }
}

/**
 * The tenant `hostUserIdentity` mints in when neither its options nor
 * `$DSH_TENANT` name one: `LOCAL_TENANT` in
 * `packages/identity/host-user-id/src/index.ts`, which that module does not
 * export.
 */
export const DEFAULT_HOST_TENANT = 'local'

/** One principal as a logged `identity/attached` record carries it. */
export interface LoggedPrincipal {
  /** `user`, `service`, `agent` or `anonymous-dev`. */
  kind?: unknown
  /** The principal's id. */
  id?: unknown
  /** The tenant it acts in. */
  tenantId?: unknown
  /** For an `agent` principal, the id of the principal that delegated to it. */
  delegatedBy?: unknown
}

/** One hop of a logged delegation chain. */
export interface LoggedChainEntry {
  /** The principal this hop delegates to; the root for the first entry. */
  principal?: LoggedPrincipal
}

/** The identity a logged `identity/attached` record carries. */
export interface LoggedIdentity {
  /** The principal acting: the chain's last entry. */
  principal?: LoggedPrincipal
  /** The run this identity acts inside. */
  runId?: unknown
  /** The delegation chain, root first. */
  chain?: { entries?: LoggedChainEntry[] }
}

/**
 * The identity on this session's first `identity/attached` record, as logged.
 * @param log - a log read by {@link readSessionLog}, {@link readSessionLogs} or {@link readPlainSessionLog}.
 * @returns the record's `identity` member.
 * @throws when the log carries no attachment, or one without an `identity` object.
 */
export function attachedIdentity(log: ReadLog): LoggedIdentity {
  const attached = log.records.find(record => record.type === 'identity/attached')
  if (attached === undefined) throw new Error('this session log carries no identity/attached record')
  const identity = attached.data?.['identity']
  if (typeof identity !== 'object' || identity === null) throw new Error('the identity/attached record carries no identity')
  return identity
}

/**
 * The principal id this session's identity was attached under.
 *
 * Read from the log rather than recomputed, so a case comparing it with a
 * manifest's `actor` is joining two facts the run produced rather than two
 * copies of one expectation.
 * @param log - a log read by {@link readSessionLog}, {@link readSessionLogs} or {@link readPlainSessionLog}.
 * @returns the principal id on the first `identity/attached` record.
 * @throws when the log carries no attachment, or one without a principal id.
 */
export function attachedPrincipal(log: ReadLog): string {
  const attached = log.records.find(record => record.type === 'identity/attached')
  if (attached === undefined) throw new Error('this session log carries no identity/attached record')
  const identity = attached.data?.['identity'] as { principal?: { id?: unknown } } | undefined
  const id = identity?.principal?.id
  if (typeof id !== 'string') throw new Error('the identity/attached record carries no principal id')
  return id
}

/**
 * The host user id a launch resolved, read from the file it persisted.
 *
 * `hostUserIdentity` brands this exact string as the principal id
 * (`host-user-id/src/index.ts:88-99` writes it, `:170-172` brands it), so a
 * case comparing it with a log's attached principal is joining the launcher's
 * own durable state to what the session recorded — not two copies of one
 * expectation.
 * @param dshHome - the `$DSH_HOME` the launch ran under.
 * @returns the persisted id, without its trailing newline.
 */
export async function persistedHostUserId(dshHome: string): Promise<string> {
  return (await readFile(join(dshHome, HOST_USER_ID_FILE_NAME), 'utf8')).trim()
}

/**
 * Count the records of one type, which is how the identity cases read a log.
 * @param log - a log read by {@link readSessionLog}, {@link readSessionLogs} or {@link readPlainSessionLog}.
 * @param type - the record type to count.
 * @returns how many records carry that type.
 */
export function countRecords(log: ReadLog, type: string): number {
  return log.records.filter(record => record.type === type).length
}
