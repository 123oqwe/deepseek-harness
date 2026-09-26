/**
 * Driver for A-476's P2-11 case under acceptance[2] and acceptance[3]: on the
 * SHIPPED headless profile, a running session raises its permission preset
 * and then lowers it, through the `/permission` command a Web client sends.
 *
 * It boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, pins the Trust Kernel the way `apps/cli/src/profile-boot.ts`
 * pins it, and answers every approval request `rejected` after recording
 * which tool it was about. After the root agent is created it runs, through
 * `ctx.commands.execute`, `/permission danger-full-access` and then
 * `/permission read-only`, reading the session's preset after each; then one
 * turn has the model call `write`. It prints one `P2-11-PRESET <json>` line.
 * @module tests/first100/fixtures/loader/p2-11-preset-switch/driver
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-commands'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const PROVIDER = 'p2-11-preset-switch-mock'
const WRITE_CALL = 'a476-write-after-lowering'
const WRITE_FILE = 'a476-written.txt'

/**
 * One scripted model answer: a turn's opening request writes the file; any
 * other request, a session title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(WRITE_CALL, 'write', { file_path: WRITE_FILE, content: 'A-476\n' }) : textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-11 preset-switch driver requires the overlay path')

const ctx = await bootProductionProfile({
  binName: 'p2-11-preset-switch',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  const operatorAsked: string[] = []
  ctx.on('approval/request', (request) => {
    // The operator reads every request and rejects it.
    operatorAsked.push(request.toolName)
    return Promise.resolve('rejected' as const)
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
  if (root === undefined) throw new Error('p2-11 preset-switch driver: no root agent after creation')

  /**
   * Run one `/permission` line the way a Web client does, and read the session's preset after it.
   * @param line - the command line.
   * @returns the command's result and the preset afterwards.
   */
  const run = async (line: string): Promise<{ readonly result: unknown; readonly presetAfter: string }> => {
    const execution = await ctx.commands.execute(root, line, [], new AbortController().signal)
    return { result: execution?.result ?? null, presetAfter: ctx.permissionPresets.current(root.session) }
  }
  const presetBefore = ctx.permissionPresets.current(root.session)
  const askedBeforeRaise = operatorAsked.length
  const raise = await run('/permission danger-full-access')
  const askedDuringRaise = operatorAsked.slice(askedBeforeRaise)
  const lower = await run('/permission read-only')
  await runFixtureTurn(ctx, { task: 'A476: write the file once.' })

  const results = root.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
    block.type !== 'tool-result' || block.toolCallId !== WRITE_CALL ? [] : [{
      isError: block.isError ?? false,
      text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
    }]))
  process.stdout.write(`P2-11-PRESET ${JSON.stringify({
    presetBefore,
    raise,
    askedDuringRaise,
    lower,
    write: { results, written: existsSync(join(process.cwd(), WRITE_FILE)) },
    operatorAsked,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
