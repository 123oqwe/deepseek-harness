/**
 * The version-0 session logs of audit baseline b150a551 replayed through the
 * shipped `headless` session persistence, for P0-06 acceptance[0].
 *
 * Run by `runLoaderSmoke` with `[overlayPath]` after the bin. It boots the
 * shipped `headless` profile through `bootProductionProfile` over the given
 * test overlay. For every log `./p0-06-audit-baseline/manifest.json` lists,
 * it rebuilds on-disk bytes from the committed copy, writes them as the
 * generation-0 file that the booted `session-persistence-jsonl` service reads
 * for that session id, and opens and reads the session through that service.
 * It writes `replay.json` in its working directory: per log, the header id and
 * the count of each event type the read returned, or the error name and
 * message and the call (`open` or `read`) that threw.
 *
 * A committed copy is a scrubbed comparison artifact, not an on-disk log. The
 * rebuild follows `reconstructReleasedV2Log` in
 * `packages/session/session-persistence-jsonl/tests/jsonl.spec.ts` and the
 * header normalization in `scripts/session-fixture-layout.ts`:
 * - the header id becomes the manifest's `sessionId`, and every row that names
 *   the committed header id names the new id;
 * - `{{cwd}}` becomes `/dsh-snapshot-cwd` in the header and in every row;
 * - a header without `delegationDepth` gets `0`, the default the baseline's
 *   own header writer applied;
 * - rows get dense sequence numbers (a packed chunk row gets `seq0` and one
 *   number per member) and non-decreasing times counted from the header's
 *   `createdAt` (a packed row's members keep their recorded gaps);
 * - a `request/header` whose `tools` is `{{tools}}` gets the `initial` schemas
 *   of the manifest's `toolsSource` sidecar, or `[]` when it names none.
 * Other tokens (`{{system}}`, `{{rpcId}}`, `{{messagePrefix}}`,
 * `{{messageId}}`, `{{parent}}`, `{{child-N}}`, `{{workflow-run}}`) keep their
 * committed strings, and every other payload byte is the committed one.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath } from '../../../packages/session/session-persistence-jsonl/src/format.ts'
import { bootProductionProfile } from '../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const [overlayPath] = process.argv.slice(2)
if (overlayPath === undefined) throw new Error('the baseline replay driver takes an overlay path')

const fixtureRoot = fileURLToPath(new URL('./p0-06-audit-baseline/', import.meta.url))

/** The cwd `scripts/session-fixture-layout.ts` substitutes for `{{cwd}}`. */
const SNAPSHOT_CWD = '/dsh-snapshot-cwd'
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/** One manifest entry, as far as the driver reads it. */
interface ManifestFile {
  readonly path: string
  readonly file: string
  readonly sessionId: string
  readonly toolsSource: string
}

/** What one replay observed. */
type ReplayResult =
  | { readonly path: string, readonly ok: true, readonly headerId: string, readonly eventCount: number, readonly types: Record<string, number> }
  | { readonly path: string, readonly ok: false, readonly call: 'open' | 'read', readonly errorName: string, readonly errorMessage: string }

/** A committed row after JSON parsing; only the members the rebuild touches are typed. */
interface Row {
  readonly type: string
  readonly data?: {
    readonly header?: { tools?: unknown }
    readonly texts?: readonly unknown[]
    readonly args?: readonly unknown[]
    readonly dt?: readonly number[]
  }
}

/**
 * Rebuild on-disk version-0 bytes from one committed copy.
 * @param fixture - the committed copy's text.
 * @param toolSchemas - the sidecar's `initial` schemas, or `undefined` when the manifest names none.
 * @param id - the session id the rebuilt header carries.
 * @returns the rebuilt log bytes and the header's cwd.
 */
function rebuild(fixture: string, toolSchemas: readonly unknown[] | undefined, id: string): { bytes: Buffer, cwd: string | undefined } {
  const lines = fixture.split('\n').filter(line => line.trim().length > 0)
  const headerLine = lines.shift()
  if (headerLine === undefined) throw new Error('fixture has no header line')
  const parsed = JSON.parse(headerLine) as Record<string, unknown>
  const fixtureId = String(parsed['id'])
  const cwd = typeof parsed['cwd'] === 'string' ? parsed['cwd'].replaceAll('{{cwd}}', SNAPSHOT_CWD) : undefined
  const header = {
    ...parsed,
    id,
    ...(cwd === undefined ? {} : { cwd }),
    delegationDepth: parsed['delegationDepth'] ?? 0,
  }
  let seq = 0
  let time = typeof parsed['createdAt'] === 'number' ? parsed['createdAt'] : 0
  let restoredTools = 0
  const rows = lines.map((line) => {
    const row = JSON.parse(line.replaceAll(fixtureId, id).replaceAll('{{cwd}}', SNAPSHOT_CWD)) as Row
    if (row.type === 'request/header' && row.data?.header?.tools === '{{tools}}') {
      if (toolSchemas !== undefined && ++restoredTools > 1) throw new Error('a sidecar restores one pinned tool-schema set')
      row.data.header.tools = toolSchemas ?? []
    }
    if (PACKED_ROW_TYPES.has(row.type)) {
      const members = (row.type === 'tool-call-chunks' ? row.data?.args : row.data?.texts)?.length ?? 0
      const record = { ...row, seq0: seq, time0: time }
      seq += members
      time += (row.data?.dt ?? []).reduce((sum, gap) => sum + gap, 0) + 1
      return JSON.stringify(record)
    }
    const record = { ...row, seq, time }
    seq += 1
    time += 1
    return JSON.stringify(record)
  })
  return { bytes: Buffer.from([JSON.stringify(header), ...rows].map(line => `${line}\n`).join('')), cwd }
}

/**
 * Describe a thrown value for the result file.
 * @param error - the thrown value.
 * @returns its name and message.
 */
function describeError(error: unknown): { errorName: string, errorMessage: string } {
  return error instanceof Error
    ? { errorName: error.name, errorMessage: error.message }
    : { errorName: typeof error, errorMessage: String(error) }
}

const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8')) as {
  readonly baseline: string
  readonly files: readonly ManifestFile[]
}

const ctx = await bootProductionProfile({
  binName: 'p0-06-baseline-replay',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlayPath, undefined)],
})
try {
  // The booted service's own configuration names where it reads; it resolved
  // `root` against this process's cwd, which has not changed since.
  const { root, compression } = (ctx.sessionPersistence as JsonlSessionPersistence).config
  if (compression !== 'none') throw new Error(`the overlay must select uncompressed JSONL, got ${String(compression)}`)
  const sessionsRoot = resolve(root)

  for (const entry of manifest.files) {
    const fixture = await readFile(join(fixtureRoot, entry.file), 'utf8')
    const toolSchemas = entry.toolsSource === 'none'
      ? undefined
      : (JSON.parse(await readFile(join(fixtureRoot, entry.toolsSource), 'utf8')) as { initial: readonly unknown[] }).initial
    const { bytes, cwd } = rebuild(fixture, toolSchemas, entry.sessionId)
    const target = generationLogPath(sessionsRoot, cwd, SessionId(entry.sessionId), 0, 'none')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx' })
  }

  const results: ReplayResult[] = []
  for (const entry of manifest.files) {
    let handle: SessionHandle
    try {
      handle = await ctx.sessionPersistence.open(SessionId(entry.sessionId), 'read')
    } catch (error: unknown) {
      results.push({ path: entry.path, ok: false, call: 'open', ...describeError(error) })
      continue
    }
    try {
      const { events } = await handle.read()
      const types: Record<string, number> = {}
      for (const event of events) types[event.type] = (types[event.type] ?? 0) + 1
      results.push({ path: entry.path, ok: true, headerId: handle.header.id, eventCount: events.length, types })
    } catch (error: unknown) {
      results.push({ path: entry.path, ok: false, call: 'read', ...describeError(error) })
    } finally {
      await handle.close()
    }
  }
  await writeFile('replay.json', `${JSON.stringify({ baseline: manifest.baseline, sessionsRoot, results }, null, 2)}\n`, 'utf8')
} finally {
  await ctx.fiber.dispose()
}
