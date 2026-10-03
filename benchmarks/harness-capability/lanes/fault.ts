/**
 * The fault lane of the Harness capability benchmark (Epic P0-08).
 *
 * Each trial replays one recorded headless session that changes its
 * workspace, through the shipped product, and injects one failure at a model
 * call its trial seed picks. Trials alternate between two kinds, a process
 * fault first:
 * - a process fault stalls the replay at a call that follows at least one
 *   world-changing call. Once the product has persisted what it wrote, the
 *   benchmark kills it with SIGKILL, waits for its Run lease to lapse, and
 *   resumes the session through the shipped runner's `resumeSessionId` with
 *   the task given again. The resumed replay starts at the last
 *   world-changing call before the stall, so the product meets that call
 *   again under its original call id, the re-issue a crash and retry
 *   produces, and its action ledger must not apply it twice;
 * - a model fault makes the replayed provider fail with a retryable `SERVER`
 *   error before one recorded answer, and the product retries in process.
 *
 * A trial is judged from the world, its final workspace against the
 * recording's `workspace.expected`, and from the session log: how the last
 * turn ended, where the failure landed, and whether any call was applied
 * twice. The retry policy and the Run lease are the benchmark's own settings,
 * laid over the replay by a patch. A replayed recording asks for nothing the
 * policy refuses, and the shipped product has no verifier or router
 * (BLOCKED-335). No fault scenario stands on an open BLOCKED item, so the
 * lane's known-red list is empty.
 * @module benchmarks/harness-capability/lanes/fault
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot } from '@deepseek-ai/dsh-session-snapshot/src/workspace.ts'
import type { Manifest, ManifestLane } from '../manifest.ts'
import {
  canonicalJson,
  DUPLICATE_SIDE_EFFECT_SOURCE,
  duplicateSideEffectsOf,
  launchReplay,
  normalizedLiveLogs,
  prepareReplayWorkspace,
  readRecordedScenario,
  records,
  removeReplayWorkspace,
  REPLAY_RUNTIME_ENTRIES,
  REPO_ROOT,
  sha256,
  tokenCostOf,
  tokenCostSource,
  type LogRecord,
  type RecordedScenario,
  type ReplayRun,
} from '../product.ts'
import {
  countMetric,
  laneMetrics,
  meanMetric,
  proportionMetric,
  type FailurePosition,
  type InjectedFault,
  type LaneReport,
  type Trial,
} from '../report.ts'
import { drawScenarios, seededRandom, trialSeed } from '../seed.ts'

/** The retry policy the fault patch gives the replayed provider; the shipped default is 5 retries from 500 ms. */
const RETRY_POLICY = { maxRetries: 2, delayMs: 1 } as const

/**
 * The Run lease the fault patch sets in place of the shipped 30 s, so a killed
 * product's lease lapses in seconds; a live product renews it every third of
 * that time.
 */
const RUN_LEASE_MS = 5000

/** How long a resume waits beyond the Run lease after the kill. */
const LEASE_MARGIN_MS = 1000

/** How long a stalled launch runs after its marker appears before the SIGKILL: several of the persistence's 200 ms write batches. */
const PERSIST_WAIT_MS = 1000

/** The code of a model fault's provider error, one the shipped retry policy retries. */
const PROVIDER_FAILURE_CODE = 'SERVER'

/** What `recovery_success` is read from. */
const RECOVERY_SOURCE = 'the injected failure shown in the session log, then the last turn completed with the final workspace equal to the recording\'s workspace.expected and no call applied twice;'
  + ` a model fault recovers under the benchmark's own retry policy of ${String(RETRY_POLICY.maxRetries)} retries ${String(RETRY_POLICY.delayMs)} ms apart, not the shipped default of 5 retries from 500 ms,`
  + ` and a process fault through one resume of the killed session once its Run lease, shortened by the benchmark to ${String(RUN_LEASE_MS)} ms, lapsed`

/** What the lane reads from one recording before its trials start. */
interface FaultPlan {
  readonly scenario: RecordedScenario
  /** The `workspace.expected` directory the final workspace is compared with. */
  readonly expectedWorkspace: string
  /** The recording's replay script, one entry per model call. */
  readonly script: readonly ReplayEntry[]
  /** The model calls whose tool calls change the world, ascending: a call whose action manifest's side-effect class is not `read`. */
  readonly worldChanging: readonly number[]
  /** The model calls a process fault may stall: each follows at least one world-changing call. */
  readonly stallable: readonly number[]
}

/**
 * Read one recording the fault lane replays, and plan where its failures may land.
 * @param recordings - the directory holding the recorded scenarios.
 * @param name - the scenario's directory name.
 * @returns the plan.
 * @throws when the recording cannot be replayed unchanged, declares no final-workspace check, has a model call
 *   that is not one assistant message, or has no call after a world-changing one.
 */
function readFaultPlan(recordings: string, name: string): FaultPlan {
  const scenario = readRecordedScenario(recordings, name, { finalWorkspace: true })
  if (scenario.expectedWorkspace === undefined) throw new Error(`benchmark scenario ${name}: the fault lane replays only recordings whose snapshot.yml declares workspace: { final: true }`)
  const script = deriveReplayScript(parseSessionLog(scenario.recording))
  const all = records(scenario.recording)
  const sideEffectClass = new Map<string, unknown>()
  for (const record of all) {
    if (record.type !== 'action/manifest-appended') continue
    const data = record.data as { actionId?: unknown; sideEffectClass?: unknown } | undefined
    if (typeof data?.actionId === 'string') sideEffectClass.set(data.actionId, data.sideEffectClass)
  }
  // A tool call belongs to the model call whose assistant message precedes it.
  const worldChanging = new Set<number>()
  let calls = 0
  for (const record of all) {
    if (record.type === 'assistant/message') calls++
    if (record.type !== 'tool/call') continue
    const callId = (record.data as { callId?: unknown } | undefined)?.callId
    if (typeof callId === 'string' && sideEffectClass.get(callId) !== 'read') worldChanging.add(calls - 1)
  }
  if (calls !== script.length) {
    throw new Error(`benchmark scenario ${name}: its recording has ${String(calls)} assistant messages and ${String(script.length)} replayed model calls; the fault lane needs one call per message`)
  }
  const changing = [...worldChanging].sort((left, right) => left - right)
  const stallable = script.map((_, call) => call).filter(call => changing.some(changed => changed < call))
  if (stallable.length === 0) throw new Error(`benchmark scenario ${name}: no model call follows one that changes the world, so a process fault would re-issue nothing`)
  return { scenario, expectedWorkspace: scenario.expectedWorkspace, script, worldChanging: changing, stallable }
}

/**
 * Write a replay script for `DSH_SNAPSHOT_OVERRIDE`.
 * @param dir - the trial's own directory.
 * @param name - the file's name.
 * @param entries - the script, one entry per model call.
 * @returns the file's path.
 */
function writeScript(dir: string, name: string, entries: readonly ReplayEntry[]): string {
  const path = join(dir, name)
  writeFileSync(path, JSON.stringify(entries))
  return path
}

/**
 * Write the patch every fault launch adds. It restates the composition's
 * `llm-replay` row from `cordis.snapshot.yml` with the benchmark's retry
 * policy, and the base profile's `run` row with a short lease, because a patch
 * replaces a row's whole config.
 * @param dir - the trial's own directory.
 * @returns the patch's path.
 */
function writeFaultPatch(dir: string): string {
  const path = join(dir, 'fault.patch.yml')
  writeFileSync(path, [
    '- id: llm-replay',
    '  config:',
    '    providers:',
    '      - id: deepseek-official',
    '        name: DeepSeek',
    `        retryPolicy: { mode: normal, maxRetries: ${String(RETRY_POLICY.maxRetries)}, backoff: { initialDelayMs: ${String(RETRY_POLICY.delayMs)}, maxDelayMs: ${String(RETRY_POLICY.delayMs)}, jitterRatio: 0 } }`,
    '        models:',
    '          - id: deepseek-v4-flash',
    '          - id: deepseek-v4-pro',
    '- id: run',
    '  config:',
    '    storePath: !!js dshHomePath(\'runs\', \'runs.json\')',
    `    leaseMs: ${String(RUN_LEASE_MS)}`,
    '',
  ].join('\n'))
  return path
}

/**
 * Write the patch a resume adds: the shipped `headless-runner` row's config
 * restated with the killed session's id as `resumeSessionId`, which headless
 * reaches only through a patch on that row.
 * @param dir - the trial's own directory.
 * @param sessionId - the session to resume.
 * @returns the patch's path.
 */
function writeResumePatch(dir: string, sessionId: string): string {
  const path = join(dir, 'resume.patch.yml')
  writeFileSync(path, [
    '- id: headless-runner',
    '  config:',
    '    task: !!js ctx.headlessStartup.task',
    '    model: !!js ctx.headlessStartup.model',
    '    outputFormat: !!js ctx.headlessStartup.outputFormat',
    `    resumeSessionId: ${JSON.stringify(sessionId)}`,
    '',
  ].join('\n'))
  return path
}

/**
 * Where one record of a session log sits.
 * @param all - the log's records, header first.
 * @param index - the record's position among them.
 * @returns the latest turn and step the log names at or before the record, and the record's index among the events, the header excluded.
 */
function positionOf(all: readonly LogRecord[], index: number): FailurePosition {
  let turn = 0
  let step = 0
  for (const record of all.slice(1, index + 1)) {
    const data = record.data as { turn?: unknown; step?: unknown } | undefined
    if (typeof data?.turn === 'number') turn = data.turn
    if (typeof data?.step === 'number') step = data.step
  }
  return { turn, step, eventIndex: index - 1 }
}

/**
 * Where a model fault landed: the first retry the session log records.
 * @param log - the root session's log, if the run persisted one.
 * @returns its position, or `null` when the log records no retry.
 */
function retryPosition(log: string | undefined): FailurePosition | null {
  if (log === undefined) return null
  const all = records(log)
  const at = all.findIndex(record => record.type === 'llm/retry')
  return at < 1 ? null : positionOf(all, at)
}

/**
 * Where a process fault landed: the last event the killed product persisted.
 * @param log - the root session's log, if the run persisted one.
 * @returns its position, or `null` when the log holds no event.
 */
function lastEventPosition(log: string | undefined): FailurePosition | null {
  if (log === undefined) return null
  const all = records(log)
  return all.length < 2 ? null : positionOf(all, all.length - 1)
}

/**
 * The reason the root session's last turn ended.
 * @param log - the root session's log, if the run persisted one.
 * @returns the reason's kind, or `undefined` when no turn ended.
 */
function lastTurnEnd(log: string | undefined): unknown {
  if (log === undefined) return undefined
  const last = records(log).filter(record => record.type === 'turn/end').at(-1)
  return (last?.data as { reason?: { kind?: unknown } } | undefined)?.reason?.kind
}

/**
 * Run one fault trial: replay the recording with its failure, resume after a
 * process fault, and judge the result.
 * @param plan - the recording and where its failures may land.
 * @param index - the trial's position in the lane; even positions inject a process fault, odd ones a model fault.
 * @param seed - the run seed.
 * @param manifest - the manifest, for the trial timeout and the prices.
 * @param composition - the directory whose patch files compose the replay.
 * @returns the trial.
 */
async function faultOnce(plan: FaultPlan, index: number, seed: number, manifest: Manifest, composition: string): Promise<Trial> {
  const { scenario, script } = plan
  const trial = trialSeed(seed, scenario.name, index)
  const kind: InjectedFault['kind'] = index % 2 === 0 ? 'process' : 'model'
  const choices = kind === 'process' ? plan.stallable : script.map((_, call) => call)
  const call = choices[Math.floor(seededRandom(trial)() * choices.length)]
  if (call === undefined) throw new Error(`benchmark fault lane: scenario ${scenario.name} has no model call to fail`)
  const workspace = prepareReplayWorkspace(scenario, composition)
  const dir = mkdtempSync(join(tmpdir(), 'dsh-benchmark-fault-'))
  try {
    const patches = [writeFaultPatch(dir)]
    const timeoutMs = manifest.trialTimeoutMs
    let first: ReplayRun
    let final: ReplayRun
    let failure: FailurePosition | null
    let fault: InjectedFault
    let what: string
    if (kind === 'model') {
      const failing: ReplayEntry = { kind: 'throw', chunks: [], message: 'benchmark fault: the provider failed before answering', code: PROVIDER_FAILURE_CODE }
      first = await launchReplay(scenario, workspace, {
        patches,
        env: { DSH_SNAPSHOT_OVERRIDE: writeScript(dir, 'model-fault.json', [...script.slice(0, call), failing, ...script.slice(call)]) },
        timeoutMs,
      })
      final = first
      failure = retryPosition(first.logs[0])
      fault = { kind, call }
      what = `a ${PROVIDER_FAILURE_CODE} provider error before call ${String(call)}: ${failure === null ? 'no retry recorded' : `retried at event ${String(failure.eventIndex)}`}`
    } else {
      const marker = join(dir, 'stalled')
      first = await launchReplay(scenario, workspace, {
        patches,
        env: { DSH_SNAPSHOT_OVERRIDE: writeScript(dir, 'stall.json', [...script.slice(0, call), { kind: 'hang', readyFile: marker }]) },
        timeoutMs,
        stall: { marker, afterMs: PERSIST_WAIT_MS },
      })
      final = first
      const killedLog = first.logs[0]
      const header = killedLog === undefined ? undefined : records(killedLog)[0]
      const sessionId = typeof header?.id === 'string' ? header.id : undefined
      const killedAt = first.killedAtStall ? lastEventPosition(killedLog) : null
      failure = killedAt
      fault = { kind, call }
      what = `a SIGKILL while call ${String(call)} stalled: the product ${first.killedAtStall ? 'was killed' : 'exited or timed out before the stall'}, so it was not resumed`
      if (killedAt !== null && sessionId !== undefined) {
        await sleep(RUN_LEASE_MS + LEASE_MARGIN_MS)
        const fromCall = plan.worldChanging.filter(changed => changed < call).at(-1) ?? call
        final = await launchReplay(scenario, workspace, {
          patches: [...patches, writeResumePatch(dir, sessionId)],
          env: { DSH_SNAPSHOT_OVERRIDE: writeScript(dir, 'resume.json', script.slice(fromCall)) },
          timeoutMs,
        })
        fault = { kind, call, resumed: { fromCall, argv: final.argv, exitCode: final.exitCode } }
        what = `a SIGKILL while call ${String(call)} stalled, after event ${String(killedAt.eventIndex)}; resumed from call ${String(fromCall)}, exit ${String(final.exitCode)}`
      }
    }
    const logs = final.logs
    const [actualWorld, expectedWorld] = await Promise.all([
      captureWorkspaceSnapshot(workspace.cwd, { ignoredRootEntries: REPLAY_RUNTIME_ENTRIES }),
      captureExpectedWorkspaceSnapshot(plan.expectedWorkspace),
    ])
    const worldMatches = canonicalJson(actualWorld) === canonicalJson(expectedWorld)
    const ended = lastTurnEnd(logs[0])
    const duplicates = duplicateSideEffectsOf(logs)
    const taskSucceeded = worldMatches && ended === 'completed'
    const normalized = normalizedLiveLogs(logs)
    return {
      scenario: scenario.name,
      seed: trial,
      launch: { argv: first.argv },
      exitCode: final.exitCode,
      sessionLogs: logs.map((raw, log) => ({ digest: sha256(normalized[log] ?? ''), rawSha256: sha256(raw) })),
      normalizedLogs: normalized,
      failure,
      fault,
      taskSucceeded,
      observation: `${what}; the last turn ended ${String(ended)}; the final workspace ${worldMatches ? 'matches' : 'differs from'} workspace.expected;`
        + ` ${String(duplicates)} idempotency key(s) applied more than once${taskSucceeded ? '' : `; stderr tail: ${final.stderrTail ?? ''}`}`,
      duplicateSideEffects: duplicates,
      tokenCost: tokenCostOf(logs, manifest.pricing),
      latencyMs: final === first ? first.latencyMs : first.latencyMs + final.latencyMs,
    }
  } finally {
    removeReplayWorkspace(workspace)
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Whether a fault trial recovered: its failure shows in the session log, and
 * then its task succeeded with no call applied twice.
 * @param trial - the trial.
 * @returns true when it recovered.
 */
function recovered(trial: Trial): boolean {
  return trial.failure !== null && trial.taskSucceeded && trial.duplicateSideEffects === 0
}

/**
 * Run the fault lane.
 * @param lane - the lane as the manifest declares it: its trial count, recordings, not-applicable metrics and known-red check date.
 * @param seed - the run seed.
 * @param manifest - the whole manifest, for the recordings, the replay composition, the trial timeout and the prices.
 * @returns the lane's report; its `knownRed` is empty.
 * @throws when the manifest gives the lane no trials, no scenarios, a recording the lane cannot fail, no known-red
 *   check date, or no reason for a metric it does not compute.
 */
export async function runFaultLane(lane: ManifestLane, seed: number, manifest: Manifest): Promise<LaneReport> {
  const scenarios = lane.scenarios ?? []
  const knownRedCheckedOn = lane.knownRedCheckedOn
  if (lane.trials === undefined || lane.trials < 1 || scenarios.length === 0 || knownRedCheckedOn === undefined) {
    throw new Error('benchmark manifest.yml: the fault lane needs a positive trials count, at least one scenario and the date its known-red list was checked')
  }
  const recordings = join(REPO_ROOT, manifest.recordings)
  const composition = join(REPO_ROOT, manifest.composition)
  // Every listed recording is planned before the first trial launches the product.
  const plans = new Map(scenarios.map(name => [name, readFaultPlan(recordings, name)]))
  const trials: Trial[] = []
  for (const [index, name] of drawScenarios(scenarios, lane.trials, seed).entries()) {
    const plan = plans.get(name)
    if (plan === undefined) throw new Error(`benchmark fault lane: no plan for ${name}`)
    trials.push(await faultOnce(plan, index, seed, manifest, composition))
  }
  const n = trials.length
  const from = (what: string): string => `${what}, over ${String(n)} trials that each replayed a recorded session through the shipped product with one injected failure`
  const metrics = laneMetrics('fault', {
    task_success: proportionMetric(trials.filter(trial => trial.taskSucceeded).length, n,
      from('the final workspace equal to the recording\'s workspace.expected and the last turn completed')),
    duplicate_side_effect: countMetric(trials.filter(trial => trial.duplicateSideEffects > 0).length, n, from(DUPLICATE_SIDE_EFFECT_SOURCE)),
    recovery_success: proportionMetric(trials.filter(recovered).length, n, from(RECOVERY_SOURCE)),
    token_cost: meanMetric(trials.map(trial => trial.tokenCost), seed, from(tokenCostSource(manifest.pricing))),
    latency: meanMetric(trials.map(trial => trial.latencyMs), seed, from('milliseconds of wall-clock time per trial, summed over its product launches')),
  }, lane.notApplicable)
  return { lane: 'fault', trials, metrics, knownRed: [], knownRedCheckedOn }
}
