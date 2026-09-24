/**
 * Driver for P4-05 acceptance[1]'s shipped-composition cases: an agent waiting
 * on an operator's approval.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` and the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, under `DSH_PERMISSION_MODE`
 * `workspace-write`. It registers one third-party tool that declares no risk
 * domain tags, so the base layer's risk gate classifies it by the unknown
 * default and asks an operator. The operator is this driver: an
 * `approval/request` listener that reads the agent and the model when it is
 * asked about the tool, withholds its answer for {@link HOLD_MS}, reads them
 * again, and allows the call once. It declines at once the workspace-trust
 * question the shipped headless profile asks first.
 *
 * It prints one `P4-05-WAIT <json>` line; the spec beside it judges.
 * @module tests/first100/fixtures/loader/p4-05-waiting/driver
 */

import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { holdsDispatchSlot } from '@deepseek-ai/dsh-agent'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { THIRD_PARTY_TOOL } from './shared.ts'
import type { AdapterGlobal } from './shared.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** How long the operator withholds its answer. */
const HOLD_MS = 1_000

/** A lifecycle as `holdsDispatchSlot` reads it. */
type Lifecycle = Parameters<typeof holdsDispatchSlot>[0]

/** One reading of the agent's lifecycle and of the requests the model received. */
interface Reading {
  readonly state: string | null
  readonly holdsSlot: boolean | null
  readonly stepRequests: number
  readonly sideRequests: number
}

/** One question the operator was asked. */
interface Ask {
  readonly toolName: string
  readonly atAsk: Reading
  readonly afterHold: Reading
}

/** One `action/risk-gated` record. */
interface RiskGated {
  readonly actionId: string
  readonly riskClass: string
  readonly preset: string
  readonly decision: string
}

/** What the driver prints. */
interface Report {
  readonly permissionMode: string | null
  readonly trustKernel: boolean
  readonly asks: readonly Ask[]
  readonly otherQuestions: readonly string[]
  readonly toolRunStates: readonly (string | null)[]
  readonly riskGated: readonly RiskGated[]
  readonly policyEffects: readonly unknown[]
  readonly final: Reading
}

/**
 * The model's requests so far: an agent step carries no `purpose`, a side request (a session title) does.
 * @returns the two counts.
 */
function requestCounts(): { readonly stepRequests: number; readonly sideRequests: number } {
  const requests = (globalThis as AdapterGlobal).__P4_05_WAITING_ADAPTER__?.requests ?? []
  const stepRequests = requests.filter(request => request.purpose === undefined).length
  return { stepRequests, sideRequests: requests.length - stepRequests }
}

/**
 * Read one agent's lifecycle and the model's request counts.
 * @param lifecycle - the agent's lifecycle, absent when no Run tracks it.
 * @returns the reading.
 */
function read(lifecycle: Lifecycle | undefined): Reading {
  return {
    state: lifecycle?.state ?? null,
    holdsSlot: lifecycle === undefined ? null : holdsDispatchSlot(lifecycle),
    ...requestCounts(),
  }
}

process.env.DSH_PERMISSION_MODE = 'workspace-write'

/** Every audit payload the kernel was handed, in order: the policy decisions are read here. */
const auditEntries: unknown[] = []

const ctx = await bootProductionProfile({
  binName: 'p4-05-waiting',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
  },
})
try {
  const toolRunStates: (string | null)[] = []
  ctx.tools.register(defineContentToolFixture({
    name: THIRD_PARTY_TOOL,
    description: 'a third-party tool that declares no risk domain tags and records that it ran',
    parameters: {},
    execute: () => {
      toolRunStates.push(ctx.agents.roots()[0]?.lifecycle?.state ?? null)
      return Promise.resolve([{ type: 'text' as const, text: 'third-party tool ran' }])
    },
  }))

  const asks: Ask[] = []
  const otherQuestions: string[] = []
  const answers: Promise<void>[] = []
  ctx.on('approval/request', (request) => {
    // The shipped headless profile asks once per session whether to load the
    // untrusted workspace's instruction files (`workspace-trust`). The
    // operator declines it at once, which grants nothing; only the question
    // about the third-party tool is withheld.
    if (request.toolName !== THIRD_PARTY_TOOL) {
      otherQuestions.push(request.toolName)
      return Promise.resolve('rejected' as const)
    }
    const atAsk = read(request.agent.lifecycle)
    const answer = delay(HOLD_MS).then(() => {
      asks.push({ toolName: request.toolName, atAsk, afterHold: read(request.agent.lifecycle) })
      return 'allowed-once' as const
    })
    answers.push(answer.then(() => undefined))
    return answer
  })

  const riskGated: RiskGated[] = []
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'action/risk-gated') return
    const { actionId, riskClass, preset, decision } = event.data
    riskGated.push({ actionId, riskClass, preset, decision })
  })

  await runFixtureTurn(ctx, { task: 'P4-05: call the third-party tool once.' })
  // A gate that did not wait for the answer ends the turn first; the reading
  // taken after the hold still belongs in the report.
  await Promise.all(answers)

  const report: Report = {
    permissionMode: process.env.DSH_PERMISSION_MODE ?? null,
    trustKernel: ctx.get('trustKernel') !== undefined,
    asks,
    otherQuestions,
    toolRunStates,
    riskGated,
    policyEffects: auditEntries.flatMap((payload) => {
      const decision = (payload as { readonly decision?: { readonly effect?: unknown } }).decision
      return decision === undefined ? [] : [decision.effect]
    }),
    final: read(ctx.agents.roots()[0]?.lifecycle),
  }
  process.stdout.write(`P4-05-WAIT ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
