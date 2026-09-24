/**
 * Driver for A-385's measurement: an approved tool call whose Run was fenced,
 * or whose harness was stopped, while the operator was being asked about it.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, registers `p4_07_probe` (a tool that
 * declares no risk domain tags, so the risk gate asks about it), creates the
 * root agent after boot, and runs one turn in which the model calls the probe
 * once. `process.argv[4]` selects the dispatch path: `native` (the default)
 * or `ptc`, code mode, where the model calls `run_code` and its program makes
 * the probe call, which the operator's approval of `run_code` lets start.
 * `process.argv[3]` selects what the operator does before approving the probe:
 *
 * - `control`: nothing;
 * - `fence`: another worker takes the Run's lease over, acquiring the work
 *   item at the instant after the current lease expires, as a host that
 *   outlived the lease would;
 * - `stop`: an emergency stop, `pause-new-actions`, through the control plane.
 *
 * It prints one `P4-07-ASK <json>` line: what the operator read before and
 * after its action, whether the probe ran, the turn's tool results and risk-gate
 * decisions, and the lifecycle state after the turn.
 * @module tests/first100/fixtures/loader/p4-07-ask-window/driver
 */

import { randomUUID } from 'node:crypto'
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
import { defineContentToolFixture, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'p4-07-ask-window-mock'
/** The probe tool the model calls. */
const PROBE_TOOL = 'p4_07_probe'
/** The worker that takes the Run's lease over in the `fence` variant. */
const OTHER_WORKER = 'a385-other-host'
/** The lease term the other worker asks for. */
const TAKEOVER_LEASE_MS = 60_000

/** The three things the operator can do before approving. */
const MODES = ['control', 'fence', 'stop'] as const
type Mode = typeof MODES[number]

/** Who the emergency stop names as its requester. */
type StopRequester = Parameters<Context['controlPlane']['control']>[1]['requestedBy']

/**
 * What the dispatch gates would read for one agent at this instant.
 * @param agent - the agent whose call is waiting on the operator.
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
if (!MODES.some(known => known === mode)) throw new Error(`p4-07 ask-window driver: unknown mode ${String(mode)}`)
const selected = mode as Mode
const path = process.argv[4] ?? 'native'
if (path !== 'native' && path !== 'ptc') throw new Error(`p4-07 ask-window driver: unknown path ${path}`)
if (path === 'ptc') process.env.DSH_TOOLS_MODE = 'ptc'

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'p4-07-ask-window',
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
  let probeRuns = 0
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a third-party probe that declares no risk domain tags and records that it ran',
    parameters: {},
    execute: () => {
      probeRuns += 1
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))

  const atApproval: Record<string, unknown>[] = []
  const otherQuestions: string[] = []
  ctx.on('approval/request', (request) => {
    // The shipped headless profile asks once whether to trust the workspace;
    // the operator declines at once, which grants nothing. In code mode
    // `run_code` declares no risk domain tags, so the native gate asks about
    // the program itself; the operator allows it at once so the program can
    // make the watched call.
    if (request.toolName !== PROBE_TOOL) {
      otherQuestions.push(request.toolName)
      return Promise.resolve(request.toolName === RUN_CODE_NAME ? 'allowed-once' as const : 'rejected' as const)
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
              requestedBy: brandString<StopRequester>('a385-operator'),
              reason: 'human-requested',
              requestedAtMs: Date.now(),
            }),
          }
    }
    atApproval.push({ before, action, after: gates(agent) })
    return Promise.resolve('allowed-once' as const)
  })

  const riskGated: { readonly actionId: string; readonly decision: string }[] = []
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'action/risk-gated') riskGated.push({ actionId: event.data.actionId, decision: event.data.decision })
  })

  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error('p4-07 ask-window driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: 'A-385: call the probe once.' })

  const events = agent.session.snapshotEvents()
  process.stdout.write(`P4-07-ASK ${JSON.stringify({
    mode: selected,
    path,
    atApproval,
    otherQuestions,
    probeRan: probeRuns > 0,
    toolResults: events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ]),
    riskGated,
    lifecycleState: agent.lifecycle?.state ?? null,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
