/**
 * Driver for A-489 under P4-07 / BLOCKED-334 site 4: on the SHIPPED headless
 * profile at its default preset, a sandbox escalation approved after an
 * emergency stop still runs the wider-sandbox write.
 *
 * The model calls `write` to a path outside the workspace with
 * `sandbox_permissions: 'danger-full-access'` and a justification, which routes
 * through `approveEscalation` and raises one approval request. In the control
 * turn the operator approves with no stop; in the site-4 turn the operator
 * raises an emergency stop inside that escalation approval and then approves.
 * The fs write fence is in-process, so no platform sandbox executor is needed.
 * It prints one `P4-07-ESCALATION <json>` line.
 * @module tests/first100/fixtures/loader/p4-07-escalation-after-stop/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-control-plane/plugin'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p4-07-escalation-mock'
const CONTROL_CALL = 'a489-control'
const SITE4_CALL = 'a489-site4'
const TASK_MARKER = 'A489-CALL'

/** A directory outside the workspace (the loader-smoke cwd); danger-full-access writes land here. */
const outside = mkdtempSync(join(homedir(), '.a489-'))
process.on('exit', () => { rmSync(outside, { recursive: true, force: true }) })
const fileA = join(outside, 'control.txt')
const fileB = join(outside, 'site4.txt')

/**
 * One scripted model answer. Each turn's opening request escalates a write to a
 * path outside the workspace; any request after a tool result, and a session
 * title's, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  const task = options.messages.flatMap(message => message.role !== 'user' ? [] : message.content.flatMap(block =>
    block.type === 'text' && block.text.includes(TASK_MARKER) ? [block.text] : [])).at(-1)
  const escalate = { sandbox_permissions: 'danger-full-access', justification: 'the case needs to write outside the workspace' }
  if (task?.includes(`${TASK_MARKER} control`) === true) return toolCallResponse(CONTROL_CALL, 'write', { file_path: fileA, content: 'A489\n', ...escalate })
  if (task?.includes(`${TASK_MARKER} site4`) === true) return toolCallResponse(SITE4_CALL, 'write', { file_path: fileB, content: 'A489\n', ...escalate })
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p4-07 escalation driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p4-07-escalation-after-stop',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  let phase: 'control' | 'site4' = 'control'
  let stopDecision: string | null = null
  const asks: { phase: string; reason: string; outcome: string }[] = []
  ctx.on('approval/request', (request) => {
    const reason = request.reason ?? ''
    // The escalation ask carries "escalate sandbox to ..."; the site-4 turn raises a stop inside it.
    if (phase === 'site4' && reason.includes('escalate sandbox')) {
      stopDecision = JSON.stringify(ctx.controlPlane.control('pause-new-actions', {
        requestedBy: brandString<PrincipalId>('a489-operator'),
        reason: 'human-requested',
        requestedAtMs: Date.now(),
      }))
    }
    const outcome = 'allowed-once' as const
    asks.push({ phase, reason: reason.slice(0, 60), outcome })
    return Promise.resolve(outcome)
  })

  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p4-07 escalation driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} control: escalate a write outside the workspace.` })
  phase = 'site4'
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} site4: escalate a write outside the workspace.` })

  const resultText = (callId: string): string => root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type === 'tool-result' && block.toolCallId === callId ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : [])).join('')
  process.stdout.write(`P4-07-ESCALATION ${JSON.stringify({
    asks,
    stopDecision,
    control: { written: existsSync(fileA), text: resultText(CONTROL_CALL).slice(0, 120) },
    site4: { written: existsSync(fileB), text: resultText(SITE4_CALL).slice(0, 200) },
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
