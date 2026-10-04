/**
 * Driver for the BLOCKED-280 audit-approval evidence (P2-06 acceptance[2],
 * validation[2]): one real session on the SHIPPED headless profile asks twice
 * about the same tool under two action ids, and the public `dsh audit
 * approval` verb is run against the stored log for each id and for an id no
 * call has.
 *
 * It boots headless through `bootProductionProfile` with the P2-05 originator
 * overlay (keyless scripted model, session log under `./.sessions`), pins the
 * Trust Kernel as `apps/cli/src/profile-boot.ts` does, and registers a probe
 * that declares no risk domain tags, so the risk gate asks about both calls.
 * The operator allows the probe and rejects every other question. After two
 * turns it flushes the session, reads the session's own `approval/bound`
 * events as the precondition, and disposes the tree.
 *
 * It then launches the source CLI three times in the same working directory
 * and `DSH_HOME`, with the same overlay as `--patch`, so each run reads the log
 * the session wrote. A run that exits non-zero is reported as data. It prints
 * one `BLOCKED-280-AUDIT <json>` line.
 * @module tests/first100/fixtures/loader/blocked-280-audit-approval/driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  ACTION_ID_1,
  ACTION_ID_2,
  type AuditApprovalOutput,
  type AuditQueryResult,
  type BoundApproval,
  PROBE_TOOL,
  REPORT_TAG,
  type Report,
} from './shared.ts'

const PROVIDER = 'blocked-280-audit-approval-mock'

/** Text only the turns' tasks carry, followed by which call the turn makes. */
const TASK_MARKER = 'B280-CALL'

/** The source CLI entry, launched as a host user would launch `dsh`. */
const BIN = fileURLToPath(new URL('../../../../../apps/cli/src/bin.ts', import.meta.url))

/** The tsx hook, by URL, because the launch runs in a temporary directory with no `node_modules`. */
const TSX = import.meta.resolve('tsx/esm')

/** How long one `dsh audit` run may take: it boots the headless profile once. */
const AUDIT_TIMEOUT_MS = 60_000

/**
 * One scripted model answer: a turn's opening request calls the probe under
 * the action id its task names; anything else gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
const answer = (options: GenerateOptions): StreamChunk[] => {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  const task = options.messages.flatMap(message => message.role !== 'user' ? [] : message.content.flatMap(block =>
    block.type === 'text' && block.text.includes(TASK_MARKER) ? [block.text] : [])).at(-1)
  for (const actionId of [ACTION_ID_1, ACTION_ID_2]) {
    if (task?.includes(`${TASK_MARKER} ${actionId}`) === true) return toolCallResponse(actionId, PROBE_TOOL, { note: actionId })
  }
  return textResponse('done')
}

/**
 * Run `dsh audit approval` once, reporting a failed run as data.
 * @param label - which query this is.
 * @param sessionId - the session to read.
 * @param actionId - the action id to look up.
 * @param overlay - the overlay the session ran with.
 * @returns what the run printed and how it ended.
 */
function audit(label: AuditQueryResult['label'], sessionId: string, actionId: string, overlay: string): AuditQueryResult {
  const run = spawnSync(process.execPath, [
    '--import', TSX, BIN, 'audit', '--profile', 'headless', '--patch', overlay, 'approval', sessionId, actionId,
  ], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: AUDIT_TIMEOUT_MS })
  const stdoutRaw = run.stdout
  let json: AuditApprovalOutput | null = null
  try {
    const parsed: unknown = JSON.parse(stdoutRaw.trim())
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as AuditApprovalOutput
  } catch {
    // Not one JSON object on stdout (the verb absent, or a failed run): the spec reads `json: null`.
  }
  return { label, actionIdQueried: actionId, exitCode: run.status ?? -1, json, stdoutRaw, stderr: run.stderr }
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('blocked-280 audit-approval driver requires the overlay path')
const overlay = resolveConfigPath(configPath, undefined)

const ctx = await bootProductionProfile({
  binName: 'blocked-280-audit-approval',
  profile: 'headless',
  overlayPaths: [overlay],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

let sessionId: string
let boundApprovals: BoundApproval[]
try {
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a probe the risk gate asks about on every call',
    parameters: {
      note: { type: 'string', required: true, description: 'Which call this is.' },
    },
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'probe ran' }]),
  }))
  // The probe is allowed; the shipped headless profile's workspace-trust question is rejected.
  ctx.on('approval/request', request => Promise.resolve(request.toolName === PROBE_TOOL ? 'allowed-once' as const : 'rejected' as const))
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  // Created after boot, as a shipped launcher creates its root agent.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('blocked-280 audit-approval driver: no root agent after creation')
  for (const actionId of [ACTION_ID_1, ACTION_ID_2]) {
    await runFixtureTurn(ctx, { task: `${TASK_MARKER} ${actionId}: call ${PROBE_TOOL} once.` })
  }
  await ctx.sessions.flush(root.session)
  sessionId = String(root.id)
  boundApprovals = root.session.snapshotEvents().flatMap(event => event.type !== 'approval/bound' ? [] : [{
    approvalId: String(event.data.id),
    action: event.data.action,
    actionId: event.data.actionId ?? '',
  }])
} finally {
  await ctx.fiber.dispose()
}

const absentActionId = `b280-absent-${randomUUID()}`
const report: Report = {
  sessionId,
  toolName: PROBE_TOOL,
  actionId1: ACTION_ID_1,
  actionId2: ACTION_ID_2,
  absentActionId,
  boundApprovals,
  queries: [
    audit('id1', sessionId, ACTION_ID_1, overlay),
    audit('id2', sessionId, ACTION_ID_2, overlay),
    audit('absent', sessionId, absentActionId, overlay),
  ],
}
process.stdout.write(`${REPORT_TAG} ${JSON.stringify(report)}\n`)
