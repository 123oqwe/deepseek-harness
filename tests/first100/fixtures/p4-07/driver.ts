#!/usr/bin/env node
/**
 * Test driver for P4-07 on the SHIPPED headless profile: one agent session,
 * created after boot under a fiber of its own, whose Run a second holder
 * displaces or whose lease store fails while the lease is taken. Everything is
 * reported from the live Context, so the spec reads one process's observation
 * rather than this file's conclusion.
 *
 * `P4_07_MODE`:
 * - `displaced`: one text turn; a second holder takes the session's work item;
 *   the session ends while the Run Service stays mounted.
 * - `holder`: one text turn; the session ends while this host still holds the lease.
 * - `displaced-early`: no turn, so the Run is still `accepted`; a second holder
 *   takes the work item; the session ends while the Run Service stays mounted.
 * - `holder-unload`: one text turn; the session ends and the host unloads at
 *   once, without waiting for the Run's terminal writes; the Run is then read
 *   from the Run Service's store file.
 * - `busy-acquire`: another connection holds the lease store's RESERVED lock
 *   while the session starts, so the store's `acquire` waits out its busy
 *   timeout and throws; then one tool turn.
 * - `busy-read`: the same with an EXCLUSIVE lock, so the predecessor read throws
 *   first; then one tool turn.
 * - `healthy`: the session starts with the store free; then one tool turn.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { WorkItemId, WorkerId } from '@deepseek-ai/dsh-lease-contract'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-run'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-todo'
import { bootProductionProfile } from '../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { TOOL_TURN } from './mock-llm.ts'

const configPath = process.argv[2]
const mode = process.env.P4_07_MODE
if (configPath === undefined || mode === undefined) throw new Error('p4-07 driver requires a config path and P4_07_MODE')

const ctx = await bootProductionProfile({
  binName: 'p4-07',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})

/**
 * Create the case's agent under a fiber of its own, so disposing that fiber
 * ends this session alone and `agent/disposed` reaches the mounted Run Service.
 * @param id - the session id.
 * @returns the agent and the call that ends its session.
 */
async function startSession(id: string): Promise<{ agent: Agent; end: () => Promise<void> }> {
  let agent: Agent | undefined
  const fiber = ctx.plugin({
    name: 'p4-07-session',
    inject: ['agentLoop'],
    async apply(inner: Context) {
      agent = await inner.agentLoop.create(SessionId(id), { provider: 'p4-07-mock', model: 'p4-07-mock' }, { cwd: process.cwd() })
    },
  })
  await fiber
  if (agent === undefined) throw new Error('p4-07: the session did not start')
  return { agent, end: async () => { await fiber.dispose() } }
}

/**
 * The directory the lease store's database lives in. The shipped `lease-store`
 * row is lease-sqlite, whose instance carries its validated config; the store
 * contract the service is typed as does not name it.
 * @param store - the mounted lease store.
 * @returns the configured directory.
 */
function leaseDirectory(store: object): string {
  const config = 'config' in store ? store.config : undefined
  if (typeof config !== 'object' || config === null || !('directory' in config) || typeof config.directory !== 'string') {
    throw new Error('p4-07: the lease store carries no directory, so the shipped row is not lease-sqlite')
  }
  return config.directory
}

/**
 * Run one turn on `agent` and wait until it settles.
 * @param agent - the agent to drive.
 * @param text - the user message.
 */
async function turn(agent: Agent, text: string): Promise<void> {
  await agent.whenIdle()
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/**
 * The Run's state and transitions as the Run Service holds them.
 * @param agent - the agent whose Run to read.
 * @returns the state and `from->to` of every event, or null without a Run.
 */
function runRecord(agent: Agent): { state: string; transitions: string[] } | null {
  const run = ctx.get('runs')?.runFor(agent)
  return run === undefined ? null : { state: run.state, transitions: run.events.map(event => `${String(event.fromState)}->${event.toState}`) }
}

/**
 * Wait until `agent`'s Run record differs from `before`, or `ms` passes.
 * @param agent - the agent whose Run to read.
 * @param before - the record to compare with.
 * @param ms - the longest wait.
 * @returns the record at the end of the wait.
 */
async function recordAfter(agent: Agent, before: string, ms: number): Promise<ReturnType<typeof runRecord>> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline && JSON.stringify(runRecord(agent)) === before) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return runRecord(agent)
}

let unloaded = false
try {
  const leaseStore = ctx.get('leaseStore')
  if (leaseStore === undefined) throw new Error('p4-07: the shipped profile mounted no lease store')
  const runs = ctx.get('runs')
  if (runs === undefined) throw new Error('p4-07: the shipped profile mounted no Run Service')
  if (mode === 'displaced' || mode === 'holder' || mode === 'displaced-early') {
    const { agent, end } = await startSession(`p4-07-${mode}`)
    if (mode !== 'displaced-early') await turn(agent, 'say ok')
    const before = runRecord(agent)
    const firstEpoch = agent.lifecycle?.epoch ?? null
    let second: { acquired: boolean; epoch: number | null } | null = null
    if (mode !== 'holder') {
      const workItem = brandString<WorkItemId>(agent.id)
      const secondHost = brandString<WorkerId>('p4-07-second-host')
      const taken = leaseStore.acquire(workItem, secondHost, Date.now() + runs.config.leaseMs + 1, runs.config.leaseMs)
      second = { acquired: taken.acquired, epoch: taken.acquired ? taken.token.epoch : null }
    }
    const displacedRecord = runRecord(agent)
    const startedAt = Date.now()
    await end()
    const after = await recordAfter(agent, JSON.stringify(displacedRecord), 5000)
    process.stdout.write(`P4-07-OBSERVED ${JSON.stringify({ mode, firstEpoch, second, before, displacedRecord, after, waitedMs: Date.now() - startedAt })}\n`)
  } else if (mode === 'holder-unload') {
    const { agent, end } = await startSession('p4-07-holder-unload')
    await turn(agent, 'say ok')
    const before = runRecord(agent)
    const runId = agent.runId
    const storePath = runs.config.storePath
    await end()
    unloaded = true
    await ctx.fiber.dispose()
    const storeDocument = JSON.parse(await readFile(storePath, 'utf8')) as {
      runs: readonly { id: string; state: string; events: readonly { fromState?: string; toState: string }[] }[]
    }
    const run = storeDocument.runs.find(stored => stored.id === runId)
    const after = run === undefined ? null : { state: run.state, transitions: run.events.map(event => `${String(event.fromState)}->${event.toState}`) }
    process.stdout.write(`P4-07-OBSERVED ${JSON.stringify({ mode, before, after })}\n`)
  } else {
    const leased = ctx.agents.list().filter(agent => agent.runLease !== undefined).map(agent => agent.id)
    const lock = mode === 'healthy' ? undefined : new DatabaseSync(join(leaseDirectory(leaseStore), 'leases.sqlite'))
    lock?.exec(mode === 'busy-read' ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE')
    let session: Awaited<ReturnType<typeof startSession>>
    try {
      session = await startSession(`p4-07-${mode}`)
    } finally {
      lock?.exec('ROLLBACK')
      lock?.close()
    }
    const { agent } = session
    const leaseRow = leaseStore.get(brandString<WorkItemId>(agent.id)) !== undefined
    const precondition = { leasedBeforeStart: leased, leaseRow, run: runs.runFor(agent) !== undefined }
    await turn(agent, `${TOOL_TURN}: record one todo, then say ok`)
    const events = agent.session.snapshotEvents()
    const results = events.flatMap(event => event.type === 'tool/result'
      ? [{ isError: event.data.message.content[0]?.isError === true, error: event.data.error ?? null }]
      : [])
    const todoWrites = events.filter(event => event.type === 'todo/write').length
    process.stdout.write(`P4-07-OBSERVED ${JSON.stringify({ mode, precondition, leaseRefused: agent.leaseRefused === true, results, todoWrites })}\n`)
  }
} finally {
  if (!unloaded) await ctx.fiber.dispose()
}
