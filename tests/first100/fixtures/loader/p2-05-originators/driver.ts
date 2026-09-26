/**
 * Driver for P2-05 acceptance[0]'s originator cases: one `read` of one file on
 * the SHIPPED headless profile, dispatched by the root agent itself, by a child
 * the shipped `subagent` tool delegates to, or by a child a workflow script's
 * `agent()` call starts through the shipped `workflow` tool.
 *
 * It writes the file into its working directory, boots the shipped headless
 * profile through `bootProductionProfile` with `./base.patch.yml` under
 * `danger-full-access` (so neither delegating tool waits on an approval nobody
 * answers), and pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it, with an audit sink this observation reads. It registers a keyless
 * scripted model that answers from each request's content, creates the root
 * agent after boot, and runs one turn whose task names the mode.
 *
 * It prints one `P2-05-ORIGINATORS <json>` line: every manifest any session
 * appended, with the origin of the session that appended it; every decision the
 * kernel audited for either `read` call; and every tool result's text, by
 * session origin. Sessions are collected as they are created, so a child whose
 * session has already left the live store is still read.
 * @module tests/first100/fixtures/loader/p2-05-originators/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import type { Session } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { CHILD_READ_CALL, ORIGINATOR_MODES, type OriginatorMode, READ_FILE, READ_LINE, ROOT_READ_CALL } from './shared.ts'

const PROVIDER = 'p2-05-originators-mock'

/** Text only the root agent's task carries, followed by the mode. */
const ROOT_MARKER = 'A433-ROOT'

/** Text only a delegated child's prompt carries. */
const CHILD_MARKER = 'A433-CHILD'

/** The prompt a delegated child receives, from either delegating tool. */
const CHILD_PROMPT = `${CHILD_MARKER}: read the file ${READ_FILE} once with the read tool, then stop.`

/** One appended manifest, with the origin of the session that appended it. */
interface ManifestRow {
  readonly actionId: string
  readonly origin: string
  readonly capability: string
  readonly session: string
}

/** What the driver prints. */
interface Report {
  readonly mode: OriginatorMode
  readonly manifests: readonly ManifestRow[]
  readonly decisions: readonly { readonly actionId: unknown; readonly origin: unknown; readonly effect: unknown }[]
  readonly toolResults: readonly { readonly session: string; readonly text: string }[]
}

/**
 * Whether a command-line word names a mode.
 * @param value - the word.
 * @returns true for one of {@link ORIGINATOR_MODES}.
 */
function isMode(value: string | undefined): value is OriginatorMode {
  return ORIGINATOR_MODES.some(mode => mode === value)
}

/**
 * Every user-message text in a request, joined.
 * @param options - the request the loop sent.
 * @returns the text of every user message's text blocks.
 */
function userText(options: GenerateOptions): string {
  return options.messages.flatMap(message => message.role !== 'user' ? [] : message.content.flatMap(block =>
    block.type === 'text' ? [block.text] : [])).join('\n')
}

/**
 * One scripted model answer, routed by the request's content: a request made for
 * another purpose (a session title) and any request after a tool result get
 * text; a delegated child's opening request gets its `read`; the root agent's
 * opening request gets the mode's call.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  const text = userText(options)
  if (text.includes(CHILD_MARKER)) return toolCallResponse(CHILD_READ_CALL, 'read', { file_path: READ_FILE })
  if (text.includes(`${ROOT_MARKER} native`)) return toolCallResponse(ROOT_READ_CALL, 'read', { file_path: READ_FILE })
  if (text.includes(`${ROOT_MARKER} subagent`)) {
    return toolCallResponse('a433-delegate', 'subagent', { description: 'read the file', prompt: CHILD_PROMPT, run_in_background: false })
  }
  if (text.includes(`${ROOT_MARKER} workflow`)) {
    return toolCallResponse('a433-workflow', 'workflow', {
      meta: { name: 'a433-read', description: 'read the file in one child' },
      script: `return await agent(${JSON.stringify(CHILD_PROMPT)})`,
    })
  }
  return textResponse('done')
}

/**
 * Name a session by its origin: `root` for one no delegation created.
 * @param session - one session.
 * @returns `subagent` or `root`.
 */
function sessionOrigin(session: Session): string {
  return session.header.origin ?? 'root'
}

const [configPath, mode] = process.argv.slice(2)
if (configPath === undefined || !isMode(mode)) {
  throw new Error('p2-05 originator driver requires the overlay path and a mode')
}

await writeFile(join(process.cwd(), READ_FILE), `${READ_LINE}\n`)
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

const ctx = await bootProductionProfile({
  binName: 'p2-05-originators',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
  },
})
try {
  const sessions = new Map<string, Session>()
  ctx.on('session/created', (session) => { sessions.set(String(session.id), session) })
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 24 }, () => answer)))
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
  for (const session of ctx.sessions.list()) sessions.set(String(session.id), session)
  await runFixtureTurn(ctx, { task: `${ROOT_MARKER} ${mode}: read the file ${READ_FILE}.` })
  for (const session of ctx.sessions.list()) sessions.set(String(session.id), session)
  const all = [...sessions.values()]
  const report: Report = {
    mode,
    manifests: all.flatMap(session => session.snapshotEvents().flatMap(event => event.type !== 'action/manifest-appended' ? [] : [{
      actionId: event.data.actionId,
      origin: event.data.origin,
      capability: event.data.capability,
      session: sessionOrigin(session),
    }])),
    decisions: auditEntries.flatMap((payload) => {
      const record = payload as { actionId?: unknown; origin?: unknown; decision?: { effect?: unknown } }
      return record.actionId === ROOT_READ_CALL || record.actionId === CHILD_READ_CALL
        ? [{ actionId: record.actionId, origin: record.origin, effect: record.decision?.effect }]
        : []
    }),
    toolResults: all.flatMap(session => session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : [{
      session: sessionOrigin(session),
      text: event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    }])),
  }
  process.stdout.write(`P2-05-ORIGINATORS ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
