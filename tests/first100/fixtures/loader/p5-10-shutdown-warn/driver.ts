/**
 * Driver for A-537 (BLOCKED-333 latter half): on the SHIPPED headless profile,
 * a settlement write that fails at shutdown reaches an operator through
 * stderr.
 *
 * It boots the shipped headless profile with `./base.patch.yml`, creates the
 * parent after boot, lets it take one turn, starts one continuable child whose
 * first request the scripted model holds open, and cancels it through
 * `interruptByParent` (the call the Web client's Stop makes) with a slow abort,
 * so the child is still resident and cancelling. It then reaches the
 * continuation registry's durable bus and replaces `commitIntake` with a
 * thrower — a test-only stand-in for a bus that cannot take the write — and
 * disposes the tree. `commitSettlementsForShutdown` then calls
 * `commitSettlement` for the resident child, the write throws, and the catch
 * logs `subagent "<child>" settlement was not committed at shutdown` through
 * `ctx.logger.warn`, which base's `logger-stderr` writes to this process's
 * stderr. The driver prints one `A537-SHUTDOWN-WARN <json>` line reporting that
 * the scenario armed (the child was resident and announced, and `commitIntake`
 * was replaced), so an absent warning cannot be mistaken for a scenario that
 * never fired.
 * @module tests/first100/fixtures/loader/p5-10-shutdown-warn/driver
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The route the driver's agents name (matches the overlay's mock). */
const PROVIDER = 'p5-10-shutdown-warn-mock'
/** The marker that makes the scripted model hold the child's first request open. */
const HOLD_MARKER = 'A537-HOLD'
/** How long the cancelled child takes to end, so it is still resident at dispose. */
const ABORT_DELAY_MS = 3_000
/** Longest wait for the child's first step. */
const FIRST_STEP_MS = 30_000
/** Polling interval. */
const POLL_MS = 25

process.env.A537_ABORT_DELAY_MS = String(ABORT_DELAY_MS)

/** The private continuation-registry members the driver reaches to arm the failure and read residency. */
interface ActivationView {
  readonly childId: string
  readonly announced: boolean
  readonly handle: { readonly agent: { readonly lifecycle?: { readonly epoch?: number } } }
}
interface BusView {
  commitIntake: (commit: unknown) => void
}
interface RegistryView {
  readonly bus?: BusView
  readonly resident: Map<string, ActivationView>
}

/**
 * Poll until `done` holds or `timeoutMs` passes.
 * @param done - the condition.
 * @param timeoutMs - the longest wait.
 * @returns whether the condition held.
 */
async function until(done: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += POLL_MS) {
    if (done()) return true
    await delay(POLL_MS)
  }
  return done()
}

/** The code a rejection carries, or its text. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('a537 shutdown-warn driver requires a config path')

const ctx: Context = await bootProductionProfile({
  binName: 'p5-10-shutdown-warn',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})

const report = (data: Record<string, unknown>): void => {
  process.stdout.write(`A537-SHUTDOWN-WARN ${JSON.stringify(data)}\n`)
}

try {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) throw new Error('a537 shutdown-warn driver: the subagent service is not mounted')
  await createFixtureRootAgent(ctx, { provider: PROVIDER, model: PROVIDER, cwd: process.cwd() })
  const [parent] = ctx.agents.roots()
  if (parent === undefined) throw new Error('a537 shutdown-warn driver: no root agent after creation')

  let childStepStarts = 0
  ctx.on('session/event', (_session, event) => { if (event.type === 'step/start') childStepStarts += 1 })
  await runFixtureTurn(ctx, { task: 'A-537: the parent takes one turn before it starts a child.' })
  const stepsAfterParent = childStepStarts

  const started = await subagents.startContinuable({
    provider: 'spawn',
    label: 'a537 shutdown-warn child',
    request: { prompt: [{ type: 'text', text: `${HOLD_MARKER}: the child holds its first turn open.` }], parent },
    signal: new AbortController().signal,
  })
  const child = started.childId
  const inFlight = await until(() => childStepStarts > stepsAfterParent, FIRST_STEP_MS)
  let interrupt: string
  try {
    subagents.interruptByParent(child, parent.id, 'continuable')
    interrupt = 'accepted'
  } catch (error: unknown) {
    interrupt = `threw: ${errorText(error)}`
  }

  // Reach the continuation registry's durable bus (the same private path the
  // p5-10-restart trace uses) and replace commitIntake with a thrower, so the
  // shutdown settlement write fails and the catch logs its warning.
  const registry = (ctx.get('subagents') as unknown as { readonly continuations?: { readonly activations?: RegistryView } }).continuations?.activations
  const bus = registry?.bus
  const resident = registry === undefined
    ? []
    : [...registry.resident.values()].map(activation => ({
      id: activation.childId,
      announced: activation.announced,
      epoch: activation.handle.agent.lifecycle?.epoch ?? null,
    }))
  let commitIntakeReplaced = false
  if (bus !== undefined) {
    bus.commitIntake = () => { throw new Error('a537: the durable bus cannot take this write') }
    commitIntakeReplaced = true
  }
  report({
    child,
    inFlight,
    interrupt,
    residentChild: resident.find(entry => entry.id === child) ?? null,
    commitIntakeReplaced,
  })
} finally {
  // Disposing the tree runs closeForShutdown -> commitSettlementsForShutdown;
  // the replaced commitIntake throws, and base's logger-stderr writes the
  // resulting warning to this process's stderr.
  await ctx.fiber.dispose()
}
