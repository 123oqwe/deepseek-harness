/**
 * Pure ACP transcript and session-log normalizers. They scrub session ids, run cwd, RPC ids,
 * timestamps, goal lifecycle clocks, and hook duration while preserving semantic payload values.
 * Request-header scrubbers stay composable so one scenario per header class can pin prompt and
 * tool-schema sidecars.
 * @module @deepseek-ai/dsh-session-snapshot/normalize
 */

import {
  decodeSeqRanges,
  decodeStorageRecord,
  packChunkRuns,
  SessionLogOffset,
  SessionSeq,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { redactSessionSnapshotIds } from './identity.ts'

const SESSION_ID = '{{sessionId}}'
const MESSAGE_ID = '{{messageId}}'
const USED_TOKENS = '{{usedTokens}}'
const CWD = '{{cwd}}'
const SYSTEM = '{{system}}'
const TOOLS = '{{tools}}'
const EVENT_TIME = '{{eventTime}}'
const EVENT_OMITTED_BYTES = '{{eventOmittedBytes}}'
const ARGUMENTS_HASH = '{{argumentsHash}}'
const IDEMPOTENCY_KEY = '{{idempotencyKey}}'
const SANDBOX_MODE = '{{sandboxMode}}'
const PACKED_CHUNK_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

function isPackedFixtureRow(record: Record<string, unknown>): boolean {
  return typeof record.type === 'string' && PACKED_CHUNK_ROW_TYPES.has(record.type)
}

function omitFixtureEnvelope(record: Record<string, unknown>): void {
  delete record.seq
  delete record.time
  delete record.seq0
  delete record.time0
}

/** A cwd-rooted path after volatile cwd replacement, through its last separator-delimited segment. */
const CWD_ROOTED_PATH_RE = /\{\{cwd\}\}(?:[\\/][^\s<>"'`]+)+/g

const PATH_TAG_RE = /(<path>)([^<]*)(<\/path>)/g
const ADDITIONAL_INSTRUCTIONS_PATH_RE = /(Additional instructions from: )([^\r\n]+)/g
const EMBEDDED_EVENT_TIME_RE = /^(  "time": )\d+(?=,\r?$)/gm
const EVENT_READ_OMITTED_BYTES_RE = /(\r?\n\r?\n\(Omitted )\d+( bytes\.)/g
const EVENT_READ_TARGET_REGION_RE
  = /^Session [^\r\n]+ — [^\r\n]+\r?\nTarget event seq \d+:\r?\n```json\r?\n\{\r?\n[\s\S]*?(?=\r?\n```(?:\r?\n|$)|\r?\n\r?\n\(Omitted )/
const PATH_TEXT_BOUNDARY_RE = /[\s<>'"`()\[\]{},;:!?=]/
const FILE_URI_PATH_PREFIX_RE = /(?:^|[^a-z0-9+.-])file:\/\/\/?$/i

/** A UUID v4 string, the shape `randomUUID()` produces for session ids. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const LOCAL_SPILL_PATH_RE = new RegExp(
  String.raw`\{\{cwd\}\}[\\/]\.spill[\\/]session-[0-9a-f]{12}[\\/][0-9a-f]{12}-([A-Za-z0-9._~-]+?)`
  + String.raw`(?=\. Use read with offset/limit|[\s)]|$)`,
  'g',
)
const SNAPSHOT_SPILL_PATH_RE = new RegExp(
  String.raw`(?:[A-Za-z]:)?[\\/](?:tmp|t)[\\/](?:dsh-acp-snap-[0-9a-f]{9}|dsh-acp-snapshot-spill)[\\/]session-[0-9a-f]{12}[\\/][0-9a-f]{12}-([A-Za-z0-9._~-]+?)`
  + String.raw`(?=\. Use read with offset/limit|[\s)]|$)`,
  'g',
)

/**
 * Extract every snapshot-mode spill path from a session log, keyed by spill
 * filename. Used by refresh write-back to keep spill paths stable across runs.
 * @param content - the raw session log text to scan.
 * @returns spill filename → the full matched spill path, last match wins per name.
 */
export function extractSnapshotSpillPaths(content: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const match of content.matchAll(SNAPSHOT_SPILL_PATH_RE)) {
    const name = match[1]
    /* v8 ignore next -- the filename capture is required and non-empty whenever the spill regex matches */
    if (name === undefined) continue
    result.set(name, match[0])
  }
  return result
}

/** Convert separators only inside generated path-bearing text markers. */
function canonicalizeEmbeddedPaths(value: string): string {
  return value
    .replace(PATH_TAG_RE, (_match, open: string, path: string, close: string) =>
      `${open}${path.replaceAll('\\', '/')}${close}`)
    .replace(ADDITIONAL_INSTRUCTIONS_PATH_RE, (_match, prefix: string, path: string) =>
      `${prefix}${path.replaceAll('\\', '/')}`)
}

/** Inputs the normalizers need to recognize a run's volatile values. */
export interface NormalizeContext {
  /** The session id(s) the run issued — replaced with `{{sessionId}}`. */
  sessionIds: string[]
  /** The generated cwd the run used — replaced with `{{cwd}}`. */
  cwd: string
  /** Other filesystem spellings of the same cwd (for example Windows short and long paths). */
  cwdAliases?: readonly string[]
}

/** How cwd-rooted path separators are represented after the cwd is tokenized. */
export type CwdPathMode = 'canonical' | 'native'

/** Optional controls shared by stdout and session-log normalization. */
export interface NormalizeOptions {
  /** Use `/` for shared goldens, or preserve captured separators for a platform-specific golden. */
  cwdPathMode?: CwdPathMode
  /** Keep already-redacted typed ids and arbitrary UUID-like prose unchanged. */
  identityMode?: 'legacy' | 'preserve'
}

/**
 * macOS roots that are real directories under `/private` and reachable by both
 * spellings. Only these three are paired: stripping `/private` from an
 * arbitrary path would invent a shorter alias that names a different directory
 * and could tokenize text belonging to it.
 */
const MAC_PRIVATE_ROOTS = ['/var/', '/tmp/', '/etc/']

/**
 * Return every known spelling of the generated cwd, most specific first.
 *
 * The pairing is BIDIRECTIONAL. Both spellings of one directory occur in real
 * recordings — a value derived through `realpath` carries `/private/var/...`
 * while one derived from `os.tmpdir()` carries `/var/...` — and which one the
 * run reports as its cwd is not fixed. Generating only the `/private` form
 * (BLOCKED-223) left the plain form unmatched whenever the run's own cwd was
 * already the `/private` spelling, and the untokenized absolute path was then
 * written into the committed fixture, which no second machine can reproduce.
 * @param ctx - the run's cwd and any additional spellings its host reported.
 * @returns the spellings to match, longest first so a prefix never wins over a
 * more specific alias.
 */
function cwdSpellings(ctx: NormalizeContext): string[] {
  const spellings = [...new Set([ctx.cwd, ...ctx.cwdAliases ?? []])]
    .filter(spelling => spelling.length > 0)
  const privateAliases = spellings
    .filter(spelling => spelling.startsWith('/') && !spelling.startsWith('/private/'))
    .map(spelling => `/private${spelling}`)
  const plainAliases = spellings
    .filter(spelling => MAC_PRIVATE_ROOTS.some(root => spelling.startsWith(`/private${root}`)))
    .map(spelling => spelling.slice('/private'.length))
  return [...new Set([...spellings, ...privateAliases, ...plainAliases])]
    .sort((left, right) => right.length - left.length)
}

/** Whether an embedded cwd match starts and ends at a path/text boundary. */
function isCwdMatch(value: string, start: number, length: number): boolean {
  const before = value[start - 1]
  const after = value[start + length]
  const afterPunctuation = value[start + length + 1]
  const startsAtBoundary = before === undefined
    || PATH_TEXT_BOUNDARY_RE.test(before)
    || FILE_URI_PATH_PREFIX_RE.test(value.slice(0, start))
  const endsAtBoundary = after === undefined
    || after === '/'
    || after === '\\'
    || PATH_TEXT_BOUNDARY_RE.test(after)
    || after === '.' && (afterPunctuation === undefined || PATH_TEXT_BOUNDARY_RE.test(afterPunctuation))
  return startsAtBoundary && endsAtBoundary
}

/** Replace one cwd spelling without matching a longer path segment that merely shares its prefix. */
function replaceCwdSpelling(value: string, spelling: string, replacement: string): string {
  let cursor = 0
  let out = ''
  while (cursor < value.length) {
    const match = value.indexOf(spelling, cursor)
    if (match < 0) return out + value.slice(cursor)
    const end = match + spelling.length
    if (isCwdMatch(value, match, spelling.length)) {
      out += value.slice(cursor, match) + replacement
      cursor = end
    } else {
      out += value.slice(cursor, end)
      cursor = end
    }
  }
  return out
}

/** Replace every known cwd spelling with one stable token. */
function replaceCwd(value: string, ctx: NormalizeContext, replacement: string): string {
  let out = value
  for (const spelling of cwdSpellings(ctx)) out = replaceCwdSpelling(out, spelling, replacement)
  return out
}

/** Replace cwd, session ids, and any stray UUID with stable tokens in a string. */
function scrubString(
  value: string,
  ctx: NormalizeContext,
  cwdPathMode: CwdPathMode,
  identityMode: 'legacy' | 'preserve',
): string {
  let out = replaceCwd(value, ctx, CWD)
  // Filesystem APIs can report one directory with several spellings. Replace
  // every known spelling longest-first so a shorter alias cannot corrupt a
  // longer one before it is tokenized. macOS additionally symlinks
  // /tmp → /private/tmp and /var → /private/var: the session header cwd may
  // omit the /private prefix while fs tools resolve symlinks, so cover the
  // prefixed form of every spelling too, then collapse a residual prefixed
  // token.
  out = out.split(`/private${CWD}`).join(CWD)
  if (cwdPathMode === 'canonical') {
    // Restrict separator conversion to paths rooted at the cwd token. A global
    // backslash rewrite would corrupt regexes, commands, and model-authored text.
    out = out.replace(CWD_ROOTED_PATH_RE, path => path.replaceAll('\\', '/'))
    out = canonicalizeEmbeddedPaths(out)
  }
  out = out.replace(LOCAL_SPILL_PATH_RE, (_match, name: string) => `{{spillLocator:${name}}}`)
  out = out.replace(SNAPSHOT_SPILL_PATH_RE, (_match, name: string) => `{{spillLocator:${name}}}`)
  // Exact event-read results render the target as pretty JSON inside a
  // distinctive envelope. Restrict time scrubbing to that fenced target so
  // neighbor, model, bash, and unrelated tool text remains regression-visible.
  if (EVENT_READ_TARGET_REGION_RE.test(out)) {
    out = out.replace(
      EVENT_READ_TARGET_REGION_RE,
      target => target.replace(EMBEDDED_EVENT_TIME_RE, `$1${EVENT_TIME}`),
    )
    out = out.replace(EVENT_READ_OMITTED_BYTES_RE, `$1${EVENT_OMITTED_BYTES}$2`)
  }
  if (identityMode === 'legacy') {
    for (const id of ctx.sessionIds) out = out.split(id).join(SESSION_ID)
    out = out.replace(UUID_RE, SESSION_ID)
  }
  return out
}

/** Recursively scrub a parsed JSON value (strings replaced; structure kept). */
function scrubValue(
  value: unknown,
  ctx: NormalizeContext,
  cwdPathMode: CwdPathMode,
  identityMode: 'legacy' | 'preserve',
  key?: string,
): unknown {
  if (typeof value === 'string') {
    if (identityMode === 'legacy' && key === 'messageId') return MESSAGE_ID
    const scrubbed = scrubString(value, ctx, cwdPathMode, identityMode)
    return cwdPathMode === 'canonical' && key === 'path' ? scrubbed.replaceAll('\\', '/') : scrubbed
  }
  if (Array.isArray(value)) return value.map(v => scrubValue(v, ctx, cwdPathMode, identityMode))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, ctx, cwdPathMode, identityMode, k)
    if (
      (value as { sessionUpdate?: unknown }).sessionUpdate === 'usage_update'
      && typeof (value as { used?: unknown }).used === 'number'
    ) out.used = USED_TOKENS
    return out
  }
  return value
}

/** Escape one literal path segment for use in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Replace any absolute spelling whose final segment is the generated cwd basename. */
function tokenizeFixtureString(value: string, ctx: NormalizeContext, basename: string): string {
  const exact = replaceCwd(value, ctx, CWD)
  const absoluteCwd = new RegExp(
    String.raw`(?:[A-Za-z]:)?[\\/](?:[^\\/\s<>"]+[\\/])*${escapeRegExp(basename)}`
    + String.raw`(?=$|[\\/\s<>'"()\[\]{},;:!?=])`,
    'g',
  )
  return exact.replace(absoluteCwd, CWD).split(`/private${CWD}`).join(CWD)
}

/** Recursively replace generated-cwd spellings while preserving every other JSON value. */
function tokenizeFixtureValue(
  value: unknown,
  ctx: NormalizeContext,
  basename: string,
): unknown {
  if (typeof value === 'string') return tokenizeFixtureString(value, ctx, basename)
  if (Array.isArray(value)) return value.map(item => tokenizeFixtureValue(item, ctx, basename))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      tokenizeFixtureValue(item, ctx, basename),
    ]))
  }
  return value
}

/**
 * Store one generated workspace as `{{cwd}}` while retaining every other
 * session value. The caller opts in only for workspaces created under a
 * platform temporary root; explicitly relocated workspaces keep their real
 * path.
 *
 * **Pass `runCwd` whenever the caller knows it (BLOCKED-223).** Refresh hands
 * this function a log whose header has already been replaced by the prior
 * fixture's, so the header's `cwd` reads `{{cwd}}` and deriving from it yields
 * a basename that matches nothing. Text carried over from the prior fixture is
 * already tokenized and looks correct, so the failure is invisible except in
 * text that is NEW in this refresh — which keeps its real absolute path and is
 * committed, in a fixture no second machine can reproduce. Measured on
 * `skill-load`. Deriving from the header stays the fallback for callers holding
 * only a raw log, and keeps this function idempotent on its own output.
 *
 * @param rawLog The raw or refresh-stabilized session JSONL fixture.
 * @param runCwd The cwd the run actually used, when the caller knows it.
 * @returns Compact JSONL whose known cwd spellings become `{{cwd}}`.
 * @throws If a non-empty line is invalid JSON or the session cwd has no basename.
 */
export function tokenizeSessionFixtureCwd(rawLog: string, runCwd?: string): string {
  const lines = rawLog.split('\n')
  const firstLine = lines.find(line => line.trim().length > 0)
  const header = firstLine === undefined ? undefined : JSON.parse(firstLine) as { cwd?: unknown }
  const headerCwd = typeof header?.cwd === 'string' ? header.cwd : ''
  const cwd = runCwd !== undefined && runCwd.length > 0 ? runCwd : headerCwd
  const basename = cwd.split(/[\\/]/).at(-1)
  if (basename === undefined || basename.length === 0) {
    throw new Error('acp-snapshot: cannot tokenize a cwd without a basename')
  }
  const ctx: NormalizeContext = { sessionIds: [], cwd }
  return lines.map((line) => {
    if (line.trim().length === 0) return line
    return JSON.stringify(tokenizeFixtureValue(JSON.parse(line), ctx, basename))
  }).join('\n')
}

/**
 * Normalize a raw stdout transcript (newline-delimited JSON-RPC frames) into a stable expected output
 * in the same shape as the wire: one compact JSON frame per line (NDJSON), with the JSON-RPC
 * `id` rewritten to a per-transcript sequence (1, 2, 3, …) and all volatile strings scrubbed.
 * Invalid JSON throws, doubling as a protocol-stdout purity check.
 *
 * @param rawStdout The captured stdout bytes, decoded utf8.
 * @param ctx The run's volatile values to scrub.
 * @param options Separator output controls; shared canonical paths are the default.
 * @returns The normalized NDJSON transcript, one frame per line.
 */
export function normalizeStdout(
  rawStdout: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  const cwdPathMode = options.cwdPathMode ?? 'canonical'
  const identityMode = options.identityMode ?? 'legacy'
  const lines = rawStdout.split('\n').filter(line => line.trim().length > 0)
  // Map each distinct JSON-RPC id (request/response correlate by id) to a stable
  // sequence number, in first-seen order, so id churn doesn't perturb the expected output.
  const idSeq = new Map<string, number>()
  const stableId = (id: unknown): number => {
    const key = JSON.stringify(id)
    let n = idSeq.get(key)
    if (n === undefined) { n = idSeq.size + 1; idSeq.set(key, n) }
    return n
  }
  const frames = lines.map((line) => {
    const frame = JSON.parse(line) as Record<string, unknown>
    if ('id' in frame && frame.id !== undefined && frame.id !== null) {
      frame.id = stableId(frame.id)
    }
    return scrubValue(frame, ctx, cwdPathMode, identityMode) as Record<string, unknown>
  })
  return frames.map(f => JSON.stringify(f)).join('\n') + '\n'
}

/**
 * Replace an `action/manifest-appended` record's `argumentsHash` with a token.
 *
 * The digest is taken over the action's RAW arguments, before any cwd scrubbing.
 * When those arguments contain an absolute path -- an attachment object, a spill
 * locator -- two runs hash different strings because the paths genuinely differ.
 * The hash is therefore CORRECT and the expectation is what cannot be portable:
 * scrubbing the visible path while pinning a digest of the unscrubbed one
 * asserts a value no second machine can reproduce.
 *
 * Only the hash is replaced. `capability`, `sideEffectClass`, `requiresApproval`,
 * `sequence` and the event's presence stay pinned, and the digest's own
 * correctness is covered by `dsh-action-manifest`'s unit tests, where the inputs
 * are fixed rather than environmental.
 * @param record - one parsed session-log record, mutated in place.
 */
function scrubHostChosenSandboxMode(record: Record<string, unknown>): void {
  // `sandbox/mode` and `permission/preset` record which mode the runtime chose
  // for THIS host. A Linux CI runner with no usable confinement degrades to
  // `danger-full-access`; a macOS host with a working sandbox picks
  // `workspace-write`. Both are correct decisions about different machines, so
  // an expectation pinning either one is only true where it was recorded.
  //
  // The event and its shape stay pinned — that a mode was decided, logged, and
  // reached the session in this position is still asserted. What is dropped is
  // WHICH mode, and that reading was never a reliable signal here: on a runner
  // without confinement these scenarios could never have caught "the sandbox
  // was available and went unused", because it never was. Keeping a
  // single-environment incidental reading at the price of environment-specific
  // fixtures is paying maintenance for a coincidence.
  //
  // The obligation moves rather than disappears: BLOCKED-112 records that the
  // mode DECISION (capability set in, mode out) needs an explicit test under
  // P3, keyed on capabilities rather than on the host it happens to run on.
  if (record.type !== 'sandbox/mode' && record.type !== 'permission/preset') return
  const data = record.data as Record<string, unknown> | undefined
  if (data === undefined) return
  if (typeof data.mode === 'string') data.mode = SANDBOX_MODE
  if (typeof data.preset === 'string') data.preset = SANDBOX_MODE
}

function scrubVolatileArgumentsHash(record: Record<string, unknown>): void {
  if (record.type !== 'action/manifest-appended') return
  const data = record.data as Record<string, unknown> | undefined
  if (data === undefined) return
  if (typeof data.argumentsHash === 'string') data.argumentsHash = ARGUMENTS_HASH
  // The idempotency key is a digest over the run id, and a replay is a NEW
  // run: the packed and unpacked readings of one recording produced two keys
  // and the equality case caught it. The `actor` beside it is scrubbed for the
  // same reason and shows it plainly -- `anonymous:{{session:1}}` -- while a
  // digest cannot show what it was taken over.
  //
  // Only the value is dropped. That the field is PRESENT and non-empty is
  // still pinned by the P2-03 supplement's own case, and the derivation's two
  // directions -- a replayed attempt keys the same, a new one does not -- are
  // unit-tested in `dsh-action-manifest`, where the inputs are fixed rather
  // than environmental.
  if (typeof data.idempotencyKey === 'string') data.idempotencyKey = IDEMPOTENCY_KEY
}

/**
 * Normalize a session JSONL log into a stable expected output: the header line's
 * volatile fields (`createdAt`, `id`, `cwd`) are zeroed/scrubbed, ordinary
 * event `time`, packed-row `time0`, and goal-change lifecycle clock values are
 * zeroed, and all volatile strings are scrubbed. Projected inputs remain
 * projected. Packed `data.dt` gaps are normalized even when the projected row
 * omits its `time0` anchor.
 * Output is JSONL in the same shape as the input — one compact record per
 * line.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @param ctx The run's volatile values to scrub.
 * @param options Separator output controls; shared canonical paths are the default.
 * @returns The normalized JSONL log, one record per line.
 */
export function normalizeSessionLog(
  rawLog: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  const cwdPathMode = options.cwdPathMode ?? 'canonical'
  const identityMode = options.identityMode ?? 'legacy'
  const lines = rawLog.split('\n').filter(line => line.trim().length > 0)
  const records = lines.map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>
    if (record.type === 'session') {
      if ('createdAt' in record) record.createdAt = 0
    } else if (isPackedFixtureRow(record)) {
      if ('time0' in record) record.time0 = 0
      const data = record.data
      if (data !== null && typeof data === 'object' && Array.isArray((data as { dt?: unknown }).dt)) {
        (data as { dt: unknown[] }).dt = (data as { dt: unknown[] }).dt.map(() => 0)
      }
    } else if ('time' in record) {
      record.time = 0
    }
    scrubVolatileArgumentsHash(record)
    scrubHostChosenSandboxMode(record)
    if (record.type === 'hook/result' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if ('durationMs' in data) data.durationMs = 0
    }
    if (record.type === 'goal/change' && record.data !== null && typeof record.data === 'object') {
      const data = record.data as Record<string, unknown>
      if ('createdAt' in data) data.createdAt = 0
      if ('updatedAt' in data) data.updatedAt = 0
    }
    if (Object.hasOwn(record, 'sourceEventSeqs')) {
      record.sourceEventSeqs = decodeSeqRanges(record.sourceEventSeqs)
    }
    return scrubValue(record, ctx, cwdPathMode, identityMode) as Record<string, unknown>
  })
  return records.map(r => JSON.stringify(r)).join('\n') + '\n'
}

/**
 * Repack projected body records so persistence flush boundaries do not affect
 * committed snapshots. Synthetic envelopes exist only while the storage codec
 * reconstructs and packs the logical event stream; returned rows stay projected.
 */
function repackSessionSnapshot(rawLog: string): string {
  const lines = rawLog.split('\n').filter(line => line.trim().length > 0)
  const header = lines.shift() as string

  let nextSeq = SessionLogOffset(0)
  const events = lines.flatMap((line) => {
    const record = JSON.parse(line) as Record<string, unknown>
    if (isPackedFixtureRow(record)) {
      const decoded = decodeStorageRecord({ ...record, seq0: nextSeq, time0: 0 })
      nextSeq = SessionLogOffset(nextSeq + decoded.length)
      return decoded
    }
    const event = { ...record, seq: SessionSeq(nextSeq), time: 0 } as SessionEvent
    nextSeq = SessionLogOffset(nextSeq + 1)
    return [event]
  })
  const body = packChunkRuns(events).map((stored) => {
    const projected = { ...stored } as Record<string, unknown>
    omitFixtureEnvelope(projected)
    return JSON.stringify(projected)
  })
  return [header, ...body, ''].join('\n')
}

/**
 * Normalize and project persisted session JSONL for a committed fixture.
 * This composes ordinary log normalization with request-header scrubbing and
 * persistence-envelope projection, then packs the logical event stream into a
 * canonical layout independent of persistence flush boundaries.
 *
 * @param rawLog - persisted or already-projected session JSONL.
 * @param ctx - the run's volatile values to scrub.
 * @param options - separator output controls.
 * @returns normalized committed session snapshot JSONL.
 */
export function normalizeSessionSnapshot(
  rawLog: string,
  ctx: NormalizeContext,
  options: NormalizeOptions = {},
): string {
  return repackSessionSnapshot(scrubSessionSnapshot(normalizeSessionLog(rawLog, ctx, options)))
}

/**
 * Normalize one scenario's primary and child logs with shared typed identity redaction.
 * @param rawLogs - primary-first persisted or projected session JSONL.
 * @param ctx - generated cwd spellings and other volatile run facts.
 * @param options - separator controls; relationship-preserving identity mode is mandatory.
 * @returns normalized session fixtures in input order.
 */
export function normalizeSessionSnapshots(
  rawLogs: readonly string[],
  ctx: NormalizeContext,
  options: Omit<NormalizeOptions, 'identityMode'> = {},
): string[] {
  return redactSessionSnapshotIds(rawLogs).map(log => repackSessionSnapshot(
    scrubSessionSnapshot(normalizeSessionLog(
      log,
      { ...ctx, sessionIds: [] },
      { ...options, identityMode: 'preserve' },
    )),
  ))
}

/**
 * Replace system-prompt content in request headers with `{{system}}` tokens
 * while retaining field presence.
 * Other header content stays verbatim, so a header-pinning fixture can keep
 * its complete tool schemas while every JSONL fixture omits the prompt text.
 * Lines without a system payload pass through byte-for-byte; the transform is
 * idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with system-prompt content tokenized.
 */
export function scrubSystemPrompts(rawLog: string): string {
  return scrubHeaderContent(rawLog, { system: true })
}

/**
 * Replace tool schemas in full request-header snapshots with `{{tools}}`
 * tokens while retaining field presence. System prompts and session-prefix
 * messages stay verbatim so pinning fixtures can move only schema bulk into
 * their dedicated JSON sidecar. Lines without a tool payload pass through
 * byte-for-byte; the transform is idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with tool-schema content tokenized.
 */
export function scrubToolSchemas(rawLog: string): string {
  return scrubHeaderContent(rawLog, { tools: true })
}

/**
 * Replace all bulky request-header content in a session JSONL with stable
 * tokens. This includes the system-prompt fields handled by
 * {@link scrubSystemPrompts}, tool schemas, and session-prefix messages. It
 * keeps prefix message counts, field presence, config, and reason. Lines
 * without content to scrub pass through byte-for-byte, and the transform is
 * idempotent.
 *
 * @param rawLog The raw session `.jsonl` content.
 * @returns The JSONL with all header bulk tokenized, other lines byte-identical.
 */
export function scrubRequestHeaders(rawLog: string): string {
  return scrubHeaderContent(rawLog, { system: true, tools: true })
}

/**
 * Zero the wall-clock stamp on every delegation-chain entry.
 *
 * `DelegationEntry.delegatedAt` is a real fact of the chain — when this hop was
 * added — and it is `Date.now()`, so it differs on every run. A recorded
 * session that pins it can never replay, which is the same reason this corpus
 * already zeroes `time`, `createdAt` and `durationMs`.
 *
 * The entry, the order of entries and every principal in them stay pinned. What
 * is dropped is only WHEN, and no case reads it: the chain's claims are about
 * who delegated to whom, which the principals carry.
 * @param record - one parsed session-log record, mutated in place.
 */
function zeroDelegationClock(record: Record<string, unknown>): void {
  const data = record.data as Record<string, unknown> | null | undefined
  if (data === null || data === undefined) return
  const identity = data.identity as { chain?: { entries?: unknown } } | null | undefined
  const entries = identity?.chain?.entries
  if (!Array.isArray(entries)) return
  for (const entry of entries as Record<string, unknown>[]) {
    if (typeof entry.delegatedAt === 'number') entry.delegatedAt = 0
  }
}

/**
 * Project a persisted session log while tokenizing all request-header bulk.
 * Each non-empty line is parsed at most once; the session header stays
 * byte-identical. Body records omit their persistence-only envelopes, and
 * request-header payloads are tokenized.
 *
 * @param rawLog - persisted or already-projected session JSONL.
 * @returns committed snapshot JSONL with request headers tokenized.
 */
export function scrubSessionSnapshot(rawLog: string): string {
  const scrubbed = scrubRequestHeaders(rawLog)
  let recordIndex = 0
  return scrubbed.split('\n').map((line) => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    if (recordIndex++ === 0) {
      if (record.type !== 'session') throw new Error('session snapshot must start with a session header')
      return line
    }
    omitFixtureEnvelope(record)
    zeroDelegationClock(record)
    return JSON.stringify(record)
  }).join('\n')
}

/** Which independent request-header payloads a scrubber replaces. */
interface HeaderScrubOptions {
  system?: boolean
  tools?: boolean
}

/** Transform the selected request-header payloads. */
function scrubHeaderContent(rawLog: string, options: HeaderScrubOptions): string {
  const lines = rawLog.split('\n')
  const out = lines.map((line) => {
    if (line.trim().length === 0) return line
    const record = JSON.parse(line) as Record<string, unknown>
    const data = record.data as Record<string, unknown> | null | undefined
    if (data === null || typeof data !== 'object') return line
    if (record.type === 'request/header') {
      const header = data.header as Record<string, unknown> | null | undefined
      if (header === null || typeof header !== 'object') return line
      let touched = false
      if (options.system === true && 'system' in header) { header.system = SYSTEM; touched = true }
      if (options.tools === true && 'tools' in header) { header.tools = TOOLS; touched = true }
      return touched ? JSON.stringify(record) : line
    }
    return line
  })
  return out.join('\n')
}
