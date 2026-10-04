/**
 * Driver for A-611 (B-729 red-first) under P4-09: on the SHIPPED headless
 * composition (base owns the workflow worker-thread engine, workflow-filesystem,
 * and the `workflow` tool), a signed saved definition is registered from
 * `$DSH_HOME/workflows`, and the keyless MockAdapter CAPTURES the model request.
 *
 * ① The captured request (the `workflow` tool's description + the system prompt)
 *    neither documents the `workflow(nameOrRef, args)` nested-run interface nor
 *    lists the registered definition's name and digest — so the model cannot
 *    discover or use a saved workflow (red today).
 * ② Control: a script the MockAdapter sends through the `workflow` tool calls
 *    `workflow({ name, digest }, {})` and runs the nested saved definition, which
 *    returns its value (green — the interface works; it is just undocumented).
 *
 * The trust anchor is pinned into the kernel in `prepare` (the loader verifies the
 * saved definition against `ctx.get('trustKernel')`), the A-600 subprocess pattern.
 * Red first for B-729 (§21.4: the fix is not read).
 * @module tests/first100/fixtures/loader/a-611-workflow-tool-visibility/driver
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { computeDefinitionDigest } from '@deepseek-ai/dsh-workflow-registry'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { NESTED_VALUE, REPORT_PREFIX, SAVED_NAME, WORKFLOW_TOOL, type VisibilityReport } from './shared.ts'

const PROVIDER = 'a611-mock'
const WF_CALL_ID = 'a611-wf-call'
const TRUSTED_FP = 'sha256:a611-trusted-key'

const trusted = generateKeyPairSync('ed25519')
/** The saved definition's body and the signature file beside it, signed over its digest. */
const DEF_BODY = `return '${NESTED_VALUE}'`
const DEF_DIGEST = computeDefinitionDigest(DEF_BODY)
const DEF_SIG = {
  digest: String(DEF_DIGEST),
  publicKeyFingerprint: TRUSTED_FP,
  signature: Buffer.from(sign(null, Buffer.from(String(DEF_DIGEST)), trusted.privateKey)).toString('base64'),
}

/** The tool result texts the log recorded for `callId`, in order. */
function resultTextsFor(events: readonly SessionEvent[], callId: string): string[] {
  return events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && String(block.toolCallId) === callId
      ? [block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')]
      : []))
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('a-611 driver requires a config path')

// Write the signed saved definition under `$DSH_HOME/workflows` BEFORE boot, so
// workflow-filesystem registers it at `Service.init`.
const home = join(process.cwd(), '.dsh')
process.env.DSH_HOME = home
const workflowsDir = join(home, 'workflows')
mkdirSync(workflowsDir, { recursive: true })
writeFileSync(join(workflowsDir, `${SAVED_NAME}.js`), DEF_BODY)
writeFileSync(join(workflowsDir, `${SAVED_NAME}.js.sig.json`), JSON.stringify(DEF_SIG))

let capturedRequest: GenerateOptions | undefined
/** The scripted model: capture the first request, then send the nested-workflow script once, then end. */
const answer = (options: GenerateOptions): StreamChunk[] => {
  if (options.purpose !== undefined) return textResponse('ok')
  capturedRequest ??= options
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn
    ? toolCallResponse(WF_CALL_ID, WORKFLOW_TOOL, {
      script: `return await workflow({ name: '${SAVED_NAME}', digest: '${String(DEF_DIGEST)}' }, {})`,
      meta: { name: 'a611-outer', description: 'runs a saved workflow nested' },
    })
    : textResponse('done')
}

const ctx: Context = await bootProductionProfile({
  binName: 'a-611-workflow-tool-visibility',
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
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'A-611: run the saved workflow.' })
  const agent = ctx.agents.list()[0]
  if (agent === undefined) throw new Error('a-611 driver: no root agent after the turn')
  const events = agent.session.snapshotEvents()
  const nestedResultText = resultTextsFor(events, WF_CALL_ID).at(-1) ?? ''
  const tools = (capturedRequest?.tools ?? []) as readonly { readonly name?: string; readonly description?: string }[]
  const workflowTool = tools.find(tool => tool.name === WORKFLOW_TOOL)
  const description = workflowTool?.description ?? ''
  const requestJson = JSON.stringify(capturedRequest ?? {})
  const report: VisibilityReport = {
    toolOffered: workflowTool !== undefined,
    // The nested-run interface is documented iff the description names `workflow(…`
    // taking a ref or a `{ name, digest }` — none of which the shipped DESCRIPTION
    // const carries today.
    descriptionMentionsNestedInterface: /workflow\s*\(\s*nameorref/iu.test(description)
      || /workflow\s*\(\s*\{?\s*name/iu.test(description)
      || /\bnameorref\b/iu.test(description),
    requestListsDefinition: requestJson.includes(SAVED_NAME) && requestJson.includes(String(DEF_DIGEST)),
    defName: SAVED_NAME,
    defDigest: String(DEF_DIGEST),
    toolWorkflowDescription: description.slice(0, 2000),
    nestedRan: nestedResultText.includes(NESTED_VALUE),
    nestedResultText: nestedResultText.slice(0, 500),
  }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
