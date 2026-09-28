/**
 * The shipped product under the Harness capability benchmark (Epic P0-08).
 *
 * One trial replays one recorded headless session: `dsh --profile headless`
 * from source, with the recorded-session snapshots' patch layers (the
 * `dsh-llm-replay` provider answers from the recording), in a fresh working
 * directory and `$DSH_HOME`, with no model API configured. The session logs the
 * run persisted are harvested before the directory is removed. This is the
 * launch `snapshots/session/headless.snapshot.ts` makes, without its
 * assertions.
 * @module benchmarks/harness-capability/product
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import type { PriceTable } from './manifest.ts'
import { materializeProfilePatch } from '@deepseek-ai/dsh-session-snapshot/src/launcher.ts'
import { normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot/src/normalize.ts'
import { latestPersistedSessionPaths } from '@deepseek-ai/dsh-session-snapshot/src/session-files.ts'

/** The repository root; this module sits in `benchmarks/harness-capability/`. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** One parsed session-log record, as far as the benchmark reads it. */
export interface LogRecord {
  readonly type?: unknown
  readonly data?: unknown
  readonly [field: string]: unknown
}

/**
 * The records of one session log.
 * @param log - JSONL text.
 * @returns one record per non-empty line.
 */
export function records(log: string): LogRecord[] {
  return log.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as LogRecord)
}

/**
 * The sha256 of a text.
 * @param text - the text.
 * @returns its lowercase hex digest.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * A value's JSON with every object's keys sorted, so two records that differ
 * only in key order compare equal.
 * @param value - a parsed JSON value.
 * @returns the canonical text.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The normalized projection of a set of session logs, primary first: ids,
 * clocks, the working directory and system prompts are replaced the way the
 * recorded-session snapshots replace them, so the same run reproduces it.
 * @param logs - the logs, primary first.
 * @returns one normalized JSONL text per log, in the same order.
 */
export function normalizedLogs(logs: readonly string[]): string[] {
  const headers = logs.map(log => records(log)[0] ?? {})
  const cwd = headers[0]?.cwd
  return normalizeSessionSnapshots(logs, {
    sessionIds: headers.flatMap(header => typeof header.id === 'string' ? [header.id] : []),
    cwd: typeof cwd === 'string' ? cwd : '\0missing-cwd\0',
  })
}

/**
 * Keys a recorded scenario's `snapshot.yml` may carry for a benchmark lane to replay it unchanged; `profile` must
 * be `headless` and `composition`, when present, `default`.
 */
const REPLAYABLE_MANIFEST_KEYS = new Set(['version', 'scenario', 'profile', 'composition', 'recording', 'header', 'permission', 'environment'])

/** One recorded headless session a lane replays. */
export interface RecordedScenario {
  readonly name: string
  readonly dir: string
  /** The primary recording: the highest generation of `session.vN.jsonl`. */
  readonly fixture: string
  /** The recording's text. */
  readonly recording: string
  /** The task the recording's first user message gave. */
  readonly task: string
  /** The provider and model the recording's first request named. */
  readonly provider: string
  readonly model: string
  /** `DSH_PERMISSION_MODE` for the run, when the recording set one. */
  readonly permission: string | undefined
  /** Extra environment the recording's manifest names. */
  readonly environment: Readonly<Record<string, string>>
}

/**
 * The task a recording's first single-text user message gave: its inbox
 * splice when there is one, else its first user message.
 * @param recording - the recording's text.
 * @returns the task, or `undefined` when the recording has none.
 */
function taskOf(recording: string): string | undefined {
  const text = (message: unknown): string | undefined => {
    if (message === null || typeof message !== 'object') return undefined
    const { source, content } = message as { source?: { kind?: unknown }; content?: unknown }
    if (source?.kind !== 'user' || !Array.isArray(content) || content.length !== 1) return undefined
    const [block] = content as { type?: unknown; text?: unknown }[]
    return block?.type === 'text' && typeof block.text === 'string' ? block.text : undefined
  }
  const all = records(recording)
  for (const record of all) {
    if (record.type !== 'agent/inbox/spliced') continue
    const inserted = (record.data as { inserted?: unknown } | undefined)?.inserted
    for (const message of Array.isArray(inserted) ? inserted : []) {
      const task = text(message)
      if (task !== undefined) return task
    }
  }
  for (const record of all) {
    if (record.type !== 'user/message') continue
    const task = text(record.data)
    if (task !== undefined) return task
  }
  return undefined
}

/**
 * The provider and model a recording's first request named.
 * @param recording - the recording's text.
 * @returns them, or `undefined` when no request names both.
 */
function modelOf(recording: string): { provider: string; model: string } | undefined {
  for (const record of records(recording)) {
    if (record.type !== 'request/header') continue
    const config = (record.data as { header?: { config?: { provider?: unknown; model?: unknown } } } | undefined)?.header?.config
    if (typeof config?.provider === 'string' && typeof config.model === 'string') return { provider: config.provider, model: config.model }
  }
  return undefined
}

/**
 * Read one recorded headless scenario a lane can replay unchanged.
 * @param recordings - the directory holding the recorded scenarios.
 * @param name - the scenario's directory name.
 * @returns the scenario.
 * @throws when the scenario needs anything the benchmark does not provide — another profile or composition, a
 *   replay override, a platform, a workspace setup or final check, a pinned session format, or child sessions — or
 *   when its recording has no task or no request model.
 */
export function readRecordedScenario(recordings: string, name: string): RecordedScenario {
  const dir = join(recordings, name)
  const manifest = (yaml.load(readFileSync(join(dir, 'snapshot.yml'), 'utf8')) ?? {}) as Record<string, unknown>
  const files = readdirSync(dir)
  const sessions = files.filter(file => /^session\.v\d+\.jsonl$/u.test(file))
    .sort((left, right) => Number(/v(\d+)/u.exec(left)?.[1]) - Number(/v(\d+)/u.exec(right)?.[1]))
  const unsupported = [
    ...Object.keys(manifest).filter(key => !REPLAYABLE_MANIFEST_KEYS.has(key)),
    ...manifest.profile === 'headless' ? [] : [`profile ${String(manifest.profile)}`],
    ...manifest.composition === undefined || manifest.composition === 'default' ? [] : [`composition ${String(manifest.composition)}`],
    ...files.filter(file => /^session\.\d+\.v\d+\.jsonl$/u.test(file)),
    ...files.includes('cordis.yml') ? ['its own composition'] : [],
  ]
  if (unsupported.length > 0) throw new Error(`benchmark scenario ${name} cannot be replayed unchanged: ${unsupported.join(', ')}`)
  const primary = sessions.at(-1)
  if (primary === undefined) throw new Error(`benchmark scenario ${name} has no session.vN.jsonl recording`)
  const fixture = join(dir, primary)
  const recording = readFileSync(fixture, 'utf8')
  const task = taskOf(recording)
  const model = modelOf(recording)
  if (task === undefined || model === undefined) throw new Error(`benchmark scenario ${name}: its recording names no ${task === undefined ? 'task' : 'request model'}`)
  const environment = manifest.environment as Record<string, string> | undefined
  return {
    name,
    dir,
    fixture,
    recording,
    task,
    provider: model.provider,
    model: model.model,
    permission: typeof manifest.permission === 'string' ? manifest.permission : undefined,
    environment: environment ?? {},
  }
}

/**
 * The stable logical spill prefix the replay provider maps a scenario's spill
 * paths through, as `snapshotSpillRoot` in the recorded-session snapshot
 * harness derives it (posix only).
 * @param fixture - the scenario's recording.
 * @returns the prefix.
 */
function spillLocatorRoot(fixture: string): string {
  return `/tmp/dsh-acp-snap-${sha256(basename(dirname(fixture))).slice(0, 9)}`
}

/**
 * The session logs a run persisted under a `$DSH_HOME`, parent first.
 * @param dshHome - the run's `$DSH_HOME`.
 * @returns the latest generation of each session's log, as written.
 */
function persistedLogs(dshHome: string): string[] {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return []
  const logs = latestPersistedSessionPaths(readdirSync(root, { recursive: true }).map(String))
    .map(file => readFileSync(join(root, file), 'utf8'))
  const header = (log: string): LogRecord => records(log)[0] ?? {}
  return logs.sort((left, right) =>
    Number(typeof header(left).parentSession === 'string') - Number(typeof header(right).parentSession === 'string')
    || Number(header(left).createdAt) - Number(header(right).createdAt))
}

/** What one product launch left. */
export interface ProductRun {
  /** The argv the product was launched with. */
  readonly argv: readonly string[]
  /** Its exit code, or `null` when it was killed. */
  readonly exitCode: number | null
  /** Wall-clock time of the run. */
  readonly latencyMs: number
  /** The persisted session logs, parent first, as the product wrote them. */
  readonly logs: readonly string[]
}

/**
 * Replay one recorded scenario through the shipped product.
 * @param scenario - the recording.
 * @param options - `composition`, the directory whose `cordis.yml`, `cordis.snapshot.yml` and `model.cordis.yml`
 *   compose the replay; `timeoutMs`, after which the run is killed.
 * @returns the launch, its exit code, its duration and its session logs.
 */
export function replayRecordedScenario(
  scenario: RecordedScenario,
  options: { readonly composition: string; readonly timeoutMs: number },
): ProductRun {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-benchmark-'))
  const spill = mkdtempSync(join(tmpdir(), 'dsh-benchmark-spill-'))
  try {
    const patchDir = join(cwd, '.snapshot-patches')
    mkdirSync(patchDir, { recursive: true })
    const patches = [
      join(options.composition, 'cordis.yml'),
      materializeProfilePatch(join(options.composition, 'cordis.snapshot.yml'), cwd, patchDir, 1),
      join(options.composition, 'model.cordis.yml'),
    ]
    const workspace = join(scenario.dir, 'workspace')
    if (existsSync(workspace)) {
      for (const entry of readdirSync(workspace)) cpSync(join(workspace, entry), join(cwd, entry), { recursive: true, verbatimSymlinks: true })
    }
    const dshHome = join(cwd, '.dsh')
    const launch = resolveExampleLaunch({
      srcBin: join(REPO_ROOT, 'apps/cli/src/bin.ts'),
      configArgs: ['--profile', 'headless', ...patches.flatMap(patch => ['--patch', patch]), scenario.task],
      mode: 'src',
      tsconfigPath: join(REPO_ROOT, 'tsconfig.json'),
      env: {
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_PROVIDER: scenario.provider,
        DSH_SNAPSHOT_MODEL: scenario.model,
        DSH_SNAPSHOT_SPILL_ROOT: spill,
        DSH_SNAPSHOT_SPILL_LOCATOR_ROOT: spillLocatorRoot(scenario.fixture),
        DSH_SNAPSHOT_FILE: scenario.fixture,
        ...scenario.permission === undefined ? {} : { DSH_PERMISSION_MODE: scenario.permission },
        ...scenario.environment,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    // No model API reaches the product: the replay provider answers every request.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'DEEPSEEK_API_KEY' && name !== 'DEEPSEEK_BASE_URL'))
    const started = performance.now()
    const result = spawnSync(launch.command, launch.args, {
      cwd,
      env: { ...inherited, ...launch.env },
      input: '',
      encoding: 'utf8',
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    })
    const latencyMs = performance.now() - started
    return { argv: [launch.command, ...launch.args], exitCode: result.status, latencyMs, logs: persistedLogs(dshHome) }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(spill, { recursive: true, force: true })
  }
}

/**
 * How many side effects a run duplicated: the idempotency keys whose action
 * manifest its session logs append more than once.
 * @param logs - the run's session logs.
 * @returns the number of such keys.
 */
export function duplicateSideEffectsOf(logs: readonly string[]): number {
  const seen = new Map<string, number>()
  for (const log of logs) {
    for (const record of records(log)) {
      if (record.type !== 'action/manifest-appended') continue
      const key = (record.data as { manifest?: { idempotencyKey?: unknown }; idempotencyKey?: unknown } | undefined)
      const idempotencyKey = key?.manifest?.idempotencyKey ?? key?.idempotencyKey
      if (typeof idempotencyKey === 'string') seen.set(idempotencyKey, (seen.get(idempotencyKey) ?? 0) + 1)
    }
  }
  return [...seen.values()].filter(count => count > 1).length
}

/**
 * The model cost of a run: every assistant message's recorded usage, priced
 * per million tokens from the manifest's price table. Cached input tokens take
 * the cache-hit price, the rest of the input the cache-miss price, and output
 * tokens (reasoning included) the output price.
 * @param logs - the run's session logs.
 * @param pricing - the manifest's price table.
 * @returns the cost in the table's currency.
 * @throws when a message's model has no price in the table.
 */
export function tokenCostOf(logs: readonly string[], pricing: PriceTable): number {
  let cost = 0
  for (const log of logs) {
    for (const record of records(log)) {
      if (record.type !== 'assistant/message') continue
      const data = record.data as { usage?: Record<string, unknown>; message?: { source?: { model?: unknown } } } | undefined
      if (data?.usage === undefined) continue
      const model = data.message?.source?.model
      const price = typeof model === 'string' ? pricing.models[model] : undefined
      if (price === undefined) throw new Error(`benchmark manifest.yml prices no model ${JSON.stringify(model)}`)
      const tokens = (field: string): number => typeof data.usage?.[field] === 'number' ? data.usage[field] : 0
      const cached = tokens('cacheReadTokens')
      cost += ((tokens('inputTokens') - cached) * price.inputCacheMiss + cached * price.inputCacheHit + tokens('outputTokens') * price.output) / 1_000_000
    }
  }
  return cost
}
