/**
 * On-disk format helpers for the JSONL session-persistence backend: path
 * sanitization (a {@link SessionId} is an unvalidated branded string, so it
 * MUST be encoded before use in a path — no traversal, no collision), the
 * per-project/session directory layout, header-line (de)serialization, and the
 * truncation-repair offset computation.
 *
 * @module dsh-session-persistence-jsonl/format
 */

import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { getSchema, negotiateSchema } from '@deepseek-ai/dsh-schema-registry'
import type { SchemaId, SchemaVersion } from '@deepseek-ai/dsh-schema-registry'
import {
  decodeSeqRanges, decodeStorageRecord, encodeSeqRanges, packChunkRuns, SESSION_FORMAT_VERSION,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import { isChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  StorageRecord,
} from '@deepseek-ai/dsh-session'
import {
  SessionFormatUnsupportedError,
  sessionFormatVersionRefusal,
  type SessionStorageMetadata,
} from '@deepseek-ai/dsh-session-persistence'

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'

/**
 * Return the artifact suffix for one physical encoding.
 * @param compression - configured JSONL artifact encoding.
 * @returns `.jsonl.zstd` for Zstandard or `.jsonl` for plaintext.
 */
export function logSuffix(compression: JsonlCompression): '.jsonl.zstd' | '.jsonl' {
  return compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
}

/**
 * The private version-0 physical header stored as the first JSONL record.
 * Its optional numeric `seedLength` translates to logical lineage metadata
 * plus a separately carried exact inherited cut.
 */
interface HeaderLine {
  type: 'session'
  version: number
  id: SessionId
  createdAt: number
  cwd?: string
  parentSession?: SessionId
  seedLength?: number
  origin?: 'subagent'
  delegationDepth: number
  agentPreset?: string
}

/**
 * Build the header line object from a {@link SessionHeader}.
 * @param header - the immutable session metadata to serialize.
 * @param inheritedEventCount - exact inherited prefix length; required for a
 * seeded header and omitted only for an unseeded header.
 * @returns the `type: 'session'`-tagged line object, absent optional fields omitted (never null).
 */
export function toHeaderLine(
  header: SessionHeader,
  inheritedEventCount?: SessionLogOffsetType,
): HeaderLine {
  if (header.isSeeded && inheritedEventCount === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const cut = SessionLogOffset(inheritedEventCount ?? 0)
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
  return {
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    ...header.parentSession !== undefined ? { parentSession: header.parentSession } : {},
    ...header.isSeeded ? { seedLength: cut } : {},
    ...header.origin !== undefined ? { origin: header.origin } : {},
    delegationDepth: header.delegationDepth ?? 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  }
}

/**
 * Translate one version-0 physical header into logical metadata and its cut.
 * @param line - the shape-checked first line of a log (see the `isHeaderLine` guard).
 * @returns logical Session metadata paired with the exact inherited prefix length.
 */
function fromHeaderLine(line: HeaderLine): SessionStorageMetadata {
  if (Object.hasOwn(line, 'sandboxMode') || Object.hasOwn(line, 'approvalPolicy')) {
    throw new Error('session header uses retired policy baseline fields')
  }
  return {
    meta: {
      version: line.version,
      id: line.id,
      createdAt: line.createdAt,
      ...line.cwd !== undefined ? { cwd: line.cwd } : {},
      ...line.parentSession !== undefined ? { parentSession: line.parentSession } : {},
      isSeeded: line.seedLength !== undefined,
      ...line.origin !== undefined ? { origin: line.origin } : {},
      delegationDepth: line.delegationDepth,
      ...line.agentPreset !== undefined ? { agentPreset: line.agentPreset } : {},
    },
    inheritedEventCount: SessionLogOffset(line.seedLength ?? 0),
  }
}

/** Type guard: a parsed first line is a well-formed session header. */
function isHeaderLine(value: unknown): value is HeaderLine {
  return (
    typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'session'
    && typeof (value as { version?: unknown }).version === 'number'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { createdAt?: unknown }).createdAt === 'number'
    && Number.isSafeInteger((value as { createdAt: number }).createdAt)
    && (value as { createdAt: number }).createdAt >= 0
    && !Object.is((value as { createdAt: number }).createdAt, -0)
    && typeof (value as { delegationDepth?: unknown }).delegationDepth === 'number'
    && Number.isSafeInteger((value as { delegationDepth: number }).delegationDepth)
    && (value as { delegationDepth: number }).delegationDepth >= 0
    && !Object.is((value as { delegationDepth: number }).delegationDepth, -0)
    && ((value as { seedLength?: unknown }).seedLength === undefined
      || (typeof (value as { seedLength?: unknown }).seedLength === 'number'
        && Number.isSafeInteger((value as { seedLength: number }).seedLength)
        && (value as { seedLength: number }).seedLength >= 0
        && !Object.is((value as { seedLength: number }).seedLength, -0)))
    && ((value as { origin?: unknown }).origin === undefined
      || (value as { origin?: unknown }).origin === 'subagent')
    && ((value as { agentPreset?: unknown }).agentPreset === undefined
      || typeof (value as { agentPreset?: unknown }).agentPreset === 'string')
  )
}

/**
 * Encode an arbitrary string as a single safe path segment, injectively over ALL JS (UTF-16)
 * strings — including lone surrogates. A {@link SessionId} is an unvalidated branded string,
 * so this neutralizes `../`, absolute paths, NUL, and separators before any filesystem use.
 * Safe code units remain literal; every other unit, including `~`, becomes
 * `~XXXX`. Operating on code units preserves lone surrogates, while special-
 * casing `.` and `..` prevents traversal by an otherwise safe whole segment.
 *
 * @param raw - the string to encode; must be non-empty (throws on `''`).
 * @returns the escaped single path segment, decodable back to `raw`.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * Build the readable directory key for a project path.
 * Filesystem separators and drive separators become `-`; unsafe code units use
 * the same `~XXXX` escape as session ids. The key is bounded for filesystem
 * component limits. Separator replacement and truncation are intentionally
 * lossy, following the common human-navigable project-directory convention.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * The configured root's human-navigable project directory. A configured root
 * may be local or shared; this grouping does not prescribe its deployment.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory; `undefined` selects `_no-cwd`.
 * @returns the project directory path under `root`.
 */
export function projectDir(root: string, cwd: string | undefined): string {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * The directory owned by one session and available for future session-local
 * artifacts.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory.
 * @param id - the session id, encoded to one safe path segment.
 * @returns the session directory beneath its project directory.
 */
export function sessionDir(root: string, cwd: string | undefined, id: SessionId): string {
  return join(projectDir(root, cwd), encodeSegment(id))
}

/**
 * The append-only event-log file path for a session.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory (`undefined` → `_no-cwd`).
 * @param id - the session id, path-encoded via {@link encodeSegment} before filesystem use.
 * @param compression - physical artifact encoding and filename suffix.
 * @returns the session's configured JSONL artifact path.
 */
export function logPath(
  root: string,
  cwd: string | undefined,
  id: SessionId,
  compression: JsonlCompression,
): string {
  return join(sessionDir(root, cwd, id), `session${logSuffix(compression)}`)
}

/**
 * Serialize an event batch as JSONL lines (no trailing newline). With
 * `packChunks` on, delta-chunk runs pack into `text-chunks` /
 * `reasoning-chunks` / `tool-call-chunks` storage rows; off writes one event
 * per line. Both modes range-encode provenance at the storage boundary.
 * Reading is layout-blind either way ({@link scanLog} always decodes rows),
 * so the switch changes only newly written bytes.
 * @param events - the batch to serialize, in log order.
 * @param packChunks - whether to pack delta runs into storage rows.
 * @returns the batch's JSONL text; the writer adds the final newline.
 */
export function eventLines(events: readonly SessionEvent[], packChunks: boolean): string {
  const records: readonly StorageRecord[] = packChunks ? packChunkRuns(events) : events
  return records.map(record => JSON.stringify(encodeProvenanceForStorage(record))).join('\n')
}

/**
 * Losslessly shrink a record's `sourceEventSeqs` for the log: consecutive
 * runs of at least three seqs become `[start, end]` pairs, and any other list
 * stays verbatim.
 * @param record - one stored record (event or packed row).
 * @returns the record with its provenance in storage form (widened from the
 *   in-memory `SessionSeq[]`; {@link expandProvenanceFromStorage} restores it).
 */
function encodeProvenanceForStorage(record: StorageRecord): unknown {
  if (!('sourceEventSeqs' in record)) return record
  return { ...record, sourceEventSeqs: encodeSeqRanges(record.sourceEventSeqs) }
}

/**
 * Expand a parsed line's storage-form provenance back to `SessionSeq[]`.
 * @param parsed - the JSON-parsed value of one stored line.
 * @returns the value with provenance expanded.
 * @throws when the record or its storage-form provenance is malformed.
 */
function expandProvenanceFromStorage(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('stored session records must be objects')
  }
  const record = parsed as { seq?: unknown; sourceEventSeqs?: unknown }
  if (record.sourceEventSeqs === undefined) return parsed
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0) {
    throw new TypeError('stored session event seq must be a non-negative safe integer')
  }
  return { ...record, sourceEventSeqs: decodeSeqRanges(record.sourceEventSeqs, record.seq as number) }
}

/** Whether a value is a well-formed `{major, minor}` schema version pair. */
function isSchemaVersion(value: unknown): value is SchemaVersion {
  if (typeof value !== 'object' || value === null) return false
  const { major, minor } = value as { major?: unknown; minor?: unknown }
  return typeof major === 'number' && typeof minor === 'number'
}

/**
 * Negotiate a raw parsed JSONL event record's schema before it is trusted as
 * a {@link SessionEvent}: must[4] (session replay negotiates schema before
 * use). A packed chunk row (`isChunkRow`) is a storage encoding, not a
 * session-event payload, and is skipped — its expanded members carry
 * `assistant/chunk`'s own type, negotiated once decoded elsewhere is
 * unnecessary since chunk rows have never varied in shape. A record whose
 * `type` has no registered `session-event:${type}` schema is ALSO skipped —
 * an unrecognized type is the container-level `ignorable` marker's
 * jurisdiction (an unmarked unknown type refuses the whole log; a marked one
 * is tolerated), or a retired legacy type another check rejects by name;
 * this registry versions only a KNOWN leaf object's payload, never decides
 * whether a type is known at all (BLOCKED-008 scope split). An explicit
 * `schemaVersion` tag on a record whose type IS registered
 * (`@deepseek-ai/dsh-schema-registry`'s `session-event:${type}` convention)
 * is negotiated verbatim and stripped so it never reaches the trusted
 * `SessionEvent`; its absence defaults to this build's own currently
 * registered version, since no session-event payload has ever been
 * persisted with the tag before this mechanism existed.
 * @param parsed - one line's `JSON.parse` result, before provenance expansion or chunk decoding.
 * @throws {@link SchemaCompatibilityError} when an explicit encountered version's major differs
 *   from this build's registered major for the event type.
 */
function negotiateEventLineSchema(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
  const record = parsed as Record<string, unknown>
  const type = record['type']
  if (typeof type !== 'string' || isChunkRow(record as unknown as StorageRecord)) return
  const schemaId = brandString<SchemaId>(`session-event:${type}`)
  const registered = getSchema(schemaId)
  if (registered === undefined) return
  const rawVersion = record['schemaVersion']
  delete record['schemaVersion']
  const encounteredVersion = isSchemaVersion(rawVersion) ? rawVersion : registered.version
  const result = negotiateSchema(schemaId, encounteredVersion)
  if (!result.compatible) throw result.error
}

interface SessionLogScan {
  meta: SessionHeader
  inheritedEventCount: SessionLogOffsetType
  events: SessionEvent[]
  committedBytes: number
  /**
   * Evidence naming the first committed row this build could not read, or
   * `undefined` when the whole committed region was recovered.
   *
   * Present alongside a non-empty `events`: the scanner keeps the recoverable
   * prefix and reports why it stopped, rather than choosing between the two.
   * A caller that ignores this field silently presents a truncated log as a
   * complete one, which is why it is returned rather than only thrown — the
   * scanner throws only when a `turn/end` proves the damage falls inside a
   * region that must be contiguous.
   */
  corruption?: CorruptedLogEvidence
}

/**
 * The exact failure that ended the recoverable prefix. Mirrors
 * `@deepseek-ai/dsh-session-lifecycle`'s type of the same name by structure
 * rather than by import, so the two packages stay independent.
 *
 * The structural mirror does NOT extend to the obligations: that type promises
 * no bound on `raw` and its reader applies none, while this one does. The
 * independence is deliberate; the divergence it permits is not visible to the
 * compiler, so it is stated here instead
 * ([BLOCKED-075](../../../../spec/first100/exec/BLOCKED-QUEUE.md)).
 */
export interface CorruptedLogEvidence {
  /** 1-based index of the offending row among event rows, header excluded. */
  readonly lineNumber: number
  /** The row's raw bytes as UTF-8, truncated to `CORRUPTION_RAW_LIMIT`. */
  readonly raw: string
  /** Why this build could not read the row. */
  readonly parseError: string
}

/**
 * Bytes of a corrupt row retained as evidence. A corrupt row has no trustworthy
 * length, so the whole of it is never copied into an error path.
 */
const CORRUPTION_RAW_LIMIT = 512

/** Parse one complete header record supplied independently from event rows. */
/**
 * Refuse a header carrying a format version this build does not read BEFORE
 * validating the current header shape or decoding any event row: a future
 * format need not satisfy this build's structural checks at all, and its user
 * must see "upgrade the harness", never "corrupt session log".
 * @param parsed - the JSON-parsed first line of a session artifact.
 */
function refuseForeignFormatVersion(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) return
  const { version, id } = parsed as { version?: unknown; id?: unknown }
  if (typeof version !== 'number' || version === SESSION_FORMAT_VERSION) return
  throw new SessionFormatUnsupportedError(
    sessionFormatVersionRefusal(typeof id === 'string' ? id : String(id), version),
  )
}

function parseHeaderRecord(record: Buffer): ReturnType<typeof fromHeaderLine> {
  if (record.length === 0 || record.at(-1) !== 0x0A || record.indexOf(0x0A) !== record.length - 1) {
    throw new Error('empty or header-less session log')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(record.subarray(0, -1).toString('utf8'))
  } catch {
    throw new Error('corrupt session log: header line is not valid JSON')
  }
  refuseForeignFormatVersion(parsed)
  if (!isHeaderLine(parsed)) {
    throw new Error('corrupt session log: first line is not a session header')
  }
  return fromHeaderLine(parsed)
}

/**
 * Incrementally scan complete JSONL event records after an independently
 * supplied header record. Newline search and byte offsets stay on raw buffers;
 * only complete records are decoded to UTF-8. A fragment crossing writes is
 * copied because a decoder may reuse its output buffer after `write()` returns.
 */
export class SessionLogScanner {
  private readonly meta: SessionHeader
  private readonly inheritedEventCount: SessionLogOffsetType
  private readonly events: SessionEvent[] = []
  private fragments: Buffer[] = []
  private fragmentBytes = 0
  private inputBytes: number
  private committedBytes: number
  private eventLine = 0
  private issue: Error | undefined

  /** Structured form of {@link issue}, returned by {@link finish}. */
  private corruption: CorruptedLogEvidence | undefined

  /** Whether the recorded corruption is a seq gap rather than an unreadable row. */
  private seqGap = false
  private finished = false

  /**
   * Create an event scanner from exactly one newline-terminated header record.
   * @param headerRecord - the complete first JSONL record, including its newline.
   */
  constructor(headerRecord: Buffer) {
    const parsed = parseHeaderRecord(headerRecord)
    this.meta = parsed.meta
    this.inheritedEventCount = parsed.inheritedEventCount
    this.inputBytes = headerRecord.length
    this.committedBytes = headerRecord.length
  }

  /**
   * Consume the next raw plaintext chunk, retaining only an incomplete final record.
   * @param chunk - bytes immediately following all previously supplied bytes.
   */
  write(chunk: Buffer): void {
    if (this.finished) throw new Error('cannot write to a finished session log scanner')
    const chunkStart = this.inputBytes
    this.inputBytes += chunk.length
    let lineStart = 0
    for (
      let newline = chunk.indexOf(0x0A);
      newline !== -1;
      newline = chunk.indexOf(0x0A, lineStart)
    ) {
      const fragment = chunk.subarray(lineStart, newline)
      let line = fragment
      if (this.fragments.length > 0) {
        if (fragment.length > 0) this.fragments.push(fragment)
        line = Buffer.concat(this.fragments, this.fragmentBytes + fragment.length)
        this.fragments = []
        this.fragmentBytes = 0
      }
      this.consumeEventLine(line, chunkStart + newline + 1)
      lineStart = newline + 1
    }
    if (lineStart < chunk.length) {
      const fragment = Buffer.from(chunk.subarray(lineStart))
      this.fragments.push(fragment)
      this.fragmentBytes += fragment.length
    }
  }

  /**
   * Snapshot progress before appending a recoverable torn-frame prefix.
   * @returns byte, committed-prefix, and expanded-event cursors.
   */
  checkpoint(): {
    inputBytes: number
    committedBytes: number
    eventCount: SessionLogOffsetType
  } {
    return {
      inputBytes: this.inputBytes,
      committedBytes: this.committedBytes,
      eventCount: SessionLogOffset(this.events.length),
    }
  }

  /**
   * Finish scanning, ignoring a final record without a newline as a torn tail.
   * @returns the header, contiguous event prefix, and safe truncation offset.
   */
  finish(): SessionLogScan {
    this.finished = true
    return {
      meta: this.meta,
      inheritedEventCount: this.inheritedEventCount,
      events: this.events,
      committedBytes: this.committedBytes,
      ...(this.corruption === undefined ? {} : { corruption: this.corruption }),
    }
  }

  /**
   * Record why the recoverable prefix ends here, keeping both the throwable
   * form and the structured evidence {@link finish} returns. First writer wins:
   * the first unreadable row is what bounds the prefix, and every later row is
   * already outside it.
   * @param line - the offending row's raw bytes.
   * @param reason - why this build could not read it.
   */
  private recordCorruption(line: Buffer, reason: string, seqGap = false): void {
    if (this.issue !== undefined) return
    this.seqGap = seqGap
    // The thrown message is unchanged from before this field existed: callers
    // and tests match on it, and the detail now lives in `corruption` instead.
    this.issue = new Error(
      this.seqGap
        ? `corrupt session log: seq gap in committed region at line ${this.eventLine} (${reason})`
        : `corrupt session log: unparsable committed event at line ${this.eventLine}`,
    )
    this.corruption = {
      lineNumber: this.eventLine,
      raw: line.toString('utf8').slice(0, CORRUPTION_RAW_LIMIT),
      parseError: reason,
    }
  }

  /** Decode one complete event row and update the contiguous prefix. */
  private consumeEventLine(line: Buffer, endByte: number): void {
    this.eventLine += 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line.toString('utf8'))
    } catch (error) {
      this.recordCorruption(line, `unparsable JSON: ${(error as Error).message}`)
      return
    }
    // Schema incompatibility is a structured, machine-readable refusal, not
    // corrupt-log recovery data: it must propagate directly, never fold into
    // the tolerant-suffix heuristic below.
    negotiateEventLineSchema(parsed)
    let decoded: SessionEvent[]
    try {
      decoded = decodeStorageRecord(expandProvenanceFromStorage(parsed))
    } catch (error) {
      this.recordCorruption(line, `undecodable event record: ${(error as Error).message}`)
      return
    }

    if (this.issue !== undefined) {
      if (decoded.some(event => event.type === 'turn/end')) throw this.issue
      return
    }

    const rowStart = this.events.length
    for (const event of decoded) {
      if (event.seq !== this.events.length) {
        const expected = this.events.length
        this.events.length = rowStart
        this.recordCorruption(line, `expected seq ${expected}, got ${event.seq}`, true)
        if (decoded.some(candidate => candidate.type === 'turn/end')) throw this.issue
        return
      }
      this.events.push(event)
    }
    this.committedBytes = endByte
  }
}

/**
 * Parse a complete or torn JSONL buffer into its preserved event prefix. This
 * compatibility wrapper supplies the first record separately, then delegates
 * event rows to {@link SessionLogScanner}.
 *
 * @param buffer - the raw bytes of the log file (header line first).
 * @returns the header, preserved event prefix, and byte offset safe to append at.
 */
export function scanLog(buffer: Buffer): SessionLogScan {
  const headerEnd = buffer.indexOf(0x0A)
  if (headerEnd === -1) throw new Error('empty or header-less session log')
  const scanner = new SessionLogScanner(buffer.subarray(0, headerEnd + 1))
  scanner.write(buffer.subarray(headerEnd + 1))
  return scanner.finish()
}

/**
 * Parse just the header line of a log into logical metadata plus its exact
 * inherited cut, or `undefined` if it is missing/not a header.
 * @param firstLine - the first line of a log file (without its trailing newline).
 * @returns parsed storage metadata, or `undefined` for a malformed header.
 */
export function parseHeader(firstLine: string): SessionStorageMetadata | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine)
  } catch {
    return undefined
  }
  refuseForeignFormatVersion(parsed)
  if (!isHeaderLine(parsed)) return undefined
  return fromHeaderLine(parsed)
}

/**
 * Parse only the logical header fields needed by lightweight listing.
 * @param firstLine - first JSONL line without its trailing newline.
 * @returns the logical Session header, or `undefined` for a malformed line.
 */
export function parseHeaderMeta(firstLine: string): SessionHeader | undefined {
  return parseHeader(firstLine)?.meta
}
