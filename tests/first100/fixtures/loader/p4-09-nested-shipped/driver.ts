/**
 * Driver for the P4-09 nested-run observations on the SHIPPED headless
 * composition (blind review 1-2; BLOCKED-312 [1] and [2] under acceptance
 * standard S3). The base layer owns the workflow worker-thread engine,
 * workflow-filesystem and the `workflow` tool; three signed saved definitions are
 * written under `$DSH_HOME/workflows` before boot, and the root agent runs one
 * `workflow` tool call per turn:
 *
 * - [2] ①: the script nests the failing definition with no declared strategy.
 * - [2] ②: the script declares `onFailure: 'continue-parent'` on the same call.
 * - [1] control: the nested start is held in flight by a gate on the engine's
 *   `startNested`, then released with no cancel.
 * - [1]: the same gated start, with the root agent cancelled while the start is
 *   held, the way a user stops a turn; the tool's abort bridge cancels the run.
 * - [1]: the root agent is cancelled while a nested run and the agent it started
 *   are live.
 *
 * The gate only delays the engine's own `startNested`; the started run is the
 * engine's. Every wait is bounded, so a case that would hang reports instead.
 * @module tests/first100/fixtures/loader/p4-09-nested-shipped/driver
 */

import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  BOOM_MESSAGE, BOOM_NAME, INFLIGHT_CHILD_PROMPT, INFLIGHT_NAME, INFLIGHT_VALUE, LIVE_CHILD_PROMPT, LIVE_NAME,
  PARENT_CONTINUED, REPORT_PREFIX, WORKFLOW_TOOL, type NestedShippedReport, type ToolOutcome,
} from './shared.ts'

const PROVIDER = 'p409s3-mock'
const TRUSTED_FP = 'sha256:p409s3-trusted-key'
/** How long a case waits for a start, a settlement or a gate before it reports what it saw. */
const BOUND_MS = 20_000

const trusted = generateKeyPairSync('ed25519')
const ROUTE = `{ provider: ${JSON.stringify(PROVIDER)}, model: ${JSON.stringify(PROVIDER)} }`
/** The saved definitions' bodies, by name. */
const BODIES: Readonly<Record<string, string>> = {
  [BOOM_NAME]: `throw new Error(${JSON.stringify(BOOM_MESSAGE)})`,
  [LIVE_NAME]: `await agent(${JSON.stringify(LIVE_CHILD_PROMPT)}, ${ROUTE}); await new Promise(() => {}); return 1`,
  [INFLIGHT_NAME]: `await agent(${JSON.stringify(INFLIGHT_CHILD_PROMPT)}, ${ROUTE}); return ${JSON.stringify(INFLIGHT_VALUE)}`,
}

/**
 * The `{ name, digest }` reference a script passes to `workflow()`.
 * @param name - a saved definition's name.
 * @param extra - fields the call adds to the reference, such as `onFailure`.
 * @returns the reference, as JSON source text.
 */
function ref(name: string, extra: Readonly<Record<string, string>> = {}): string {
  const body = BODIES[name]
  if (body === undefined) throw new Error(`no saved definition ${name}`)
  return JSON.stringify({ name, digest: String(computeDefinitionDigest(body)), ...extra })
}

/** The root agent's `workflow` script for each case, keyed by the case tag its task names. */
const SCRIPTS = {
  'fail-default': `return await workflow(${ref(BOOM_NAME)}, {})`,
  'continue-parent': `await workflow(${ref(BOOM_NAME, { onFailure: 'continue-parent' })}, {})\nreturn ${JSON.stringify(PARENT_CONTINUED)}`,
  'inflight-control': `return await workflow(${ref(INFLIGHT_NAME)}, {})`,
  'inflight-cancelled': `return await workflow(${ref(INFLIGHT_NAME)}, {})`,
  'live-cancelled': `return await workflow(${ref(LIVE_NAME)}, {})`,
} as const

/** One case. */
type CaseName = keyof typeof SCRIPTS

const CASES = Object.keys(SCRIPTS) as CaseName[]
const outerName = (name: CaseName): string => `p409s3-outer-${name}`
const callIdOf = (name: CaseName): string => `p409s3-call-${name}`

// Write the signed saved definitions BEFORE boot, so workflow-filesystem registers them at `Service.init`.
const home = join(process.cwd(), '.dsh')
process.env.DSH_HOME = home
const workflowsDir = join(home, 'workflows')
mkdirSync(workflowsDir, { recursive: true })
for (const [name, body] of Object.entries(BODIES)) {
  const digest = String(computeDefinitionDigest(body))
  writeFileSync(join(workflowsDir, `${name}.js`), body)
  writeFileSync(join(workflowsDir, `${name}.js.sig.json`), JSON.stringify({
    digest,
    publicKeyFingerprint: TRUSTED_FP,
    signature: Buffer.from(sign(null, Buffer.from(digest), trusted.privateKey)).toString('base64'),
  }))
}

/** Model requests that carried each child prompt. */
const served = { live: 0, inflight: 0 }

/**
 * The text of every text block in `blocks`.
 * @param blocks - message content blocks.
 * @returns the texts, in order.
 */
function textsIn(blocks: readonly unknown[]): string[] {
  return (blocks as readonly { readonly type: string; readonly text?: string }[])
    .flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : [])
}

/**
 * The scripted model. A nested child (its prompt carries a child sentinel) answers
 * once; the root opens each turn with the `workflow` call of the case its task
 * names, and ends the turn once the call has a result.
 * @param options - the generate request.
 * @returns the scripted chunks.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const texts = options.messages.flatMap(message => textsIn(message.content))
  if (texts.some(text => text.includes(INFLIGHT_CHILD_PROMPT))) {
    served.inflight += 1
    return textResponse('inflight child done')
  }
  if (texts.some(text => text.includes(LIVE_CHILD_PROMPT))) {
    served.live += 1
    return textResponse('live child done')
  }
  const last = options.messages.at(-1)
  if (last?.role !== 'user' || last.content.some(block => block.type === 'tool-result')) return textResponse('done')
  const task = textsIn(last.content).join('')
  const name = CASES.find(candidate => task.includes(`[${candidate}]`))
  if (name === undefined) return textResponse('no case')
  return toolCallResponse(callIdOf(name), WORKFLOW_TOOL, {
    script: SCRIPTS[name],
    meta: { name: outerName(name), description: `P4-09 nested-run case ${name}`, phases: [] },
  })
}

/**
 * Resolve to `promise`'s value, or to `fallback` once `ms` passed, without holding the process open.
 * @param promise - what to wait for.
 * @param ms - the bound.
 * @param fallback - the value when the bound passes first.
 * @returns the first of the two.
 */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => { setTimeout(() => { resolve(fallback) }, ms).unref() })])
}

/** The tool result texts the log recorded for `callId`, in order. */
function resultTextsFor(events: readonly SessionEvent[], callId: string): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-09-nested-shipped driver requires a config path')

const ctx: Context = await bootProductionProfile({
  binName: 'p4-09-nested-shipped',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      trustAnchors: [{
        mode: 'offline-signed',
        publicKeyFingerprint: TRUSTED_FP,
        owner: 'test',
        publicKeyPem: trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }],
    }))
  },
})

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 80 }, () => answer)))

  // What the engine reported, in order, by run meta name.
  const ends: { readonly name: string; readonly stopReason: string }[] = []
  const agentStarts: string[] = []
  const agentEnds: string[] = []
  const logs: { readonly name: string; readonly message: string }[] = []
  // A property, not a `let`: it is set in a listener, and the read after the turn must see the declared type.
  const live: { handle?: WorkflowRun } = {}
  const liveStarted = Promise.withResolvers<boolean>()
  const liveAgentStarted = Promise.withResolvers<boolean>()
  ctx.on('workflow/start', (info) => {
    if (info.meta.name !== LIVE_NAME || live.handle !== undefined) return
    const handle = ctx.workflowEngine.attach(info.id)
    if (handle !== undefined) live.handle = handle
    liveStarted.resolve(true)
  })
  ctx.on('workflow/agent-start', (info) => {
    agentStarts.push(info.meta.name)
    if (info.meta.name === LIVE_NAME) liveAgentStarted.resolve(true)
  })
  ctx.on('workflow/agent-end', (info) => { agentEnds.push(info.meta.name) })
  ctx.on('workflow/end', (info, result) => { ends.push({ name: info.meta.name, stopReason: result.stopReason }) })
  ctx.on('workflow/log', (info, message) => { logs.push({ name: info.meta.name, message }) })

  // The gate: the engine is the host's nesting port, so a held `startNested`
  // holds the nested start in flight exactly where `nest()` awaits it.
  interface NestingPort { readonly startNested: (request: unknown, parent: unknown) => Promise<unknown> }
  const engine = ctx.workflowEngine as unknown as NestingPort
  const startNested = (Object.getPrototypeOf(engine) as Partial<NestingPort>).startNested
  if (typeof startNested !== 'function') throw new Error('the workflow engine has no startNested to gate')
  let gate: { readonly parked: PromiseWithResolvers<boolean>; readonly release: PromiseWithResolvers<undefined> } | undefined
  const gated = async function gatedStartNested(this: NestingPort, request: unknown, parent: unknown): Promise<unknown> {
    const held = gate
    gate = undefined
    if (held !== undefined) {
      held.parked.resolve(true)
      await held.release.promise
    }
    return startNested.call(this, request, parent)
  }
  if (!Reflect.defineProperty(engine, 'startNested', { value: gated, configurable: true, writable: true })) {
    throw new Error('the workflow engine refused the startNested gate')
  }
  const openGate = (): { readonly parked: PromiseWithResolvers<boolean>; readonly release: PromiseWithResolvers<undefined> } => {
    gate = { parked: Promise.withResolvers<boolean>(), release: Promise.withResolvers<undefined>() }
    return gate
  }

  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p4-09-nested-shipped driver: no root agent')

  /**
   * Run one case's turn; `during` runs while the turn is in flight.
   * @param name - the case.
   * @param during - what the driver does while the turn runs.
   * @returns the case's `workflow` call outcome.
   */
  const runCase = async (name: CaseName, during?: () => Promise<void>): Promise<ToolOutcome> => {
    const turn = runFixtureTurn(ctx, { task: `P409S3 [${name}]: run the workflow.` })
    if (during !== undefined) await during()
    await turn
    const texts = resultTextsFor(root.session.snapshotEvents(), callIdOf(name))
    return { dispatched: texts.length > 0, resultText: (texts.at(-1) ?? '').slice(0, 1500) }
  }
  const endOf = (name: string, from: number): string => ends.slice(from).findLast(end => end.name === name)?.stopReason ?? 'none'
  const settledEnd = async (name: string, from: number): Promise<void> => {
    const deadline = Date.now() + BOUND_MS
    while (endOf(name, from) === 'none' && Date.now() < deadline) await new Promise((resolve) => { setTimeout(resolve, 50) })
  }

  const failDefault = await runCase('fail-default')

  const logsFrom = logs.length
  const continued = await runCase('continue-parent')
  const continueParent = {
    ...continued,
    parentLogs: logs.slice(logsFrom).filter(log => log.name === outerName('continue-parent')).map(log => log.message),
  }

  const controlGate = openGate()
  const controlServedFrom = served.inflight
  let controlParked = false
  const control = await runCase('inflight-control', async () => {
    controlParked = await within(controlGate.parked.promise, BOUND_MS, false)
    controlGate.release.resolve(undefined)
  })
  const inflightControl = { ...control, parked: controlParked, childServed: served.inflight - controlServedFrom }

  const cancelGate = openGate()
  const cancelServedFrom = served.inflight
  const cancelEndsFrom = ends.length
  const cancelStartsFrom = agentStarts.length
  let cancelParked = false
  await runCase('inflight-cancelled', async () => {
    cancelParked = await within(cancelGate.parked.promise, BOUND_MS, false)
    root.cancel({ kind: 'user' })
    cancelGate.release.resolve(undefined)
  })
  // A nested run that escaped the cancel keeps running after the turn; wait for
  // its end (or the bound) before counting what its body did.
  await settledEnd(INFLIGHT_NAME, cancelEndsFrom)
  const inflightCancelled = {
    parked: cancelParked,
    childServed: served.inflight - cancelServedFrom,
    nestedAgentStarts: agentStarts.slice(cancelStartsFrom).filter(name => name === INFLIGHT_NAME).length,
    parentEnd: endOf(outerName('inflight-cancelled'), cancelEndsFrom),
  }

  const liveEndsFrom = ends.length
  let nestedStarted = false
  let nestedAgentStarted = false
  await runCase('live-cancelled', async () => {
    nestedStarted = await within(liveStarted.promise, BOUND_MS, false)
    nestedAgentStarted = await within(liveAgentStarted.promise, BOUND_MS, false)
    root.cancel({ kind: 'user' })
  })
  type Settlement = Pick<WorkflowResult, 'stopReason'> | { readonly stopReason: 'did-not-settle' }
  const settledLive: Settlement = live.handle === undefined
    ? { stopReason: 'did-not-settle' }
    : await within<Settlement>(live.handle.result, BOUND_MS, { stopReason: 'did-not-settle' })
  await settledEnd(outerName('live-cancelled'), liveEndsFrom)
  const liveCancelled = {
    nestedStarted,
    nestedAgentStarted,
    nestedSettled: settledLive.stopReason,
    agentStarts: agentStarts.filter(name => name === LIVE_NAME).length,
    agentEnds: agentEnds.filter(name => name === LIVE_NAME).length,
    parentEnd: endOf(outerName('live-cancelled'), liveEndsFrom),
  }

  const report: NestedShippedReport = { failDefault, continueParent, inflightControl, inflightCancelled, liveCancelled }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  // A nested run a mutation leaves uncancelled never settles; the report is
  // already written, so a disposal it holds up must not hang the process.
  setTimeout(() => { process.exit(0) }, BOUND_MS).unref()
  await ctx.fiber.dispose()
}
