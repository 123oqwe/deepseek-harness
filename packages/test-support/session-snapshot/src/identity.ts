/** Relationship-preserving identity redaction for committed session snapshots. */

const UUID_FRAGMENT_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/**
 * A value that is ENTIRELY one opaque id, rather than one containing an id.
 *
 * The distinction keeps this redaction idempotent, which it has to be: a
 * fixture is redacted when it is written and redacted again when it is
 * compared, and a rule that swallows a whole COMPOSITE value on the first pass
 * cannot reproduce itself on the second. `anonymous-run:<uuid>` becomes
 * `{{run:1}}` under a substring test and `anonymous-run:{{session:1}}` under a
 * whole-value one — the first spelling is unreachable from an already-redacted
 * fixture, so refresh and verify disagree forever. Composite values are left
 * for the value-wise replacement below, which rewrites the id inside them.
 */
const WHOLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A run id minted per created agent: `run-` and a whole uuid, nothing else. */
const MINTED_RUN_ID_RE = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * A value that is a PREFIX and a whole id, joined by a colon: `agent:<uuid>`,
 * `anonymous:<uuid>`. The tail is an id this log already tokenizes at the site
 * that owns it — a session header, an agent principal — so claiming the
 * composite whole would give one value two tokens depending on which site the
 * walk reached first. Tokenize the tail, keep the prefix, and the two
 * normalization paths agree.
 */
const PREFIXED_ID_RE = /^[a-z][a-z0-9-]*:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEGACY_TOKEN_RE = /^\{\{(?:sessionId|messageId)\}\}$/
const CANONICAL_TOKEN_RE = /^\{\{(session|message|approval|run|command|rpc|retry|id):([1-9]\d*)\}\}$/
const ID_KEY_RE = /(?:^id$|Id$|Ids$)/

type IdentityKind = 'session' | 'message' | 'approval' | 'run' | 'command' | 'rpc' | 'retry' | 'id'

interface ParsedLog {
  readonly records: Record<string, unknown>[]
  readonly trailingNewline: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseLog(log: string): ParsedLog {
  return {
    records: log.split(/\r?\n/)
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line) as Record<string, unknown>),
    trailingNewline: log.endsWith('\n'),
  }
}

function messageId(value: unknown): string | undefined {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.role !== 'string'
    || !Array.isArray(value.content)
    || !isRecord(value.source)) return undefined
  return value.id
}

function redactedCandidate(value: string): boolean {
  return UUID_FRAGMENT_RE.test(value) || LEGACY_TOKEN_RE.test(value) || CANONICAL_TOKEN_RE.test(value)
}

/**
 * Replace volatile opaque ids while preserving equality relationships across a parent and its child logs.
 * @param logs - one scenario's primary-first session JSONL fixtures.
 * @returns compact JSONL with typed first-seen identity tokens.
 */
export function redactSessionSnapshotIds(logs: readonly string[]): string[] {
  const parsed = logs.map(parseLog)
  const tokenByValue = new Map<string, string>()
  const nextByKind = new Map<IdentityKind, number>()

  const claim = (value: unknown, kind: IdentityKind, always = false): void => {
    if (typeof value !== 'string' || value.length === 0 || tokenByValue.has(value)) return
    if (!always && !redactedCandidate(value)) return
    const canonical = CANONICAL_TOKEN_RE.exec(value)
    if (canonical !== null) {
      const canonicalKind = canonical[1] as IdentityKind
      const ordinal = Number(canonical[2])
      nextByKind.set(canonicalKind, Math.max(nextByKind.get(canonicalKind) ?? 0, ordinal))
      tokenByValue.set(value, value)
      return
    }
    const next = (nextByKind.get(kind) ?? 0) + 1
    nextByKind.set(kind, next)
    tokenByValue.set(value, `{{${kind}:${next}}}`)
  }

  for (const log of parsed) {
    const header = log.records[0]
    if (header?.type === 'session') claim(header.id, 'session', true)
  }

  const collect = (value: unknown, recordType?: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bas message ([0-9a-f-]{36})\b/gi)) claim(match[1], 'message')
      for (const match of value.matchAll(/\bAnonymous user: ([0-9a-f-]{36})\b/gi)) claim(match[1], 'id')
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, recordType)
      return
    }
    if (!isRecord(value)) return

    const identifiedMessage = messageId(value)
    if (identifiedMessage !== undefined) claim(identifiedMessage, 'message')
    for (const [childKey, item] of Object.entries(value)) {
      if (recordType === 'approval/asked' || recordType === 'approval/decided') {
        if (childKey === 'id') claim(item, 'approval')
      } else if (childKey === 'commandId') {
        claim(item, 'command', true)
      } else if (childKey === 'rpcId') {
        claim(item, 'rpc', true)
      } else if (childKey === 'retryId') {
        claim(item, 'retry')
      } else if (childKey === 'runId') {
        // Whole ids only, for the idempotence reason on WHOLE_UUID_RE: a
        // workflow run id IS one, while a manifest's anonymous fallback is a
        // composite whose session id is already tokenized on its own.
        // `run`, not `workflow`. The label was accurate while the only `runId`
        // in a log was a workflow run's; a manifest's `runId` is the identity's
        // execution run, and a token reading `{{workflow:1}}` there tells the
        // next reader of the fixture that a workflow ran when none did.
        //
        // A run a local launcher mints is `run-<uuid>`, not a bare uuid, so
        // the whole-id test alone left it raw in every log that attaches a host
        // identity — which is every log a local launcher writes (P2-01's U2
        // stage). It is claimed with the SAME `run` kind: one execution run,
        // one spelling, whoever minted it. The prefix is required rather than
        // stripped, because a composite whose tail merely looks like a uuid is
        // the case WHOLE_UUID_RE exists to refuse.
        if (typeof item === 'string' && (WHOLE_UUID_RE.test(item) || MINTED_RUN_ID_RE.test(item))) claim(item, 'run')
      } else if (ID_KEY_RE.test(childKey)) {
        // A composite is NOT claimed whole. `agent:<sessionId>` names a
        // delegated child's principal, and the session id in its tail is
        // claimed by the session header on its own; claiming the composite
        // too produced `{{id:N}}` on a raw log and `agent:{{session:N}}` on
        // one whose tail was already tokenized, so a refresh and a replay of
        // the SAME run disagreed and every multi-session scenario went red.
        // The `runId` branch above states the same rule for the same reason.
        if (typeof item !== 'string' || !PREFIXED_ID_RE.test(item)) claim(item, 'id')
      }
      collect(item, recordType)
    }
  }
  for (const log of parsed) {
    for (const record of log.records) collect(record, record.type)
  }

  const replacements = [...tokenByValue]
    .sort(([left], [right]) => right.length - left.length)
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const exact = tokenByValue.get(value)
      if (exact !== undefined) return exact
      let output = value
      for (const [source, token] of replacements) output = output.split(source).join(token)
      return output
    }
    if (Array.isArray(value)) return value.map(replace)
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
    }
    return value
  }

  return parsed.map((log) => {
    const content = log.records.map(record => JSON.stringify(replace(record))).join('\n')
    return log.trailingNewline ? `${content}\n` : content
  })
}
