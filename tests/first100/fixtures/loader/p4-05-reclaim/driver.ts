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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
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
  // create() awaits the Run's durable put and acquires its lease before it returns.
  const agent = await agentLoop.create(SessionId(SESSION), { provider: 'p4-05-reclaim-mock', model: 'p4-05-reclaim-mock' }, { cwd: process.cwd() })
  if (phase === '1') {
    // Synchronous write, then SIGKILL with no cleanup: the lease stays held and
    // un-renewed. No `dispose`, so the lease is never handed back — a real crash.
    process.stdout.write(`P4-05-PHASE1 ${JSON.stringify({ runId: agent.runId ?? null, epoch: agent.lifecycle?.epoch ?? null })}\n`)
    process.kill(process.pid, 'SIGKILL')
  } else {
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
  process.stdout.write(`P4-05-ACC2 ${JSON.stringify({ phase1: JSON.parse(phase1), phase2: JSON.parse(phase2), lapsed })}\n`)
}
