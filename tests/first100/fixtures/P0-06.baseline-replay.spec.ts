/**
 * P0-06 acceptance[0] as the user ruled (WORKING-MODEL §12 ⑩): every version-0
 * session log that audit baseline b150a551 produced reads, and reads
 * correctly, except three classes that the product refuses explicitly with a
 * readable reason:
 * 1. a surface event before the first step (24 logs);
 * 2. assistant chunks outside any turn, a replay fragment (3 logs);
 * 3. a projection written by a baseline fixture (4 logs): a compact checkpoint
 *    without its compaction/start, or request/header tools recorded as names.
 * The 24 read logs whose subagent descriptor has version 2 fail until the
 * version-0 edge accepts that descriptor version. Two class-3 logs
 * (`scripts/snapshots/python-sdk-single-exe/advanced/session.{1,2}.jsonl`)
 * carry such a descriptor too; the replay refuses them for it before it reaches
 * their tools, so their cases fail on the reason until that fix lands.
 *
 * The copies under `./p0-06-audit-baseline/b150a551/` are the baseline's blobs
 * byte for byte, enumerated by content (every blob whose first line is a
 * `session` header with `version: 0`), and `manifest.json` lists them. Each
 * log's class is derived here from its own bytes; the guard case checks the
 * derivation against the manifest and pins the class sizes.
 *
 * `beforeAll` runs `./P0-06.baseline-replay-driver.ts` once in a child process
 * through `runLoaderSmoke`, which isolates `DSH_HOME`. The driver boots the
 * shipped `headless` profile over an existing test overlay, writes every log
 * where the booted JSONL persistence service reads a generation-0 log, reads
 * each through that service, and records what came back. The cases only read
 * that record; every expected value comes from the copied bytes or the
 * manifest, never from the driver.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const fixtureRoot = fileURLToPath(new URL('./p0-06-audit-baseline/', import.meta.url))
const driver = fileURLToPath(new URL('./P0-06.baseline-replay-driver.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const overlay = fileURLToPath(new URL('../../../packages/workspace/workspace-trust-local/tests/fixtures/headless-trust.patch.yml', import.meta.url))

const BASELINE = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
/**
 * Copies stored under another name than their baseline path. This one's bytes
 * fail the strict released-v0 row decode that `scripts/session-fixture-layout.spec.ts`
 * applies to every tracked `*.jsonl` starting with a session header.
 */
const STORED_SUFFIX: ReadonlyMap<string, string> = new Map([['apps/web/tests/snapshots/cordis-tool-round/session.jsonl', '.txt']])
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])
const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])
const DRIVER_PROCESS_TIMEOUT_MS = 150_000
const REPLAY_HOOK_TIMEOUT_MS = 180_000

/** How a log is expected to fare: read, or refused for one of four reasons in three classes. */
type LogKind = 'read' | 'surface-before-first-step' | 'chunk-only-fragment' | 'compact-checkpoint-without-start' | 'tool-names'
type RefusedKind = Exclude<LogKind, 'read'>

/**
 * The product's refusal text for each refused kind. The persistence reports
 * every one as `SessionFormatUnsupportedError`, whose message starts with the
 * format edge's refusal (`session-persistence-jsonl/src/index.ts:674-677`).
 */
const REFUSAL_TEXT: Readonly<Record<RefusedKind, string>> = {
  // session-format-v2-to-v3/src/migration.ts:57
  'surface-before-first-step': 'format v2 surface before first step cannot acquire a system head without changing chronology',
  // session-format-v0-to-v1/src/relationships.ts:371, reached through :74-75 for the step event that
  // session-format-v1-to-v2/src/validation.ts:24 registers; prefixed at session-format/src/catalog.ts:246
  'chunk-only-fragment': 'assistant/attempt does not match an open turn and step',
  // session-format-v0-to-v1/src/relationships.ts:474 with the label from :317; prefixed at session-format/src/catalog.ts:246
  'compact-checkpoint-without-start': 'has no matching compaction/start',
  // session-format-v0-to-v1/src/validation-helpers.ts:11 through payload-validation.ts:821 and :825;
  // prefixed at session-format/src/chain.ts:252
  'tool-names': 'header tools[0] must be a JSON object',
}

/** Title text naming each class-3 reason. */
const PROJECTION_LABEL: Readonly<Record<'compact-checkpoint-without-start' | 'tool-names', string>> = {
  'compact-checkpoint-without-start': 'a compact checkpoint without compaction/start',
  'tool-names': 'request/header tools recorded as names',
}

/** One copied log as the manifest lists it. */
interface ManifestFile {
  readonly path: string
  readonly file: string
  readonly gitBlob: string
  readonly sha256: string
  readonly bytes: number
  readonly rows: number
  readonly events: number
  readonly turnStarts: number
  readonly turnEnds: number
  readonly userMessages: number
  readonly expected: 'read' | 'refused'
  readonly kind: LogKind
  readonly sessionId: string
  readonly toolsSource: string
}

/** One copied tool-schema sidecar as the manifest lists it. */
interface ManifestSidecar {
  readonly path: string
  readonly file: string
  readonly gitBlob: string
  readonly sha256: string
  readonly bytes: number
}

/** What the driver recorded for one log. */
type ReplayResult =
  | {
    readonly path: string
    readonly ok: true
    readonly headerId: string
    readonly eventCount: number
    readonly types: Readonly<Record<string, number>>
  }
  | { readonly path: string; readonly ok: false; readonly call: 'open' | 'read'; readonly errorName: string; readonly errorMessage: string }

/** A committed row, as far as the classification reads it. */
interface FixtureRow {
  readonly type: string
  readonly surfaceOp?: unknown
  readonly data?: {
    readonly texts?: readonly unknown[]
    readonly args?: readonly unknown[]
    readonly version?: unknown
    readonly compactionId?: unknown
    readonly source?: { readonly kind?: unknown; readonly plugin?: unknown; readonly compactionId?: unknown }
    readonly header?: { readonly tools?: unknown }
  }
}

/** What a copied log's own bytes say. */
interface FixtureFacts {
  readonly headerType: unknown
  readonly headerVersion: unknown
  readonly rows: number
  readonly events: number
  readonly turnStarts: number
  readonly turnEnds: number
  readonly userMessages: number
  readonly descriptorVersion2: boolean
  readonly kind: LogKind
}

const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8')) as {
  readonly baseline: string
  readonly files: readonly ManifestFile[]
  readonly sidecars: readonly ManifestSidecar[]
}

/**
 * Whether a JSON value is an object that is neither null nor an array.
 * @param value - the value to test.
 * @returns true for a JSON object.
 */
function isJsonObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read one log's facts from its copied bytes, including its class. The first
 * rule that matches decides the class:
 * - a surface row before the first `step/start`: refused, class 1;
 * - rows that are all assistant chunks (plain or packed): refused, class 2;
 * - a replacing `compact` checkpoint with no earlier `compaction/start` of its id: refused, class 3;
 * - a `request/header` whose tools hold a member that is not an object: refused, class 3;
 * - anything else: read.
 * @param file - the copy's path under the fixture root.
 * @returns the header's type and version, the row and event counts, and the class.
 */
function fixtureFacts(file: string): FixtureFacts {
  const [headerLine = '', ...rowLines] = readFileSync(join(fixtureRoot, file), 'utf8').split('\n').filter(line => line.trim().length > 0)
  const header = JSON.parse(headerLine) as { type?: unknown; version?: unknown }
  const rows = rowLines.map(line => JSON.parse(line) as FixtureRow)
  const compactionStarts = new Set<unknown>()
  let events = 0
  let turnStarts = 0
  let turnEnds = 0
  let userMessages = 0
  let stepSeen = false
  let surfaceBeforeStep = false
  let descriptorVersion2 = false
  let checkpointWithoutStart = false
  let toolNames = false
  for (const row of rows) {
    if (PACKED_ROW_TYPES.has(row.type)) {
      events += (row.type === 'tool-call-chunks' ? row.data?.args : row.data?.texts)?.length ?? 0
      continue
    }
    events += 1
    if (row.type === 'turn/start') turnStarts += 1
    if (row.type === 'turn/end') turnEnds += 1
    if (row.type === 'user/message') userMessages += 1
    if (row.type === 'step/start') stepSeen = true
    if (SURFACE_TYPES.has(row.type) && !stepSeen) surfaceBeforeStep = true
    if (row.type === 'subagent/descriptor' && row.data?.version !== 3) descriptorVersion2 = true
    if (row.type === 'compaction/start') compactionStarts.add(row.data?.compactionId)
    const source = row.data?.source
    if (row.type === 'user/message' && row.surfaceOp !== 'append' && source?.kind === 'plugin' && source.plugin === 'compact'
      && !compactionStarts.has(source.compactionId)) checkpointWithoutStart = true
    const tools = row.data?.header?.tools
    if (row.type === 'request/header' && Array.isArray(tools) && tools.some(tool => !isJsonObject(tool))) toolNames = true
  }
  const chunkOnly = rows.length > 0 && rows.every(row => row.type === 'assistant/chunk' || PACKED_ROW_TYPES.has(row.type))
  const kind: LogKind = surfaceBeforeStep ? 'surface-before-first-step'
    : chunkOnly ? 'chunk-only-fragment'
      : checkpointWithoutStart ? 'compact-checkpoint-without-start'
        : toolNames ? 'tool-names' : 'read'
  return {
    headerType: header.type,
    headerVersion: header.version,
    rows: rows.length,
    events,
    turnStarts,
    turnEnds,
    userMessages,
    descriptorVersion2,
    kind,
  }
}

/**
 * Every file under a directory, relative to the fixture root with `/` separators.
 * @param directory - the directory to walk.
 * @returns the sorted relative file paths.
 */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map(entry => join(directory, entry))
    .filter(path => statSync(path).isFile())
    .map(path => relative(fixtureRoot, path).split(sep).join('/'))
    .sort()
}

/**
 * Hash one copy the way the manifest records it.
 * @param file - the copy's path under the fixture root.
 * @returns its byte length, sha256, and git blob id.
 */
function copyIdentity(file: string): { bytes: number; sha256: string; gitBlob: string } {
  const bytes = readFileSync(join(fixtureRoot, file))
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    gitBlob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
  }
}

const facts = new Map(manifest.files.map(entry => [entry.path, fixtureFacts(entry.file)]))
const entries = new Map(manifest.files.map(entry => [entry.path, entry]))
/**
 * The logs of one derived kind, in manifest order.
 * @param kind - the kind to select.
 * @returns their baseline paths.
 */
function pathsOfKind(kind: LogKind): string[] {
  return manifest.files.filter(entry => facts.get(entry.path)?.kind === kind).map(entry => entry.path)
}
const readPaths = pathsOfKind('read')
const preStepPaths = pathsOfKind('surface-before-first-step')
const chunkOnlyPaths = pathsOfKind('chunk-only-fragment')
const projectionRows: Array<[string, string]> = [
  ...pathsOfKind('compact-checkpoint-without-start').map((path): [string, string] => [path, PROJECTION_LABEL['compact-checkpoint-without-start']]),
  ...pathsOfKind('tool-names').map((path): [string, string] => [path, PROJECTION_LABEL['tool-names']]),
]

describe('P0-06 acceptance[0]: version-0 session logs of audit baseline b150a551', () => {
  describe('the committed copies', () => {
    it('are every version-0 session log of b150a551, byte for byte, each classed by its content as read or as one of three refused classes', () => {
      expect(manifest.baseline).toBe(BASELINE)
      expect(manifest.files).toHaveLength(157)
      expect(new Set(manifest.files.map(entry => entry.path)).size).toBe(157)
      expect(new Set(manifest.files.map(entry => entry.sessionId)).size).toBe(157)

      // The class sizes the ruling names: 126 read (24 of them descriptor version 2) and 31 refused as 24, 3 and 4.
      expect({
        read: readPaths.length,
        readDescriptorVersion2: readPaths.filter(path => facts.get(path)?.descriptorVersion2 === true).length,
        surfaceBeforeFirstStep: preStepPaths.length,
        chunkOnlyFragment: chunkOnlyPaths.length,
        fixtureProjection: projectionRows.length,
      }).toEqual({ read: 126, readDescriptorVersion2: 24, surfaceBeforeFirstStep: 24, chunkOnlyFragment: 3, fixtureProjection: 4 })

      // The directory holds exactly the listed copies: nothing unlisted, nothing missing.
      expect(filesUnder(join(fixtureRoot, 'b150a551')))
        .toEqual([...manifest.files.map(entry => entry.file), ...manifest.sidecars.map(sidecar => sidecar.file)].sort())
      expect(manifest.files.filter(entry => entry.file !== `b150a551/${entry.path}${STORED_SUFFIX.get(entry.path) ?? ''}`)
        .map(entry => entry.path)).toEqual([])
      expect(manifest.sidecars.filter(sidecar => sidecar.file !== `b150a551/${sidecar.path}`).map(sidecar => sidecar.path)).toEqual([])

      // Every copy is the recorded baseline blob.
      expect([...manifest.files, ...manifest.sidecars]
        .filter(entry => JSON.stringify(copyIdentity(entry.file))
          !== JSON.stringify({ bytes: entry.bytes, sha256: entry.sha256, gitBlob: entry.gitBlob }))
        .map(entry => entry.path)).toEqual([])

      // What the manifest says about each log is what its bytes say.
      expect(manifest.files.filter((entry) => {
        const fact = facts.get(entry.path)
        return fact === undefined || fact.headerType !== 'session' || fact.headerVersion !== 0
          || fact.rows !== entry.rows || fact.events !== entry.events || fact.turnStarts !== entry.turnStarts
          || fact.turnEnds !== entry.turnEnds || fact.userMessages !== entry.userMessages || fact.kind !== entry.kind
          || entry.expected !== (fact.kind === 'read' ? 'read' : 'refused')
      }).map(entry => entry.path)).toEqual([])

      const sidecarFiles = new Set(manifest.sidecars.map(sidecar => sidecar.file))
      expect(manifest.files.filter(entry => entry.toolsSource !== 'none' && !sidecarFiles.has(entry.toolsSource)).map(entry => entry.path)).toEqual([])
    })
  })

  describe('replayed through the shipped headless session persistence', () => {
    let replay: ReadonlyMap<string, ReplayResult> = new Map()

    beforeAll(async () => {
      let raw = ''
      await runLoaderSmoke({
        label: 'P0-06 audit-baseline replay (headless)',
        tempDirPrefix: 'p0-06-baseline-replay-',
        binScript: driver,
        libBinScript: driver,
        configPath: overlay,
        binArgs: [overlay],
        tsconfigPath: repoTsconfig,
        processTimeoutMs: DRIVER_PROCESS_TIMEOUT_MS,
        inspect: async (cwd) => {
          raw = await readFile(join(cwd, 'replay.json'), 'utf8')
        },
      })
      const recorded = JSON.parse(raw) as { readonly results: readonly ReplayResult[] }
      replay = new Map(recorded.results.map(result => [result.path, result]))
    }, REPLAY_HOOK_TIMEOUT_MS)

    /**
     * Assert that the product refused one log with the reason of its derived kind.
     * @param path - the log's baseline path.
     * @param kind - the refused kind its bytes were classed as.
     */
    function expectRefused(path: string, kind: RefusedKind): void {
      expect(facts.get(path)?.kind).toBe(kind)
      expect(replay.get(path)).toMatchObject({
        ok: false,
        errorName: 'SessionFormatUnsupportedError',
        errorMessage: expect.stringContaining(REFUSAL_TEXT[kind]) as unknown,
      })
    }

    it.each(readPaths)('reads %s with its assigned header id, every turn start and turn end, and every user message', (path) => {
      const entry = entries.get(path)
      const fact = facts.get(path)
      const result = replay.get(path)
      if (entry === undefined || fact === undefined || result === undefined || !result.ok) {
        expect({ entry, fact, result }).toMatchObject({ entry: { path }, fact: { kind: 'read' }, result: { ok: true } })
        return
      }
      expect(result.headerId).toBe(entry.sessionId)
      expect(result.types['turn/start'] ?? 0).toBe(fact.turnStarts)
      expect(result.types['turn/end'] ?? 0).toBe(fact.turnEnds)
      expect(result.types['user/message'] ?? 0).toBeGreaterThanOrEqual(fact.userMessages)
      // A header-only log reads zero events; any other log reads some.
      expect(result.eventCount === 0).toBe(fact.events === 0)
    })

    it.each(preStepPaths)('refuses %s as SessionFormatUnsupportedError: a surface event before the first step', (path) => {
      expectRefused(path, 'surface-before-first-step')
    })

    it.each(chunkOnlyPaths)('refuses %s as SessionFormatUnsupportedError: assistant chunks outside any turn', (path) => {
      expectRefused(path, 'chunk-only-fragment')
    })

    it.each(projectionRows)('refuses %s as SessionFormatUnsupportedError: a baseline fixture projection, %s', (path) => {
      const kind = facts.get(path)?.kind
      expect(kind === 'compact-checkpoint-without-start' || kind === 'tool-names').toBe(true)
      expectRefused(path, kind === 'tool-names' ? 'tool-names' : 'compact-checkpoint-without-start')
    })
  })
})
