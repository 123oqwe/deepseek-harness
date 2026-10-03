/**
 * The shipped product under the Harness capability benchmark (Epic P0-08).
 *
 * A replaying trial replays one recorded headless session: `dsh --profile
 * headless` from source, with the recorded-session snapshots' patch layers (the
 * `dsh-llm-replay` provider answers from the recording), in a fresh working
 * directory and `$DSH_HOME`, with no model API configured. This is the launch
 * `snapshots/session/headless.snapshot.ts` makes, without its assertions.
 *
 * A fault trial replays the same way in a working directory it keeps across
 * launches, so a launch it kills on purpose can be resumed there.
 *
 * An attacking trial launches the same command with the shipped composition
 * and only the patches its attack needs; the model is the benchmark's stub on
 * a loopback port, reached through `DEEPSEEK_BASE_URL` with a key that is
 * visibly not one. Either way the session logs the run persisted are harvested
 * before the directory is removed.
 * @module benchmarks/harness-capability/product
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import * as yaml from 'js-yaml'
import { resolveExampleLaunch, type ExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import type { PriceTable } from './manifest.ts'
import { materializeProfilePatch } from '@deepseek-ai/dsh-session-snapshot/src/launcher.ts'
import { normalizeSessionSnapshot, normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot/src/normalize.ts'
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

/** The token the recorded-session normalizer writes in place of a manifest's idempotency key. */
const IDEMPOTENCY_KEY_TOKEN = '{{idempotencyKey}}'

/**
 * Every idempotency key an `action/manifest-appended` record of these logs declares.
 * @param logs - the logs.
 * @returns the keys, each once.
 */
function idempotencyKeysOf(logs: readonly string[]): string[] {
  const keys = new Set<string>()
  for (const log of logs) {
    for (const record of records(log)) {
      if (record.type !== 'action/manifest-appended-never') continue
      const key = (record.data as { idempotencyKey?: unknown } | undefined)?.idempotencyKey
      if (typeof key === 'string' && key.length > 0) keys.add(key)
    }
  }
  return [...keys]
}

/**
 * The normalized projection of session logs the shipped profile wrote live,
 * primary first: the scrubbing {@link normalizedLogs} applies, without the
 * recorded-fixture restore that {@link normalizedLogs} runs first. That
 * restore is strict and refused the security lane's live logs (run
 * 36370052596); a live log is already in the current format.
 *
 * An idempotency key is a digest over the run id, so each run writes new
 * ones. The recorded-session normalizer replaces the key in the manifest that
 * declares it; every other occurrence of a declared key, such as the
 * action-ledger refusal a resumed turn ended with (B-704, run 37108478263),
 * is replaced with the same token here.
 * @param logs - the logs, primary first.
 * @returns one normalized JSONL text per log, in the same order.
 */
export function normalizedLiveLogs(logs: readonly string[]): string[] {
  const headers = logs.map(log => records(log)[0] ?? {})
  const cwd = headers[0]?.cwd
  const ctx = {
    sessionIds: headers.flatMap(header => typeof header.id === 'string' ? [header.id] : []),
    cwd: typeof cwd === 'string' ? cwd : '\0missing-cwd\0',
  }
  const keys = idempotencyKeysOf(logs)
  return logs.map(log => keys.reduce((text, key) => text.split(key).join(IDEMPOTENCY_KEY_TOKEN), normalizeSessionSnapshot(log, ctx)))
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
  /** The `workspace.expected` directory the final workspace is compared with, when the caller admitted that check. */
  readonly expectedWorkspace: string | undefined
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
 * @param options - `finalWorkspace`: also admit a scenario whose manifest asks only for the final-workspace check,
 *   `workspace: { final: true }`, and return the directory that check compares with.
 * @returns the scenario.
 * @throws when the scenario needs anything the benchmark does not provide — another profile or composition, a
 *   replay override, a platform, a workspace setup, a final-workspace check the caller did not admit, a pinned
 *   session format, or child sessions — or when its recording has no task or no request model.
 */
export function readRecordedScenario(
  recordings: string,
  name: string,
  options: { readonly finalWorkspace?: boolean } = {},
): RecordedScenario {
  const dir = join(recordings, name)
  const manifest = (yaml.load(readFileSync(join(dir, 'snapshot.yml'), 'utf8')) ?? {}) as Record<string, unknown>
  const files = readdirSync(dir)
  const sessions = files.filter(file => /^session\.v\d+\.jsonl$/u.test(file))
    .sort((left, right) => Number(/v(\d+)/u.exec(left)?.[1]) - Number(/v(\d+)/u.exec(right)?.[1]))
  // A workspace setup is never admitted: only the final check, which a lane can make after the run.
  const finalWorkspace = options.finalWorkspace === true && canonicalJson(manifest.workspace) === canonicalJson({ final: true })
  const unsupported = [
    ...Object.keys(manifest).filter(key => !REPLAYABLE_MANIFEST_KEYS.has(key) && !(key === 'workspace' && finalWorkspace)),
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
    expectedWorkspace: finalWorkspace ? join(dir, 'workspace.expected') : undefined,
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
 * One zstd session log's text, read frame by frame with the persistence
 * package's own frame scanner, as the shipped profiles write it.
 * @param path - the `.jsonl.zstd` file.
 * @returns the log's JSONL text.
 * @throws when the file ends inside a frame.
 */
function readZstdLog(path: string): string {
  const compressed = readFileSync(path)
  const { frames, tornStart } = scanZstdFrames(compressed)
  if (tornStart !== undefined) throw new Error(`session log ends mid-frame at byte ${String(tornStart)}: ${path}`)
  return frames
    .flatMap(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)).toString('utf8').split('\n'))
    .filter(line => line !== '')
    .map(line => `${line}\n`)
    .join('')
}

/**
 * The session logs a run persisted under a `$DSH_HOME`, parent first.
 * @param dshHome - the run's `$DSH_HOME`.
 * @param compression - how the composition persists logs: `raw` under the snapshot patches, `zstd` as shipped.
 * @returns the latest generation of each session's log, as JSONL text.
 */
function persistedLogs(dshHome: string, compression: 'raw' | 'zstd'): string[] {
  const root = join(dshHome, 'sessions')
  if (!existsSync(root)) return []
  const logs = latestPersistedSessionPaths(readdirSync(root, { recursive: true }).map(String), compression)
    .map(file => compression === 'raw' ? readFileSync(join(root, file), 'utf8') : readZstdLog(join(root, file)))
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
  /** The last 2000 characters the product wrote to stderr, when the launch kept them. */
  readonly stderrTail?: string
}

/**
 * This process's environment without the model API variables, so no key or
 * base URL from the benchmark's own environment reaches the product.
 * @returns the environment to launch the product from.
 */
function withoutModelApi(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'DEEPSEEK_API_KEY' && name !== 'DEEPSEEK_BASE_URL'))
}

/** The root entries of a replay's working directory that the benchmark and the product own, not the task. */
export const REPLAY_RUNTIME_ENTRIES: readonly string[] = ['.agents', '.dsh', '.snapshot-patches']

/** The directories one replay runs in. */
export interface ReplayWorkspace {
  /** The working directory, seeded from the scenario's `workspace/`; `$DSH_HOME` is its `.dsh`. */
  readonly cwd: string
  /** The replay provider's spill root. */
  readonly spill: string
  /** The composition's patch files in order, its snapshot patch materialized under `cwd`. */
  readonly patches: readonly string[]
}

/**
 * Prepare the directories one replay runs in: a fresh working directory
 * seeded from the scenario's `workspace/`, with the composition's snapshot
 * patch materialized in it, and a spill root.
 * @param scenario - the recording.
 * @param composition - the directory whose `cordis.yml`, `cordis.snapshot.yml` and `model.cordis.yml` compose the replay.
 * @returns the directories; the caller removes them with {@link removeReplayWorkspace}.
 */
export function prepareReplayWorkspace(scenario: RecordedScenario, composition: string): ReplayWorkspace {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-benchmark-'))
  const spill = mkdtempSync(join(tmpdir(), 'dsh-benchmark-spill-'))
  try {
    const patchDir = join(cwd, '.snapshot-patches')
    mkdirSync(patchDir, { recursive: true })
    const patches = [
      join(composition, 'cordis.yml'),
      materializeProfilePatch(join(composition, 'cordis.snapshot.yml'), cwd, patchDir, 1),
      join(composition, 'model.cordis.yml'),
    ]
    const workspace = join(scenario.dir, 'workspace')
    if (existsSync(workspace)) {
      for (const entry of readdirSync(workspace)) cpSync(join(workspace, entry), join(cwd, entry), { recursive: true, verbatimSymlinks: true })
    }
    return { cwd, spill, patches }
  } catch (error) {
    removeReplayWorkspace({ cwd, spill, patches: [] })
    throw error
  }
}

/**
 * Remove a replay's directories.
 * @param workspace - the directories {@link prepareReplayWorkspace} made.
 */
export function removeReplayWorkspace(workspace: ReplayWorkspace): void {
  rmSync(workspace.cwd, { recursive: true, force: true })
  rmSync(workspace.spill, { recursive: true, force: true })
}

/**
 * The launch of one replay in prepared directories.
 * @param scenario - the recording.
 * @param workspace - the prepared directories.
 * @param extra - patch files laid over the composition's, and environment laid over the replay's.
 * @returns the resolved spawn.
 */
function replayLaunchOf(
  scenario: RecordedScenario,
  workspace: ReplayWorkspace,
  extra: { readonly patches: readonly string[]; readonly env: Readonly<Record<string, string>> },
): ExampleLaunch {
  return resolveExampleLaunch({
    srcBin: join(REPO_ROOT, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', ...[...workspace.patches, ...extra.patches].flatMap(patch => ['--patch', patch]), scenario.task],
    mode: 'src',
    tsconfigPath: join(REPO_ROOT, 'tsconfig.json'),
    env: {
      DSH_HOME: join(workspace.cwd, '.dsh'),
      DSH_AGENTS_HOME: join(workspace.cwd, '.agents'),
      DSH_SNAPSHOT: 'replay',
      DSH_SNAPSHOT_PROVIDER: scenario.provider,
      DSH_SNAPSHOT_MODEL: scenario.model,
      DSH_SNAPSHOT_SPILL_ROOT: workspace.spill,
      DSH_SNAPSHOT_SPILL_LOCATOR_ROOT: spillLocatorRoot(scenario.fixture),
      DSH_SNAPSHOT_FILE: scenario.fixture,
      ...scenario.permission === undefined ? {} : { DSH_PERMISSION_MODE: scenario.permission },
      ...scenario.environment,
      ...extra.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      DSH_TELEMETRY_DISABLED: '1',
    },
  })
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
  const workspace = prepareReplayWorkspace(scenario, options.composition)
  try {
    const launch = replayLaunchOf(scenario, workspace, { patches: [], env: {} })
    // No model API reaches the product: the replay provider answers every request.
    const started = performance.now()
    const result = spawnSync(launch.command, launch.args, {
      cwd: workspace.cwd,
      env: { ...withoutModelApi(), ...launch.env },
      input: '',
      encoding: 'utf8',
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
    })
    const latencyMs = performance.now() - started
    return { argv: [launch.command, ...launch.args], exitCode: result.status, latencyMs, logs: persistedLogs(join(workspace.cwd, '.dsh'), 'raw') }
  } finally {
    removeReplayWorkspace(workspace)
  }
}

/** A replay launch killed on purpose while its replay script stalls. */
export interface StallKill {
  /** The marker file the replay provider writes when the script's `hang` entry starts. */
  readonly marker: string
  /** How long to wait after the marker appears before the SIGKILL, so the product persists what it wrote before the stall. */
  readonly afterMs: number
}

/** What one asynchronous replay launch left. */
export interface ReplayRun extends ProductRun {
  /** Whether the launch was killed after its stall marker appeared. */
  readonly killedAtStall: boolean
}

/** How often a launch waiting to be killed at a stall looks for the marker. */
const STALL_POLL_MS = 50

/**
 * Kill a launch once its stall marker exists and the wait after it has
 * passed, unless the launch exits first.
 * @param child - the launched product.
 * @param stall - the marker and the wait.
 * @param exited - whether the launch has exited.
 * @returns whether the launch was killed.
 */
async function killAtStall(child: ChildProcess, stall: StallKill, exited: () => boolean): Promise<boolean> {
  while (!existsSync(stall.marker)) {
    if (exited()) return false
    await sleep(STALL_POLL_MS)
  }
  await sleep(stall.afterMs)
  if (exited()) return false
  child.kill('SIGKILL')
  return true
}

/**
 * Replay one recorded scenario through the shipped product in prepared
 * directories, which the launch leaves in place, so a later launch continues
 * in the same working directory and `$DSH_HOME`.
 * @param scenario - the recording.
 * @param workspace - the prepared directories.
 * @param options - `patches` laid over the composition's; `env` laid over the replay's, such as a
 *   `DSH_SNAPSHOT_OVERRIDE` script; `timeoutMs`, after which the run is killed; `stall`, a marker after which it is
 *   killed.
 * @returns the launch, its exit code (`null` when killed), its duration, its session logs, the tail of its stderr,
 *   and whether it was killed at the stall.
 */
export async function launchReplay(
  scenario: RecordedScenario,
  workspace: ReplayWorkspace,
  options: {
    readonly patches: readonly string[]
    readonly env: Readonly<Record<string, string>>
    readonly timeoutMs: number
    readonly stall?: StallKill
  },
): Promise<ReplayRun> {
  const launch = replayLaunchOf(scenario, workspace, options)
  const started = performance.now()
  let stderr = ''
  let exited = false
  const child = spawn(launch.command, launch.args, { cwd: workspace.cwd, env: { ...withoutModelApi(), ...launch.env }, stdio: ['ignore', 'ignore', 'pipe'] })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000) })
  const timer = setTimeout(() => { child.kill('SIGKILL') }, options.timeoutMs)
  const killed = options.stall === undefined ? Promise.resolve(false) : killAtStall(child, options.stall, () => exited)
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error) => {
      clearTimeout(timer)
      exited = true
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      exited = true
      resolve(code)
    })
  })
  return {
    argv: [launch.command, ...launch.args],
    exitCode,
    latencyMs: performance.now() - started,
    logs: persistedLogs(join(workspace.cwd, '.dsh'), 'raw'),
    stderrTail: stderr,
    killedAtStall: await killed,
  }
}

/** The key an attacking trial's product sends the stub model: nonblank, which the shipped client requires, and visibly not a key. */
export const STUB_API_KEY = 'sk-benchmark-not-a-key'

/** One launch of the shipped headless composition against the stub model. */
export interface ShippedLaunch {
  /** The working directory, which the product takes as its workspace; `$DSH_HOME` is its `.dsh`. */
  readonly cwd: string
  /** The task given on the command line. */
  readonly task: string
  /** Absolute paths of the patch files laid over the shipped profile, in order. */
  readonly patches: readonly string[]
  /** The stub model's base URL. */
  readonly modelBaseUrl: string
  /** The permission preset, `DSH_PERMISSION_MODE`. */
  readonly permission: string
  /** Further environment the trial needs. */
  readonly env: Readonly<Record<string, string>>
  /** How long the run may take before it is killed. */
  readonly timeoutMs: number
}

/**
 * Launch the shipped headless composition once against the stub model. The
 * launch is asynchronous because the stub answers from this process.
 * @param launch - the working directory, task, patches, model URL, preset, environment and time limit.
 * @returns the launch, its exit code, its duration, its session logs and the tail of its stderr.
 */
export async function launchShippedHeadless(launch: ShippedLaunch): Promise<ProductRun> {
  const dshHome = join(launch.cwd, '.dsh')
  const resolved = resolveExampleLaunch({
    srcBin: join(REPO_ROOT, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', ...launch.patches.flatMap(patch => ['--patch', patch]), launch.task],
    mode: 'src',
    tsconfigPath: join(REPO_ROOT, 'tsconfig.json'),
    env: {
      DSH_HOME: dshHome,
      DSH_AGENTS_HOME: join(launch.cwd, '.agents'),
      DEEPSEEK_BASE_URL: launch.modelBaseUrl,
      DEEPSEEK_API_KEY: STUB_API_KEY,
      DSH_PERMISSION_MODE: launch.permission,
      ...launch.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      DSH_TELEMETRY_DISABLED: '1',
    },
  })
  const started = performance.now()
  let stderr = ''
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, { cwd: launch.cwd, env: { ...withoutModelApi(), ...resolved.env }, stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000) })
    const timer = setTimeout(() => { child.kill('SIGKILL') }, launch.timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  return {
    argv: [resolved.command, ...resolved.args],
    exitCode,
    latencyMs: performance.now() - started,
    logs: persistedLogs(dshHome, 'zstd'),
    stderrTail: stderr,
  }
}

/**
 * The error codes of a tool result recorded without the tool running: a
 * refusal before dispatch (the action ledger's refusal of a re-issued call is
 * one) and a resume's closer for a call that never started.
 */
const NOT_RUN_CODES: ReadonlySet<string> = new Set(['ABORTED_BEFORE_DISPATCH', 'TOOL_NOT_STARTED'])

/** What `duplicate_side_effect` is read from, as every lane report states it. */
export const DUPLICATE_SIDE_EFFECT_SOURCE = 'trials in which one idempotency key\'s call was applied more than once; a tool result recorded without the tool running, such as the action ledger\'s refusal of a re-issued call, is not an application'

/**
 * How many side effects a run applied more than once: the idempotency keys
 * whose calls have more than one tool result recorded as having run. Each
 * native call's action manifest names its call id and its key; a result whose
 * error code says the tool did not run is not counted.
 * @param logs - the run's session logs.
 * @returns the number of such keys.
 */
export function duplicateSideEffectsOf(logs: readonly string[]): number {
  const applied = new Map<string, number>()
  for (const log of logs) {
    const all = records(log)
    const keyOfCall = new Map<string, string>()
    for (const record of all) {
      if (record.type !== 'action/manifest-appended') continue
      const data = record.data as { actionId?: unknown; idempotencyKey?: unknown } | undefined
      if (typeof data?.actionId === 'string' && typeof data.idempotencyKey === 'string') keyOfCall.set(data.actionId, data.idempotencyKey)
    }
    for (const record of all) {
      if (record.type !== 'tool/result') continue
      const data = record.data as { message?: { content?: readonly { toolCallId?: unknown }[] }; error?: { code?: unknown } } | undefined
      const code = data?.error?.code
      if (typeof code === 'string' && NOT_RUN_CODES.has(code)) continue
      for (const block of data?.message?.content ?? []) {
        const key = typeof block.toolCallId === 'string' ? keyOfCall.get(block.toolCallId) : undefined
        if (key !== undefined) applied.set(key, (applied.get(key) ?? 0) + 1)
      }
    }
  }
  return [...applied.values()].filter(count => count > 1).length
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

/**
 * What `token_cost` is read from, as a lane report states it: the unit, the
 * price source, the date it was read, the rate, and the table's assumption.
 * @param pricing - the manifest's price table.
 * @returns the description.
 */
export function tokenCostSource(pricing: PriceTable): string {
  const assumption = pricing.assumption === undefined ? '' : `; assumes ${pricing.assumption}`
  return `${pricing.currency} per trial, assistant-message usage priced from ${pricing.source} as read on ${pricing.retrievedAt} (${pricing.rate} rate${assumption})`
}
