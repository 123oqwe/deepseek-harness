#!/usr/bin/env node
/**
 * Driver for P4-05 acceptance[2] on the SHIPPED headless profile: "after a
 * restart an orphaned Agent can be reclaimed or fails safely." A restart is two
 * processes, so this driver self-orchestrates like `loader/p5-10-restart`:
 * launched once (no `P4_05_RECLAIM_PHASE`) it is the ORCHESTRATOR, and it
 * spawns itself twice as phase children over one shared `DSH_HOME`.
 *
 * - **Phase 1** boots the shipped profile, creates one session — which opens a
 *   durable Run and acquires its lease — writes `P4-05-PHASE1 {runId, epoch}`
 *   synchronously, then SIGKILLs itself with no cleanup, so the lease is left
 *   held and un-renewed, exactly what a crashed host leaves behind.
 * - The orchestrator then polls the durable lease store until phase 1's lease
 *   has actually lapsed (no hardcoded sleep), then spawns phase 2.
 * - **Phase 2** boots the shipped profile over the SAME `DSH_HOME`, creates the
 *   same session, and reports what it adopted: the restored Run count, the
 *   adopted `runId`, its lifecycle `state`/`epoch`, and whether its lease was
 *   refused.
 *
 * The orchestrator prints one `P4-05-ACC2 {phase1, phase2, lapsed}` line the
 * spec reads. The lease and Run stores are the shipped durable ones (only the
 * model provider is mocked and the lease shortened), so the spec reads one
 * shipped composition's reclaim across a real process boundary.
 * @module tests/first100/fixtures/loader/p4-05-reclaim/driver
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { openLeaseStore } from '@deepseek-ai/dsh-lease-sqlite'
import type { WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-run'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The one session both phases open; its string is also the Run's lease work item. */
const SESSION = 'p4-05-reclaim'
/** How long the orchestrator will wait for phase 1's lease to lapse before giving up. */
const LAPSE_DEADLINE_MS = 20_000
/** Pause between lease polls, so the wait is a poll rather than a fixed sleep. */
const POLL_PAUSE_MS = 50

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('p4-05 reclaim driver requires the overlay config path')
const phase = process.env.P4_05_RECLAIM_PHASE

if (phase === '1' || phase === '2') {
  const ctx = await bootProductionProfile({
    binName: 'p4-05-reclaim',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined)],
  })
  const agentLoop = ctx.get('agentLoop')
  if (agentLoop === undefined) throw new Error('p4-05 reclaim: the shipped profile mounted no agent loop')
  if (phase === '1') {
    // Phase 1 is the first launch: create the session. create() acquires the
    // Run's lease synchronously but TRACKS (does not await) the durable Run
    // write (RunPlugin.open → service.openForSession → this.track), which only
    // the disposer drains — a crash never does. So wait until the Run is DURABLE
    // before crashing, or the SIGKILL leaves an orphan that never outlived this
    // process (A-547 v1). The write is this process's own async writeFile/rename,
    // so the wait yields to the event loop — an Atomics.wait spin would block it
    // and the write would never run (A-547 v2). Poll runs.json across `await`
    // gaps, then SIGKILL with no cleanup: the lease stays held and un-renewed.
    const agent = await agentLoop.create(SessionId(SESSION), { provider: 'p4-05-reclaim-mock', model: 'p4-05-reclaim-mock' }, { cwd: process.cwd() })
    const runId = agent.runId
    if (runId === undefined) throw new Error('p4-05 reclaim phase 1: create opened no Run')
    const runsPath = dshHomePath('runs', 'runs.json')
    const persisted = (): boolean => existsSync(runsPath) && readFileSync(runsPath, 'utf8').includes(runId)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !persisted()) await new Promise<void>(resolve => setTimeout(resolve, 25))
    if (!persisted()) throw new Error(`p4-05 reclaim phase 1: Run ${runId} did not persist to ${runsPath}`)
    process.stdout.write(`P4-05-PHASE1 ${JSON.stringify({ runId, epoch: agent.lifecycle?.epoch ?? null })}\n`)
    process.kill(process.pid, 'SIGKILL')
  } else {
    // Phase 2 is the restart: RESUME the persisted session through the product
    // `--resume` entry (agentLoop.resume), the path a shipped restart takes. A
    // second create of the same id throws SessionAlreadyExistsError (A-547 v3);
    // resume loads the session and opens its Run, adopting the lapsed orphan.
    const handle = await agentLoop.resume(ctx, {
      resumeSessionId: SessionId(SESSION),
      agentOptions: { provider: 'p4-05-reclaim-mock', model: 'p4-05-reclaim-mock' },
    })
    const agent = handle.agent
    const restored = ctx.get('runs')?.service.runsForSession(SessionId(SESSION)).length ?? 0
    process.stdout.write(`P4-05-PHASE2 ${JSON.stringify({
      restored,
      runId: agent.runId ?? null,
      state: agent.lifecycle?.state ?? null,
      epoch: agent.lifecycle?.epoch ?? null,
      leaseRefused: agent.leaseRefused ?? null,
    })}\n`)
    await ctx.fiber.dispose()
  }
} else {
  // Orchestrator: two phase children over one shared DSH_HOME.
  const home = mkdtempSync(join(tmpdir(), 'p4-05-reclaim-home-'))
  const self = fileURLToPath(import.meta.url)
  const runPhase = (which: '1' | '2'): string => {
    const result = spawnSync(process.execPath, [...process.execArgv, self, configPath], {
      env: { ...process.env, DSH_HOME: home, P4_05_RECLAIM_PHASE: which },
      encoding: 'utf8',
    })
    const line = new RegExp(`P4-05-PHASE${which} (?<json>.+)`, 'u').exec(result.stdout)?.groups?.json
    if (line === undefined) throw new Error(`p4-05 reclaim phase ${which} reported nothing usable:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr.slice(-1200)}`)
    return line
  }

  const phase1 = runPhase('1')
  // Poll the durable lease until phase 1's lease has lapsed (its holder is gone
  // and no longer renewing), rather than sleeping a fixed span.
  const leaseStore = openLeaseStore(join(home, 'leases'))
  const workItem = brandString<WorkItemId>(SESSION)
  const spinner = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + LAPSE_DEADLINE_MS
  let lapsed = false
  while (Date.now() < deadline) {
    const lease = leaseStore.get(workItem)
    if (lease === undefined || lease.expiresAtMs < Date.now()) { lapsed = true; break }
    Atomics.wait(spinner, 0, 0, POLL_PAUSE_MS)
  }

  const phase2 = runPhase('2')
  process.stdout.write(`P4-05-ACC2 ${JSON.stringify({ phase1: JSON.parse(phase1) as unknown, phase2: JSON.parse(phase2) as unknown, lapsed })}\n`)
}
