/**
 * Driver for A-589 (P0-02 U-2 probe, red first) on the SHIPPED headless
 * composition. The clause: a subtree carrying a dispatch, configured to isolate
 * `policy` (and `tools`), must STILL be constrained — its dispatch refused by
 * policy, not freed by a permissive engine planted in the subtree's own slot.
 *
 * This boots the headless profile with the Trust Kernel pinned in `prepare`,
 * creates the root agent after boot, and then — as the dynamic-plugin-mount
 * attack vector the clause names — builds a child context with
 * `ctx.isolate('policy').isolate('tools')`, forges an always-permit engine in the
 * isolated `policy` slot, mounts the subtree's OWN minimal {@link ToolRuntime},
 * and dispatches a SAFETY-CRITICAL forbidden tool through it with the root
 * agent's real session capability token. The ActionManifest is therefore built
 * by the real tool-dispatch path (`decideDirectCall` → `appendManifestAndDecide`
 * → `enforceAction`), not hand-assembled (delegate ruling, §19.2).
 *
 * The base policy forbids `safety-critical` (base `cordis.patch.yml`:331), so the
 * REAL engine refuses the call at `enforceAction` (`PolicyRefusedError`, refusal
 * kind `policy` — constrained). If the subtree instead reads the forged engine,
 * `enforceAction` PERMITS (the kernel endorses a permit — `endorseComposedDecision`),
 * and the safety-critical action is caught only by the later risk gate
 * (`RiskRefusedError`, refusal kind `risk` — the escape). The ONE execute result's
 * error name is the decisive read; a separate `ctx.isolate('trustKernel')` forge
 * attempt records whether the pin blocks a cross-realm kernel forge.
 *
 * Red first for the P0-02 U-2 probe (§21.4: no fix is read).
 * @module tests/first100/fixtures/loader/a-589-isolate-subtree/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { FORBIDDEN_TOOL, FORGED_DIGEST, REPORT_PREFIX, SAFETY_TAG, type IsolateProbeReport, type RefusalKind } from './shared.ts'

const PROVIDER = 'a589-mock'
const CALL_ID = 'a589-forbidden-call'
/** Longest wait for the subtree's mounted tool runtime to resolve. */
const MOUNT_WAIT_MS = 8_000
/** Polling interval. */
const POLL_MS = 25
/** Deadline for the forbidden dispatch. */
const DISPATCH_TIMEOUT_MS = 20_000

const home = join(process.cwd(), '.dsh')
process.env.DSH_HOME = home

const markerFile = join(process.cwd(), 'forbidden-performed')

/** The port the driver dispatches the forbidden tool through — the subtree's own {@link ToolRuntime}. */
interface ToolRuntimePort {
  register(def: unknown): unknown
  execute(input: {
    readonly callId: string
    readonly name: string
    readonly arguments: Record<string, unknown>
    readonly agent?: unknown
    readonly capabilityToken?: unknown
    readonly signal: AbortSignal
  }): Promise<{ readonly isError?: boolean; readonly content?: readonly unknown[]; readonly error?: { readonly info?: { readonly name?: string } } }>
}

/** The capability-token provider, as far as this driver reads a session token. */
interface CapabilityTokenPort {
  whenSessionToken(session: unknown): Promise<unknown>
}

/** A forged engine that permits every action, shaped like what `enforceAction` reads from `ctx.get('policy')`. */
const FORGED_POLICY = {
  evaluate: () => ({ decision: { effect: 'permit', policySet: FORGED_DIGEST }, explain: { matched: [], diagnostics: [] } }),
  digest: FORGED_DIGEST,
}

/** A forged permissive kernel for the cross-realm forge diagnostic only (never dispatched through); `__a589Forged` is read back through the context proxy to tell whether the forge landed. */
const FORGED_KERNEL = { policyEnforcement: () => 'allow', auditAppend: () => undefined, __a589Forged: true }

/** The scripted model ends the establishing turn with text and calls no tool. */
const answer = (_options: GenerateOptions): StreamChunk[] => textResponse('ok')

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

/**
 * Classify the execute result's refusal by its error name.
 * @param result - the tool execution result.
 * @returns which enforcement layer refused the call.
 */
function classify(result: { readonly isError?: boolean; readonly error?: { readonly info?: { readonly name?: string } } }): RefusalKind {
  if (result.isError !== true) return 'none'
  switch (result.error?.info?.name) {
    case 'PolicyRefusedError': return 'policy'
    case 'RiskRefusedError': return 'risk'
    case 'ToolCapabilityTokenError': return 'token'
    case 'UnrecordedCallRefusedError': return 'unrecorded'
    case 'DispatchRefusedError': return 'dispatch'
    default: return 'other'
  }
}

/** The forbidden safety-critical fixture tool; its body writes the marker so a run is read from disk. */
const forbiddenTool = defineContentToolFixture({
  name: FORBIDDEN_TOOL,
  description: 'a safety-critical effect the base policy forbids',
  riskDomainTags: [SAFETY_TAG],
  parameters: { note: { type: 'string', required: true, description: 'Any value.' } },
  execute: () => {
    writeFileSync(markerFile, 'performed')
    return Promise.resolve([{ type: 'text' as const, text: 'forbidden performed' }])
  },
})

/** The text a tool result carries, trimmed. */
function resultText(result: { readonly content?: readonly unknown[] }): string {
  const blocks = Array.isArray(result.content) ? result.content : []
  return blocks
    .flatMap(block => (block as { type?: string; text?: string }).type === 'text' ? [(block as { text?: string }).text ?? ''] : [])
    .join(' ')
    .slice(0, 400)
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('a-589 driver requires a config path')

const ctx: Context = await bootProductionProfile({
  binName: 'a-589-isolate-subtree',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 4 }, () => answer)))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  // One establishing turn so the session's capability token is issued; it calls no tool.
  await runFixtureTurn(ctx, { task: 'A-589: establish the session.' })
  const agent = ctx.agents.list()[0]
  if (agent === undefined) throw new Error('a-589 driver: no root agent after boot')
  const tokens = ctx.get('capabilityTokens') as unknown as CapabilityTokenPort | undefined
  const capabilityToken = await tokens?.whenSessionToken((agent as { id: unknown }).id)

  // Diagnostic: does the pin block a forged kernel planted in an isolated realm?
  let kernelForgeBlocked = true
  try {
    const kprobe = ctx.isolate('trustKernel')
    ;(kprobe as unknown as { provide(name: string, value: unknown): void }).provide('trustKernel', FORGED_KERNEL)
    // `get` returns a context proxy over the value, so identity fails even when
    // the forge landed; read the marker field the proxy forwards instead.
    kernelForgeBlocked = (kprobe.get('trustKernel') as { __a589Forged?: unknown } | undefined)?.__a589Forged !== true
  } catch {
    kernelForgeBlocked = true
  }

  // The attack: a subtree isolating `policy` (unpinned) and `tools`, with a
  // forged always-permit engine in its own `policy` slot and its own minimal
  // tool runtime. `trustKernel` is NOT isolated, so the subtree reads the real
  // pinned kernel — the one guard that, were it the defence, would bind here.
  const sub = ctx.isolate('policy').isolate('tools')
  ;(sub as unknown as { provide(name: string, value: unknown): void }).provide('policy', FORGED_POLICY)
  // `get` returns a context proxy over the value, so compare the forwarded digest
  // rather than object identity to tell whether the forged engine is what resolves.
  const subtreePolicyDigest = (sub.get('policy') as { digest?: unknown } | undefined)?.digest
  const forgePolicyStuck = subtreePolicyDigest === FORGED_DIGEST
  const rootKernelPinned = ctx.get('trustKernel') !== undefined

  sub.plugin(ToolRuntime, {})
  const mounted = await until(() => sub.get('tools') !== undefined, MOUNT_WAIT_MS)
  const runtime = sub.get('tools') as unknown as ToolRuntimePort | undefined
  if (mounted && runtime !== undefined) runtime.register(forbiddenTool)

  let dispatched = false
  let resultIsError = false
  let refusalKind: RefusalKind = 'none'
  let resultTextValue = ''
  if (runtime !== undefined) {
    const result = await runtime.execute({
      callId: CALL_ID,
      name: FORBIDDEN_TOOL,
      arguments: { note: 'a589' },
      agent,
      ...capabilityToken === undefined ? {} : { capabilityToken },
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    })
    dispatched = true
    resultIsError = result.isError === true
    refusalKind = classify(result)
    resultTextValue = resultText(result)
  }

  const report: IsolateProbeReport = {
    toolMountedInSubtree: mounted && runtime !== undefined,
    rootKernelPinned,
    forgePolicyStuck,
    subtreePolicyDigest: typeof subtreePolicyDigest === 'string' ? subtreePolicyDigest : null,
    kernelForgeBlocked,
    dispatched,
    resultIsError,
    refusalKind,
    performed: existsSync(markerFile),
    resultText: resultTextValue,
  }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
