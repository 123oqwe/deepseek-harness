/**
 * P0-06 acceptance[0] as C19 narrowed it: the version-0 session logs that
 * audit baseline b150a551 produced all read, except the ones where a surface
 * event appears before the first step, which the product refuses with a
 * readable reason.
 *
 * The copies under `./p0-06-audit-baseline/b150a551/` are the baseline's blobs
 * byte for byte, enumerated by content (every blob whose first line is a
 * `session` header with `version: 0`), and `manifest.json` lists them. The
 * guard case re-derives what the manifest claims from the copied bytes.
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
/** The reason `session-format-v2-to-v3/src/migration.ts` gives for a surface before the first step. */
const PRE_STEP_REFUSAL = 'format v2 surface before first step cannot acquire a system head without changing chronology'
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
  | { readonly path: string, readonly ok: true, readonly headerId: string, readonly eventCount: number, readonly types: Readonly<Record<string, number>> }
  | { readonly path: string, readonly ok: false, readonly call: 'open' | 'read', readonly errorName: string, readonly errorMessage: string }

/** What a copied log's own bytes say. */
interface FixtureFacts {
  readonly headerType: unknown
  readonly headerVersion: unknown
  readonly rows: number
  readonly events: number
  readonly turnStarts: number
  readonly turnEnds: number
  readonly userMessages: number
  readonly expected: 'read' | 'refused'
}

const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'manifest.json'), 'utf8')) as {
  readonly baseline: string
  readonly files: readonly ManifestFile[]
  readonly sidecars: readonly ManifestSidecar[]
}

/**
 * Read the facts the manifest records for one log from the copied bytes.
 * @param file - the copy's path under the fixture root.
 * @returns the header's type and version, the row and event counts, and whether a surface precedes the first step.
 */
function fixtureFacts(file: string): FixtureFacts {
  const [headerLine = '', ...rowLines] = readFileSync(join(fixtureRoot, file), 'utf8').split('\n').filter(line => line.trim().length > 0)
  const header = JSON.parse(headerLine) as { type?: unknown, version?: unknown }
  let events = 0
  let turnStarts = 0
  let turnEnds = 0
  let userMessages = 0
  let stepSeen = false
  let surfaceBeforeStep = false
  for (const line of rowLines) {
    const row = JSON.parse(line) as { type: string, data?: { texts?: readonly unknown[], args?: readonly unknown[] } }
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
  }
  return {
    headerType: header.type,
    headerVersion: header.version,
    rows: rowLines.length,
    events,
    turnStarts,
    turnEnds,
    userMessages,
    expected: surfaceBeforeStep ? 'refused' : 'read',
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
function copyIdentity(file: string): { bytes: number, sha256: string, gitBlob: string } {
  const bytes = readFileSync(join(fixtureRoot, file))
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    gitBlob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
  }
}

const facts = new Map(manifest.files.map(entry => [entry.path, fixtureFacts(entry.file)]))
const entries = new Map(manifest.files.map(entry => [entry.path, entry]))
const readPaths = manifest.files.filter(entry => entry.expected === 'read').map(entry => entry.path)
const refusedPaths = manifest.files.filter(entry => entry.expected === 'refused').map(entry => entry.path)

describe('P0-06 acceptance[0]: version-0 session logs of audit baseline b150a551', () => {
  describe('the committed copies', () => {
    it('are every version-0 session log of b150a551, byte for byte, split by whether a surface event precedes the first step', () => {
      expect(manifest.baseline).toBe(BASELINE)
      expect(manifest.files).toHaveLength(157)
      expect(new Set(manifest.files.map(entry => entry.path)).size).toBe(157)
      expect(readPaths).toHaveLength(133)
      expect(refusedPaths).toHaveLength(24)
      expect(new Set(manifest.files.map(entry => entry.sessionId)).size).toBe(157)

      // The directory holds exactly the listed copies: nothing unlisted, nothing missing.
      expect(filesUnder(join(fixtureRoot, 'b150a551')))
        .toEqual([...manifest.files.map(entry => entry.file), ...manifest.sidecars.map(sidecar => sidecar.file)].sort())
      expect(manifest.files.filter(entry => entry.file !== `b150a551/${entry.path}${STORED_SUFFIX.get(entry.path) ?? ''}`).map(entry => entry.path)).toEqual([])
      expect(manifest.sidecars.filter(sidecar => sidecar.file !== `b150a551/${sidecar.path}`).map(sidecar => sidecar.path)).toEqual([])

      // Every copy is the recorded baseline blob.
      expect([...manifest.files, ...manifest.sidecars]
        .filter(entry => JSON.stringify(copyIdentity(entry.file)) !== JSON.stringify({ bytes: entry.bytes, sha256: entry.sha256, gitBlob: entry.gitBlob }))
        .map(entry => entry.path)).toEqual([])

      // What the manifest says about each log is what its bytes say.
      expect(manifest.files.filter((entry) => {
        const fact = facts.get(entry.path)
        return fact === undefined || fact.headerType !== 'session' || fact.headerVersion !== 0
          || fact.rows !== entry.rows || fact.events !== entry.events || fact.turnStarts !== entry.turnStarts
          || fact.turnEnds !== entry.turnEnds || fact.userMessages !== entry.userMessages || fact.expected !== entry.expected
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

    it.each(readPaths)('reads %s with its assigned header id, every turn start and turn end, and every user message', (path) => {
      const entry = entries.get(path)
      const fact = facts.get(path)
      const result = replay.get(path)
      if (entry === undefined || fact === undefined || result === undefined || !result.ok) {
        expect({ entry, fact, result }).toMatchObject({ entry: { path }, fact: { expected: 'read' }, result: { ok: true } })
        return
      }
      expect(result.headerId).toBe(entry.sessionId)
      expect(result.types['turn/start'] ?? 0).toBe(fact.turnStarts)
      expect(result.types['turn/end'] ?? 0).toBe(fact.turnEnds)
      expect(result.types['user/message'] ?? 0).toBeGreaterThanOrEqual(fact.userMessages)
      // A header-only log reads zero events; any other log reads some.
      expect(result.eventCount === 0).toBe(fact.events === 0)
    })

    it.each(refusedPaths)('refuses %s as SessionFormatUnsupportedError naming a surface before the first step', (path) => {
      expect(facts.get(path)?.expected).toBe('refused')
      expect(replay.get(path)).toMatchObject({
        ok: false,
        errorName: 'SessionFormatUnsupportedError',
        errorMessage: expect.stringContaining(PRE_STEP_REFUSAL) as unknown,
      })
    })
  })
})
