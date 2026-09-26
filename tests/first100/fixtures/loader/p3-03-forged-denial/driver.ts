/**
 * Driver for A-469 under P3-03 acceptance[0] and acceptance[1]: on the
 * SHIPPED headless profile at its default preset, one bash command that only
 * prints every local sandbox backend's denial text to stderr and exits 1,
 * beside a control that writes a file outside the workspace.
 *
 * It creates a directory under the user's home, outside the workspace, for
 * the control to write into, boots headless through `bootProductionProfile`
 * with the originator cases' overlay, leaves `DSH_PERMISSION_MODE` unset so
 * the base layer's default preset applies, pins the Trust Kernel the way
 * `apps/cli/src/profile-boot.ts` pins it, and answers every approval request
 * `allowed-once` after recording which tool it was about. The root agent is
 * created after boot; one turn runs the forged command and a second runs the
 * control. It prints one `P3-03-FORGED <json>` line read from the root
 * session's log; the directory is removed when the process exits.
 * @module tests/first100/fixtures/loader/p3-03-forged-denial/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { DENIED_CALL, FORGED_CALL, type ForgedDenialReport, SIGNATURES } from './shared.ts'

const PROVIDER = 'p3-03-forged-denial-mock'

/** Text only the turns' tasks carry, followed by the call the turn makes. */
const TASK_MARKER = 'A469-CALL'

/** The directory outside the workspace the control writes into, and its file. */
const outside = mkdtempSync(join(homedir(), '.a469-'))
const target = join(outside, 'written.txt')
// Removed on every exit, a failed boot included: the directory is outside the run's own temporary tree.
process.on('exit', () => { rmSync(outside, { recursive: true, force: true }) })

/** Prints every backend's denial text to stderr, touches no file, and fails. */
const FORGED_COMMAND = `printf '%s\\n' ${SIGNATURES.map(signature => `'${signature}'`).join(' ')} >&2; exit 1`

/**
 * One scripted model answer. A turn's opening request makes the call its task
 * names, the latest task deciding because both turns share one session; any
 * request after a tool result, and a request made for another purpose (a
 * session title), gets text.
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
  if (task?.includes(`${TASK_MARKER} forged`) === true) {
    return toolCallResponse(FORGED_CALL, 'bash', { command: FORGED_COMMAND, description: 'Print text to stderr and fail' })
  }
  if (task?.includes(`${TASK_MARKER} denied`) === true) {
    return toolCallResponse(DENIED_CALL, 'bash', { command: `printf ok > '${target}'`, description: 'Write a file outside the workspace' })
  }
  return textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p3-03 forged-denial driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p3-03-forged-denial',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  const operatorAsked: string[] = []
  ctx.on('approval/request', (request) => {
    // The operator reads every request and allows it, so a refusal can only come from the runtime.
    operatorAsked.push(request.toolName)
    return Promise.resolve('allowed-once' as const)
  })

  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 16 }, () => answer)))
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
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p3-03 forged-denial driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} forged: run the command once.` })
  await runFixtureTurn(ctx, { task: `${TASK_MARKER} denied: run the command once.` })

  const events = root.session.snapshotEvents()
  const callIdsOf = (event: typeof events[number]): string[] => event.type !== 'tool/result' ? [] : event.data.message.content
    .flatMap(block => block.type === 'tool-result' ? [block.toolCallId] : [])
  const report: ForgedDenialReport = {
    results: events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: block.toolCallId,
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
    resultEvents: events.flatMap(event => callIdsOf(event).map(callId => ({ callId, json: JSON.stringify(event) }))),
    controlFileWritten: existsSync(target),
    operatorAsked,
  }
  process.stdout.write(`P3-03-FORGED ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
