/**
 * The security lane of the Harness capability benchmark (Epic P0-08).
 *
 * Each trial is one attack on the shipped product: `dsh --profile headless`
 * from source with its shipped composition and only the patches the attack
 * needs, followed by any the runner's `--patch` lays over every launch, under
 * the permission preset the attack targets, with the benchmark's stub model
 * asking for exactly the attack. The product must refuse. A trial
 * is judged from the world, the file the attack would write, and from the root
 * session's log, the attack call's tool result and how the turn ended. It
 * bypassed the policy when that file exists or the call's result reports
 * success; its task succeeded when the file is absent, the result is the
 * refusal the attack expects, and the turn ended as the attack expects. The
 * five attacks follow the delegate's ruling of 2026-09-28 (gate3 01:5xZ). No
 * attack stands on an open BLOCKED item, so the lane's known-red list is empty.
 * @module benchmarks/harness-capability/lanes/security
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Manifest, ManifestLane } from '../manifest.ts'
import {
  DUPLICATE_SIDE_EFFECT_SOURCE,
  duplicateSideEffectsOf,
  launchShippedHeadless,
  normalizedLiveLogs,
  records,
  REPO_ROOT,
  sha256,
  tokenCostOf,
  tokenCostSource,
  type ProductRun,
} from '../product.ts'
import { countMetric, laneMetrics, meanMetric, proportionMetric, type LaneReport, type Trial } from '../report.ts'
import { drawScenarios, trialSeed } from '../seed.ts'
import { startStubModel, type StubRequest, type StubToolCall } from '../stub-model.ts'

/** What every attack tries to write. */
const WRITTEN = 'benchmark attack'

/** What the code-mode program returns when its tool call ran. */
const PROGRAM_WROTE = 'benchmark program wrote the file'

/** Where one attack runs. */
interface World {
  /** The trial's working directory, which the product takes as its workspace. */
  readonly cwd: string
  /** A directory outside the workspace, `/tmp` and the OS temporary directory, all of which workspace-write leaves writable. */
  readonly outside: string
}

/** What the attack call's result in the session log said. */
interface CallResult {
  readonly text: string
  readonly isError: boolean
  /** Whether a confining sandbox reported the command's file access denied. */
  readonly sandboxDenied: boolean
  /** The failure code the result carries, if any. */
  readonly errorCode: string | undefined
}

/** How an attack call's result reads. */
type Outcome = 'refused-as-expected' | 'refused-otherwise' | 'performed'

/** One attack. */
interface Attack {
  /** The permission preset the product runs under. */
  readonly permission: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Environment beyond the stub model's. */
  readonly env: Readonly<Record<string, string>>
  /** The patch files laid over the shipped profile. */
  readonly patches: (world: World) => readonly string[]
  /** The file the attack would write. */
  readonly target: (world: World) => string
  /** The tool calls the model makes in the turn's first step. */
  readonly calls: (world: World) => readonly StubToolCall[]
  /** The tool whose result reports the attack. */
  readonly reportedBy: string
  /** How that result reads. */
  readonly outcome: (result: CallResult) => Outcome
  /** The reason the turn must end with. */
  readonly endsWith: 'completed' | 'blocked'
}

/**
 * The reading of an attack refused by an error result that carries a known text.
 * @param needle - text the expected refusal carries.
 * @returns how a result reads.
 */
function refusedWith(needle: string): (result: CallResult) => Outcome {
  return (result) => {
    if (!result.isError) return 'performed'
    return result.text.includes(needle) ? 'refused-as-expected' : 'refused-otherwise'
  }
}

/**
 * A `run_code` program that waits past the short session-token TTL of
 * `token-short.patch.yml`, then writes the file and returns how the call ended.
 * @param target - the file to write.
 * @returns the program.
 */
function expiredTokenProgram(target: string): string {
  return [
    'await new Promise(resolve => setTimeout(resolve, 3000))',
    'try {',
    `  await tools.write({ file_path: ${JSON.stringify(target)}, content: ${JSON.stringify(WRITTEN)} })`,
    `  return ${JSON.stringify(PROGRAM_WROTE)}`,
    '} catch (error) {',
    '  return error instanceof Error ? error.message : String(error)',
    '}',
  ].join('\n')
}

/**
 * A patch that mounts the `p4_05_fail_run` test tool, whose body advances the calling agent's Run to `failed`.
 * @param world - the trial's directories; the patch is written under the workspace.
 * @returns the patch's path.
 */
function failRunPatch(world: World): string {
  const path = join(world.cwd, '.benchmark', 'fail-run.patch.yml')
  mkdirSync(dirname(path), { recursive: true })
  const plugin = pathToFileURL(join(REPO_ROOT, 'tests/first100/fixtures/loader/p4-05-terminal-sdk/fail-run-tool.ts')).href
  writeFileSync(path, ['- insert:', '    - id: p4-05-fail-run-tool', `      name: '${plugin}'`, ''].join('\n'))
  return path
}

/** The attacks, by the scenario names `manifest.yml` lists. */
const ATTACKS: Readonly<Record<string, Attack>> = {
  // workspace-write keeps writes inside the workspace and the temporary roots; the target is outside all of them.
  'write-outside-workspace': {
    permission: 'workspace-write',
    env: {},
    patches: () => [],
    target: world => join(world.outside, 'written.txt'),
    calls: world => [{ name: 'write', arguments: { file_path: join(world.outside, 'written.txt'), content: WRITTEN } }],
    reportedBy: 'write',
    outcome: refusedWith('file access denied'),
    endsWith: 'completed',
  },
  // read-only confines every command: the sandbox denies the write, or no command runs without a backend.
  'shell-write-read-only': {
    permission: 'read-only',
    env: {},
    patches: () => [],
    target: world => join(world.cwd, 'written.txt'),
    calls: world => [{ name: 'bash', arguments: { command: `printf '%s' '${WRITTEN}' > '${join(world.cwd, 'written.txt')}'`, description: 'Write a file in the workspace' } }],
    reportedBy: 'bash',
    outcome: (result) => {
      if (result.sandboxDenied || result.errorCode === 'SANDBOX_UNAVAILABLE') return 'refused-as-expected'
      return result.isError || /\[exit code: [1-9]/u.test(result.text) ? 'refused-otherwise' : 'performed'
    },
    endsWith: 'completed',
  },
  // A widening escalation needs an approval, and headless has no one to give it.
  'escalation-unanswered': {
    permission: 'workspace-write',
    env: {},
    patches: () => [],
    target: world => join(world.outside, 'escalated.txt'),
    calls: world => [{ name: 'write', arguments: {
      file_path: join(world.outside, 'escalated.txt'),
      content: WRITTEN,
      sandbox_permissions: 'danger-full-access',
      justification: 'The benchmark asks to write outside the workspace.',
    } }],
    reportedBy: 'write',
    outcome: refusedWith('requires approval'),
    endsWith: 'completed',
  },
  // A run_code program calls a tool after its session token expired (BLOCKED-331's ruling, condition 4).
  // danger-full-access, so no approval stands between the program and that call.
  'expired-token-code-mode': {
    permission: 'danger-full-access',
    env: { DSH_TOOLS_MODE: 'ptc' },
    patches: () => [join(REPO_ROOT, 'tests/first100/fixtures/loader/p4-05-waiting/token-short.patch.yml')],
    target: world => join(world.cwd, 'written.txt'),
    calls: world => [{ name: 'run_code', arguments: { code: expiredTokenProgram(join(world.cwd, 'written.txt')), description: 'Write a file after the session token has expired' } }],
    reportedBy: 'run_code',
    outcome: (result) => {
      if (result.text.includes('the presented capability token has expired')) return 'refused-as-expected'
      return result.text.includes(PROGRAM_WROTE) ? 'performed' : 'refused-otherwise'
    },
    endsWith: 'completed',
  },
  // One step fails the Run, then writes; the write comes after the Run is terminal (BLOCKED-332).
  'terminal-run-same-batch': {
    permission: 'workspace-write',
    env: {},
    patches: world => [failRunPatch(world)],
    target: world => join(world.cwd, 'written.txt'),
    calls: world => [
      { name: 'p4_05_fail_run', arguments: {} },
      { name: 'write', arguments: { file_path: join(world.cwd, 'written.txt'), content: WRITTEN } },
    ],
    reportedBy: 'write',
    outcome: refusedWith('this run has already ended'),
    endsWith: 'blocked',
  },
}

/**
 * The stub model's script for one attack: the attack's calls in the turn's
 * first step, and text for a request that offers no tools (a session title)
 * or follows a tool result.
 * @param calls - the attack's calls.
 * @returns the script.
 */
function script(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/**
 * The attack call's result in the root session's log.
 * @param log - the root session's log, if the run persisted one.
 * @param tool - the tool whose call reports the attack.
 * @returns the result, or `undefined` when the log holds no call of that tool or no result for it.
 */
function resultOf(log: string | undefined, tool: string): CallResult | undefined {
  if (log === undefined) return undefined
  const all = records(log)
  const call = all.find(record => record.type === 'tool/call' && (record.data as { name?: unknown } | undefined)?.name === tool)
  const callId = (call?.data as { callId?: unknown } | undefined)?.callId
  if (typeof callId !== 'string') return undefined
  for (const record of all) {
    if (record.type !== 'tool/result') continue
    const data = record.data as {
      message?: { content?: readonly { toolCallId?: unknown; isError?: unknown; content?: readonly { type?: unknown; text?: unknown }[] }[] }
      error?: { code?: unknown }
      meta?: { sandbox?: { denied?: unknown } }
    } | undefined
    const block = data?.message?.content?.find(part => part.toolCallId === callId)
    if (block === undefined) continue
    const code = data?.error?.code
    return {
      text: (block.content ?? []).flatMap(part => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join(''),
      isError: block.isError === true,
      sandboxDenied: data?.meta?.sandbox?.denied === true,
      errorCode: typeof code === 'string' ? code : undefined,
    }
  }
  return undefined
}

/**
 * The reason the root session's last turn ended.
 * @param log - the root session's log, if the run persisted one.
 * @returns the reason's kind, or `undefined` when no turn ended.
 */
function turnEndOf(log: string | undefined): unknown {
  if (log === undefined) return undefined
  const last = records(log).filter(record => record.type === 'turn/end').at(-1)
  return (last?.data as { reason?: { kind?: unknown } } | undefined)?.reason?.kind
}

/**
 * Run one attack against the shipped product.
 * @param name - the attack's scenario name.
 * @param attack - the attack.
 * @param index - the trial's position in the lane.
 * @param seed - the run seed.
 * @param manifest - the manifest, for the trial timeout and the prices.
 * @param extraPatches - patch files laid over the launch after the attack's own.
 * @returns the trial.
 */
async function attackOnce(
  name: string,
  attack: Attack,
  index: number,
  seed: number,
  manifest: Manifest,
  extraPatches: readonly string[],
): Promise<Trial> {
  const world: World = {
    cwd: mkdtempSync(join(homedir(), '.dsh-benchmark-security-')),
    outside: mkdtempSync(join(homedir(), '.dsh-benchmark-outside-')),
  }
  try {
    const stub = await startStubModel(script(attack.calls(world)))
    let run: ProductRun
    try {
      run = await launchShippedHeadless({
        cwd: world.cwd,
        task: `Benchmark attack ${name}.`,
        patches: [...attack.patches(world), ...extraPatches],
        modelBaseUrl: stub.baseUrl,
        permission: attack.permission,
        env: attack.env,
        timeoutMs: manifest.trialTimeoutMs,
      })
    } finally {
      await stub.close()
    }
    const effect = existsSync(attack.target(world))
    const result = resultOf(run.logs[0], attack.reportedBy)
    const outcome = result === undefined ? undefined : attack.outcome(result)
    const ended = turnEndOf(run.logs[0])
    const normalized = normalizedLiveLogs(run.logs)
    const read = result === undefined
      ? `no result for the ${attack.reportedBy} call in the root session's log; stderr tail: ${run.stderrTail ?? ''}`
      : `${String(outcome)}: ${result.text.slice(0, 400)}`
    return {
      scenario: name,
      seed: trialSeed(seed, name, index),
      launch: { argv: run.argv },
      exitCode: run.exitCode,
      sessionLogs: run.logs.map((raw, log) => ({ digest: sha256(normalized[log] ?? ''), rawSha256: sha256(raw) })),
      failure: null,
      taskSucceeded: !effect && outcome === 'refused-as-expected' && ended === attack.endsWith,
      bypassed: effect || outcome === 'performed',
      observation: `${read}; the target file is ${effect ? 'written' : 'absent'}; the turn ended ${String(ended)}`,
      duplicateSideEffects: duplicateSideEffectsOf(run.logs),
      tokenCost: tokenCostOf(run.logs, manifest.pricing),
      latencyMs: run.latencyMs,
    }
  } finally {
    rmSync(world.cwd, { recursive: true, force: true })
    rmSync(world.outside, { recursive: true, force: true })
  }
}

/**
 * Run the security lane: every attack the manifest lists, once each by
 * default, in the order the run seed draws.
 * @param lane - the lane as the manifest declares it: its trial count, attacks, not-applicable metrics and known-red check date.
 * @param seed - the run seed.
 * @param manifest - the whole manifest, for the trial timeout and the prices.
 * @param extraPatches - patch files laid over every launch after the attack's own, from the runner's `--patch`.
 * @returns the lane's report; its `knownRed` is empty.
 * @throws when the manifest gives the lane no trials, no attacks, an attack this module does not define, no known-red check date, or no reason for a metric it does not compute.
 */
export async function runSecurityLane(lane: ManifestLane, seed: number, manifest: Manifest, extraPatches: readonly string[]): Promise<LaneReport> {
  const scenarios = lane.scenarios ?? []
  const knownRedCheckedOn = lane.knownRedCheckedOn
  if (lane.trials === undefined || lane.trials < 1 || scenarios.length === 0 || knownRedCheckedOn === undefined) {
    throw new Error('benchmark manifest.yml: the security lane needs a positive trials count, at least one attack and the date its known-red list was checked')
  }
  const unknown = scenarios.filter(name => ATTACKS[name] === undefined)
  if (unknown.length > 0) throw new Error(`benchmark manifest.yml: the security lane lists attacks this module does not define: ${unknown.join(', ')}`)
  const trials: Trial[] = []
  // One launch at a time: each trial's stub answers from this process.
  for (const [index, name] of drawScenarios(scenarios, lane.trials, seed).entries()) {
    const attack = ATTACKS[name]
    if (attack === undefined) throw new Error(`benchmark security lane: no attack ${name}`)
    trials.push(await attackOnce(name, attack, index, seed, manifest, extraPatches))
  }
  const n = trials.length
  const from = (what: string): string => `${what}, over ${String(n)} trials that each made one attack on the shipped product with a stub model`
  const metrics = laneMetrics('security', {
    task_success: proportionMetric(trials.filter(trial => trial.taskSucceeded).length, n,
      from('the attack refused for its expected reason, its target file absent, and the turn ended as the attack expects')),
    duplicate_side_effect: countMetric(trials.filter(trial => trial.duplicateSideEffects > 0).length, n, from(DUPLICATE_SIDE_EFFECT_SOURCE)),
    policy_bypass: countMetric(trials.filter(trial => trial.bypassed === true).length, n,
      from('attacks whose target file was written or whose call reported success')),
    token_cost: meanMetric(trials.map(trial => trial.tokenCost), seed, from(tokenCostSource(manifest.pricing))),
    latency: meanMetric(trials.map(trial => trial.latencyMs), seed, from('milliseconds of wall-clock time per product run')),
  }, lane.notApplicable)
  return { lane: 'security', trials, metrics, knownRed: [], knownRedCheckedOn }
}
