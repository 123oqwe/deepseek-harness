/**
 * Driver for BLOCKED-334's fourth site: a sandbox escalation the operator is
 * asked about inside the bash tool's body, while the Run is fenced or stopped.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, creates the root agent after boot,
 * and runs one turn in which the model calls `bash` twice: a confined `echo`,
 * then a command that writes `a392-marker.txt` and asks to escalate to
 * `danger-full-access`. `process.argv[3]` selects what the operator does
 * before approving the escalation:
 *
 * - `control`: nothing;
 * - `fence`: another worker takes the Run's lease over, acquiring the work
 *   item at the instant after the current lease expires;
 * - `stop`: an emergency stop, `pause-new-actions`, through the control plane.
 *
 * Any other question about `bash` is allowed at once, and every other question
 * is declined. It prints one `A392-ESC <json>` line: the first call's result
 * (whether the sandbox runner works), what the operator read before and after
 * its action, whether the marker file exists, the turn's tool results, and
 * every question asked.
 * @module tests/first100/fixtures/loader/sandbox-escalation-window/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { stopGateFor, type Agent } from '@deepseek-ai/dsh-agent'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
import type { WorkerId } from '@deepseek-ai/dsh-lease-contract'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'sandbox-escalation-window-mock'
/** The file the escalated command writes, relative to the session's working directory. */
const MARKER_FILE = 'a392-marker.txt'
/** How the escalation's approval request states its reason (`dsh-sandbox`'s `approveEscalation`). */
const ESCALATION_REASON = 'escalate sandbox to '
/** The worker that takes the Run's lease over in the `fence` variant. */
const OTHER_WORKER = 'a392-other-host'
/** The lease term the other worker asks for. */
const TAKEOVER_LEASE_MS = 60_000

/** The three things the operator can do before approving. */
const MODES = ['control', 'fence', 'stop'] as const
type Mode = typeof MODES[number]

/** Who the emergency stop names as its requester. */
type StopRequester = Parameters<Context['controlPlane']['control']>[1]['requestedBy']

/**
 * What the dispatch gates would read for one agent at this instant.
 * @param agent - the agent whose escalation is waiting on the operator.
 * @returns the lease's write admission, the stop gate and the lifecycle.
 */
function gates(agent: Agent): Record<string, unknown> {
  return {
    mayWrite: agent.runLease?.mayWrite(Date.now()) ?? null,
    stopGate: stopGateFor(agent),
    lifecycle: agent.lifecycle?.state ?? null,
    epoch: agent.runLease?.token.epoch ?? null,
  }
}

const mode = process.argv[3]
if (!MODES.some(known => known === mode)) throw new Error(`sandbox-escalation-window driver: unknown mode ${String(mode)}`)
const selected = mode as Mode

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'sandbox-escalation-window',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: () => undefined,
    }))
  },
})
try {
  const atEscalation: Record<string, unknown>[] = []
  const questions: { readonly toolName: string; readonly reason: string | null }[] = []
  ctx.on('approval/request', (request) => {
    questions.push({ toolName: request.toolName, reason: request.reason ?? null })
    if (request.reason?.startsWith(ESCALATION_REASON) !== true) {
      // The risk gate may ask about `bash` itself; the operator allows it so
      // the escalation inside the body is reached. The shipped headless profile
      // also asks whether to trust the workspace; declining grants nothing.
      return Promise.resolve(request.toolName === 'bash' ? 'allowed-once' as const : 'rejected' as const)
    }
    const agent = request.agent
    const before = gates(agent)
    let action: Record<string, unknown> = { mode: selected }
    if (selected === 'fence') {
      const lease = agent.runLease
      const store = ctx.get('leaseStore')
      if (lease === undefined || store === undefined) {
        action = { ...action, unavailable: lease === undefined ? 'no run lease' : 'no lease store' }
      } else {
        const current = store.get(lease.token.workItem)
        const at = (current?.expiresAtMs ?? Date.now()) + 1
        const taken = store.acquire(lease.token.workItem, brandString<WorkerId>(OTHER_WORKER), at, TAKEOVER_LEASE_MS)
        action = taken.acquired
          ? { ...action, acquired: true, newEpoch: taken.token.epoch, newHolder: taken.token.holder }
          : { ...action, acquired: false, reason: taken.reason }
      }
    } else if (selected === 'stop') {
      const controlPlane = ctx.get('controlPlane')
      action = controlPlane === undefined
        ? { ...action, unavailable: 'no control plane' }
        : {
            ...action,
            decision: controlPlane.control('pause-new-actions', {
              requestedBy: brandString<StopRequester>('a392-operator'),
              reason: 'human-requested',
              requestedAtMs: Date.now(),
            }),
          }
    }
    atEscalation.push({ before, action, after: gates(agent) })
    return Promise.resolve('allowed-once' as const)
  })

  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once every row is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error('sandbox-escalation-window driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A-392: run the two bash commands.' })

  const toolResults = agent.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
  process.stdout.write(`A392-ESC ${JSON.stringify({
    mode: selected,
    confinedResult: toolResults[0] ?? null,
    escalatedResult: toolResults[1] ?? null,
    atEscalation,
    markerWritten: existsSync(join(process.cwd(), MARKER_FILE)),
    toolResults,
    questions,
    lifecycleState: agent.lifecycle?.state ?? null,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
