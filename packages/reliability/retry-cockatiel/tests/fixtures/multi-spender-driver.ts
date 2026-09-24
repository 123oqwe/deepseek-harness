#!/usr/bin/env node
/**
 * Test driver for P4-11 acceptance[1]: boot a SHIPPED profile, run scripted
 * turns in ONE session — so every resend and reconnect belongs to one Run —
 * and report what each turn asked of the model and what the run's budget
 * recorded.
 *
 * The plan arrives as JSON after the config path, so each scenario sits in the
 * spec beside what it expects. On the acp profile the session is composed by
 * `AcpSession.create`, the code `session/new` runs, with a test-owned MCP
 * server the plan kills after a named turn. Everything reported is read from
 * the live Context and the session's own log; nothing is asserted here.
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AcpSession } from '../../../../acp/acp/src/session.ts'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The route `./scripted-llm.ts` registers. */
const PROVIDER = 'p4-11-scripted'
const MCP_SERVER = fileURLToPath(new URL('./reconnect-mcp-server.mjs', import.meta.url))
const RECONNECT_WAIT_MS = 10_000
const POLL_MS = 25

/**
 * Filler that makes a task outweigh the framed summary compaction replaces it
 * with; without it compaction's shrink check refuses the summary and no
 * overflow resend happens at all.
 */
const PADDING = 'Every layer that redoes work for a run draws on that run\'s one retry budget. '.repeat(30)

/** What the spec asks this process to do. */
interface Plan {
  /** The shipped profile to boot. */
  readonly profile: 'headless' | 'acp'
  /** One entry per turn: each conversation request's scripted outcome, and whether the task carries padding. */
  readonly turns: readonly { readonly outcomes: readonly string[]; readonly padded?: boolean }[]
  /** acp only: kill the session's MCP server after this turn and wait for the supervisor's reconnect. */
  readonly dropMcpAfterTurn?: number
  /** Ask the budget for one more zero-wait retry after every other reading. */
  readonly probe?: boolean
}

/** What the session log records about one turn. */
interface TurnReading {
  readonly turn: number
  /** Conversation requests: one `assistant/attempt` or `assistant/message` each. */
  requests: number
  /** Retries `llm-retry` started. */
  retryStarted: number
  /** Compaction brackets opened in the turn. */
  compactionStarted: number
  /** Compaction brackets closed without an error. */
  compactionCompleted: number
  /** The turn's end: its kind, or the failure code when it ended in an error. */
  end: string
}

/** One MCP server process the journal names, and whether it answered `tools/list`. */
interface Generation {
  readonly pid: number
  readonly listed: boolean
}

/**
 * The task text for one turn: the script line the adapter reads, and the
 * optional padding.
 * @param turn - one-based turn number.
 * @param outcomes - each request's scripted outcome.
 * @param padded - whether to append {@link PADDING}.
 * @returns the user message text.
 */
function task(turn: number, outcomes: readonly string[], padded: boolean): string {
  const script = `P4-11 turn ${turn}: ${outcomes.join(' ')}`
  return padded ? `${script}\n${PADDING}` : script
}

/**
 * What the run the root agent holds has spent.
 * @param ctx - the booted profile.
 * @returns the run id and its usage, or `undefined` when no run or no budget is mounted.
 */
function runUsage(ctx: Context): { run: string; retriesUsed: number; delayMsUsed: number } | undefined {
  const [agent] = ctx.agents.roots()
  const run = agent === undefined ? undefined : ctx.get('runs')?.runFor(agent)
  const usage = run === undefined ? undefined : ctx.get('runRetryUsage')?.usageOf(run.id)
  return run === undefined || usage === undefined
    ? undefined
    : { run: String(run.id), retriesUsed: usage.retriesUsed, delayMsUsed: usage.delayMsUsed }
}

/**
 * Per-turn counts from the session log.
 * @param events - the session's events, excluding the header.
 * @returns one reading per turn, in turn order.
 */
function readTurns(events: readonly { type: string; data?: unknown }[]): TurnReading[] {
  const turns = new Map<number, TurnReading>()
  for (const event of events) {
    const data = event.data as {
      turn?: unknown
      error?: unknown
      reason?: { kind?: string; error?: { code?: string } }
    } | undefined
    if (typeof data?.turn !== 'number') continue
    let reading = turns.get(data.turn)
    if (reading === undefined) {
      reading = { turn: data.turn, requests: 0, retryStarted: 0, compactionStarted: 0, compactionCompleted: 0, end: 'open' }
      turns.set(data.turn, reading)
    }
    switch (event.type) {
      case 'assistant/attempt':
      case 'assistant/message':
        reading.requests += 1
        break
      case 'llm/retry-started':
        reading.retryStarted += 1
        break
      case 'compaction/start':
        reading.compactionStarted += 1
        break
      case 'compaction/end':
        if (data.error === undefined) reading.compactionCompleted += 1
        break
      case 'turn/end':
        reading.end = data.reason?.kind === 'error'
          ? (data.reason.error?.code ?? 'error')
          : (data.reason?.kind ?? 'unknown')
        break
      default:
        // Every other event type is outside what these readings count.
        break
    }
  }
  return [...turns.values()].sort((left, right) => left.turn - right.turn)
}

/**
 * Compose one ACP session the way `session/new` does, declaring the
 * test-owned MCP server as an ACP client would.
 * @param ctx - the booted acp profile.
 * @param journal - where each server process records its start and its `tools/list`.
 */
async function openAcpSession(ctx: Context, journal: string): Promise<void> {
  await AcpSession.create(ctx, {
    sessionId: SessionId(randomUUID()),
    cwd: process.cwd(),
    mcpServers: [{ name: 'p4-11-mcp', command: process.execPath, args: [MCP_SERVER, journal], env: [] }],
    agentOptions: { provider: PROVIDER, model: PROVIDER },
    fallbackSelection: { provider: PROVIDER, model: PROVIDER },
    signal: new AbortController().signal,
    notify: () => Promise.resolve(),
  })
}

/**
 * The server processes the journal names, in start order.
 * @param journal - the journal every server process appends to.
 * @returns each generation and whether it answered `tools/list`.
 */
async function generations(journal: string): Promise<Generation[]> {
  const lines = (await readFile(journal, 'utf8')).split('\n')
  const listed = new Set(lines.filter(line => line.startsWith('list ')).map(line => Number(line.slice('list '.length))))
  return lines
    .filter(line => line.startsWith('start '))
    .map(line => Number(line.slice('start '.length)))
    .map(pid => ({ pid, listed: listed.has(pid) }))
}

/**
 * Kill the session's MCP server and wait until the supervisor's reconnect has
 * a new process answering `tools/list`.
 * @param journal - the journal every server process appends to.
 * @returns both generations.
 */
async function dropMcpServer(journal: string): Promise<Generation[]> {
  const [first] = await generations(journal)
  if (first === undefined) throw new Error('the MCP server never started')
  process.kill(first.pid, 'SIGKILL')
  for (let waited = 0; waited < RECONNECT_WAIT_MS; waited += POLL_MS) {
    const seen = await generations(journal)
    if (seen[1]?.listed === true) return seen
    await delay(POLL_MS)
  }
  throw new Error(`no reconnected MCP server answered tools/list within ${RECONNECT_WAIT_MS} ms: ${JSON.stringify(await generations(journal))}`)
}

const [configPath, planJson] = process.argv.slice(2)
if (configPath === undefined || planJson === undefined) {
  throw new Error('p4-11 multi-spender driver requires a config path and a plan')
}
const plan = JSON.parse(planJson) as Plan
const journal = join(process.cwd(), 'mcp-journal.log')

const ctx = await bootProductionProfile({
  binName: 'p4-11-multi-spender',
  profile: plan.profile,
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  if (plan.dropMcpAfterTurn !== undefined) await openAcpSession(ctx, journal)
  let usageBeforeDrop: ReturnType<typeof runUsage>
  let usageAfterReconnect: ReturnType<typeof runUsage>
  let mcp: Generation[] | undefined
  for (const [index, turn] of plan.turns.entries()) {
    await runFixtureTurn(ctx, { task: task(index + 1, turn.outcomes, turn.padded === true) })
    if (index + 1 === plan.dropMcpAfterTurn) {
      usageBeforeDrop = runUsage(ctx)
      mcp = await dropMcpServer(journal)
      usageAfterReconnect = runUsage(ctx)
    }
  }
  const usage = runUsage(ctx)
  const agents = ctx.agents.roots()
  const turns = readTurns(agents.flatMap(root => root.session.snapshotEvents()))
  const [agent] = agents
  const run = agent === undefined ? undefined : ctx.get('runs')?.runFor(agent)
  // Last, because an admitted probe would charge the run: it reads the budget's
  // state, not the reason any layer stopped.
  const probe = plan.probe === true && run !== undefined ? ctx.get('runRetryUsage')?.admit(run.id, 0) : undefined
  process.stdout.write(`P4-11-MULTI ${JSON.stringify({ turns, usage, usageBeforeDrop, usageAfterReconnect, mcp, probe })}\n`)
} finally {
  await ctx.fiber.dispose()
}
