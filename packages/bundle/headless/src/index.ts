/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry, drives the task to quiescence,
 * streams provider reasoning to stderr, flushes its Session, prints the final
 * assistant text to stdout, and exits.
 *
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { hostUserIdentity } from '@deepseek-ai/dsh-host-user-id'
import { RunId } from '@deepseek-ai/dsh-principal/types'
import { exitStatusFor } from './scriptability.ts'
import { resolveModelSelection } from './model-selection.ts'
import { OUTPUT_FORMATS, renderLine } from './stream-json.ts'
import type { OutputFormat } from './stream-json.ts'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { duringJobDrain, isTerminalJobStatus } from '@deepseek-ai/dsh-jobs'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
  /**
   * Continue an existing session instead of creating one (Epic P9-06 must[0]).
   *
   * The session layer already owns what resuming MEANS — replaying a persisted
   * log and continuing from its end — so this carries the id and nothing else.
   * A headless-specific notion of resume would be a second answer to a question
   * `ctx.agents.resume` has already answered, and the two would diverge the
   * first time either changed.
   */
  resumeSessionId?: string
  /**
   * `--model <provider:model>` as typed, or absent to use the configured
   * default (Epic P9-03 must[0]).
   *
   * Unparsed here for the same reason the startup provider does not parse it:
   * the routes it is checked against exist only after the application settles.
   */
  model?: string
  /**
   * How stdout is written (Epic P9-06 must[1]); `text` when absent.
   *
   * Validated here rather than defaulted: an unknown value must fail rather
   * than fall back, because a script that asked for JSON and silently received
   * prose parses the wrong thing without noticing.
   */
  outputFormat?: OutputFormat
  /**
   * How long the run waits, in milliseconds, for background jobs it started
   * that have not settled when the agent goes idle (default 30s; `0` does not
   * wait at all).
   *
   * A one-shot run should deliver the work it started: without a wait its
   * agent goes idle, the process leaves, and the registry's teardown marks
   * every remaining job reported with nobody to read it (BLOCKED-220). The
   * bound is deployment-varying — how long a caller's wall clock may be held
   * for work it did not ask to wait for is not a property of this code — so it
   * is a config field rather than a constant, and `0` stays expressible for a
   * caller that wants the old behaviour.
   *
   * The bound stops the WAIT and never the job: expiry cancels nothing, and
   * the jobs still running are recorded exactly as they are without one.
   */
  waitForJobsMs?: number
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
  resumeSessionId: z.string(),
  model: z.string(),
  outputFormat: z.union(OUTPUT_FORMATS.map(format => z.const(format))),
  waitForJobsMs: z.number().min(0).default(30_000),
})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  /**
   * Model usage summed over the interval, absent when none was recorded.
   *
   * Summed per (turn, step) rather than per usage chunk: a step may report
   * usage more than once as a request is retried, and the last report for a
   * step is that step's total rather than an increment to add.
   */
  usage: TokenUsage | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(session: Session, firstSeq: SessionLogOffset): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  const usageByStep = new Map<string, TokenUsage>()
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) {
      throw new Error(`headless summary cannot read seq ${String(seq)} below captured length ${String(length)}`)
    }
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      usageByStep.set(`${String(event.data.turn)}/${String(event.data.step)}`, event.data.chunk.usage)
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason, usage: totalUsage([...usageByStep.values()]) }
}

/**
 * Sum per-step usage into one run total.
 * @param steps - the last usage report from each step of the interval.
 * @returns the total, or `undefined` when no step reported any.
 */
function totalUsage(steps: readonly TokenUsage[]): TokenUsage | undefined {
  const first = steps[0]
  if (first === undefined) return undefined
  const total: TokenUsage = { inputTokens: 0, outputTokens: 0 }
  for (const step of steps) {
    total.inputTokens += step.inputTokens
    total.outputTokens += step.outputTokens
    // Optional counters stay absent unless some step reported them, so a run
    // on a provider that reports none does not gain three zeros that read as
    // "measured, and zero".
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const) {
      if (step[key] !== undefined) total[key] = (total[key] ?? 0) + step[key]
    }
  }
  return total
}

/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * appended, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the Session event feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(
  ctx: Context,
  agent: Agent,
  stderr: HeadlessIo['stderr'],
): () => void {
  let started = false
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      close()
      started = true
      return
    }
    if (!started || event.type !== 'assistant/chunk') return
    const chunk = event.data.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('dsh: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'headless reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param task - one-shot task text.
 * @param io - process-facing effects.
 */
async function run(
  ctx: Context,
  task: string,
  io: HeadlessIo,
  resumeSessionId?: string,
  model?: string,
  outputFormat: OutputFormat = 'text',
  waitForJobsMs = 30_000,
): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  // Resolved HERE rather than while parsing the command line: `--model` names
  // a registered route, and no adapter has mounted until the settlement above
  // completes. A rejection throws, which `apply`'s catch turns into a stderr
  // line and exit 1 — the run never falls back to the default route, because a
  // task answered by a model the caller did not ask for is indistinguishable
  // from one that was (Epic P9-03 must[0]).
  const selection = model === undefined
    ? defaultModel.currentSelection()
    : resolveModelSelection(model, (ctx.get('llm')?.listProviders() ?? []).map(({ id }) => id))
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  // Resuming and creating differ only in which registry call is made; every
  // step after this point — the prompt, the idle wait, the summary, the exit
  // code — is identical, because a resumed run is the same run with a longer
  // history rather than a different kind of run.
  const { agent } = resumeSessionId !== undefined
    ? await agents.resume({
      resumeSessionId: brandString<SessionId>(resumeSessionId),
      // A resumed session is the same host user acting again, in a NEW run:
      // `resolveSessionIdentity` compares what this run supplies against what
      // the session already recorded and logs only a real difference, so
      // re-supplying the same principal appends nothing.
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
        identity: hostUserIdentity(RunId(`run-${randomUUID()}`)),
      },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    : await agents.create({
      sessionId: brandString<SessionId>(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      // P2-01 acceptance[0]: the host user this harness home belongs to, so the
      // action manifests this run writes name a real actor. Without it both
      // dispatch paths synthesize an `anonymous-dev` principal named after the
      // session, and nothing this run does traces to a person (BLOCKED-200).
      // This launcher is one of exactly two root creation sites a LOCAL host
      // user drives; ACP, the SDK server and webhook ingress deliberately
      // attach nothing, because a request arriving over a socket is not the
      // machine's host user.
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
        identity: hostUserIdentity(RunId(`run-${randomUUID()}`)),
      },
      setup: (agentCtx) => {
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  // Subscribed BEFORE the prompt is submitted, so a long run's consumer reads
  // events as they happen instead of receiving the whole log at exit. Replaying
  // the log afterwards would produce the same bytes for a short run and would
  // silently stop being a stream for the runs that need one.
  const stopStream = outputFormat === 'stream-json'
    ? ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.seq >= firstSeq) {
        io.stdout.write(renderLine({ type: 'session_event', sessionId: session.id, event }))
      }
    })
    : undefined
  // Reasoning goes to stderr in every format: in a machine-readable run it must
  // not interleave with the lines a consumer is parsing on stdout.
  const stopReasoning = streamReasoning(ctx, agent, io.stderr)
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
  } finally {
    stopReasoning()
  }
  await drainJobs(ctx, agent, waitForJobsMs)
  recordAbandonedJobs(ctx, agent, io.stderr)
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session, firstSeq)
  stopStream?.()
  if (outputFormat === 'text') {
    io.stdout.write(outcome.text + '\n')
  } else {
    io.stdout.write(renderLine({
      type: 'result',
      sessionId: agent.session.id,
      output: outcome.text,
      ...outcome.usage === undefined ? {} : { usage: outcome.usage },
    }))
  }
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  // P9-06 must[3]: each failure class exits with its own code, so a script can
  // branch on blocked-versus-error without parsing stdout. The typed reason goes
  // to stderr for the same purpose -- a caller that reads neither still gets a
  // non-zero exit, and one that reads stderr does not have to map codes back.
  const status = exitStatusFor(outcome.reason)
  if (status.failure !== undefined) io.stderr.write(`dsh: run did not complete: ${status.failure}\n`)
  io.exit(status.exitCode)
}

/**
 * Wait, at most `boundMs`, for the background jobs this agent had running when
 * its turn ended.
 *
 * Settlement is observed through `onJobDone` rather than `jobs.wait(...)`, and
 * the difference is the whole point: a registered waiter makes the registry
 * mark the job reported, which SUPPRESSES the completion notice
 * (`jobs-local`'s `settle` sets `reported` whenever `waiters > 0`, and `wait`
 * marks it again on return). Draining through `wait` would therefore guarantee
 * the model never sees the result the drain exists to deliver. An observer
 * registers no waiter, so `tool-jobs` delivers normally.
 *
 * The set is the one read at this instant, not "until nothing is running": a
 * completion that wakes a turn which starts another job must not extend the
 * wait forever. One deadline covers both the settlements and the turn any of
 * them opened.
 * @param ctx - plugin context, whose `jobs` service is optional.
 * @param agent - the agent whose owned jobs are drained.
 * @param boundMs - the wait bound in milliseconds; `0` returns immediately.
 */
async function drainJobs(ctx: Context, agent: Agent, boundMs: number): Promise<void> {
  const jobs = ctx.get('jobs')
  if (jobs === undefined || boundMs <= 0) return
  const pending = new Set(jobs.list(agent).filter(job => !isTerminalJobStatus(job.status)).map(job => String(job.id)))
  if (pending.size === 0) return
  const deadline = new Promise<void>(resolve => setTimeout(resolve, boundMs).unref())
  await duringJobDrain(agent, async () => {
    const settled = new Promise<void>((resolve) => {
      const stop = jobs.onJobDone((snapshot) => {
        pending.delete(String(snapshot.id))
        if (pending.size === 0) {
          stop()
          resolve()
        }
      })
      void deadline.then(stop)
    })
    await Promise.race([settled, deadline])
    // A settlement may have opened a turn; the same deadline covers it, because
    // a run that waited for its jobs and then printed before their answer
    // arrived would have waited for nothing.
    await Promise.race([agent.whenIdle(), deadline])
  })
}

/**
 * The stderr line one abandoned job produces.
 *
 * Exported because the recorded-session harness projects expected stderr from
 * the session log alone; a second spelling of this sentence there would drift
 * from this one without anything noticing.
 * @param jobId - the registry-issued id the model was told to track.
 * @param status - the job's non-terminal status when the run ended.
 * @returns the complete line, newline included.
 */
export function abandonedJobLine(jobId: string, status: string): string {
  return `dsh: background job ${jobId} was still ${status} when the run ended; its output was not collected\n`
}

/**
 * Record the background jobs this agent started and never collected.
 *
 * A one-shot run ends when the agent goes idle, which a live job is not part
 * of: the process leaves and the registry's teardown marks every remaining job
 * reported without anyone reading it (`jobs-local`'s `cancelForTeardown`). The
 * loss is the product's to own; recording it here is what keeps it from being
 * silent. Called before the session is flushed and summarized, because after
 * that point the run's output is already written.
 *
 * Nothing here reaches the model: the abandoned set is an operator fact about
 * a run that already produced its answer.
 * @param ctx - plugin context, whose `jobs` service is optional.
 * @param agent - the agent whose owned jobs are read.
 */
function recordAbandonedJobs(ctx: Context, agent: Agent, stderr: HeadlessIo['stderr']): void {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) return
  const live = jobs.list(agent).filter(job => !isTerminalJobStatus(job.status))
  if (live.length === 0) return
  for (const job of live) {
    // `status` is narrowed by the filter above: the two non-terminal values are
    // the ones the event declares.
    agent.session.append('job/abandoned', {
      jobId: String(job.id),
      status: job.status as 'running' | 'stopping',
      surface: 'headless',
    })
    stderr.write(abandonedJobLine(String(job.id), job.status))
  }
  ctx.logger('headless').warn(
    `run ended with ${String(live.length)} background job(s) still running; their output was never collected: ${live.map(job => `${String(job.id)} (${job.status})`).join(', ')}`,
  )
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(
    ctx,
    config.task,
    io,
    config.resumeSessionId,
    config.model,
    config.outputFormat,
    config.waitForJobsMs,
  ).catch((error: unknown) => { fail(io, error) })
}
