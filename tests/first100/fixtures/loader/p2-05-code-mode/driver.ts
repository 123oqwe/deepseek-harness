/**
 * Driver for A-455's cases under P2-05 acceptance[0]: an action a code-mode
 * program originates, on the SHIPPED headless profile, passes the same
 * enforcement point as the model's own call.
 *
 * It writes one file into its working directory, sets `DSH_TOOLS_MODE=ptc`
 * and `DSH_PERMISSION_MODE=danger-full-access`, boots the SHIPPED headless
 * profile through `bootProductionProfile` with the originator cases' overlay,
 * pins the Trust Kernel the way `apps/cli/src/profile-boot.ts` pins it with an
 * audit sink this observation reads, registers a keyless scripted model, and
 * creates the root agent after boot. One turn's model calls `run_code` with a
 * program that reads the file through `tools.read`. It prints one
 * `P2-05-CODE-MODE <json>` line: every manifest the root session appended,
 * every decision the kernel audited, and the `run_code` call's result text.
 * @module tests/first100/fixtures/loader/p2-05-code-mode/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { type CodeModeReport, PROGRAM_CALL, READ_FILE, READ_LINE } from './shared.ts'

const PROVIDER = 'p2-05-code-mode-mock'

/** The program: read the file once through the tool SDK and return what the read returned. */
const PROGRAM = `const read = await tools.read({ file_path: ${JSON.stringify(READ_FILE)} })\nreturn JSON.stringify(read)`

/**
 * One scripted model answer: the turn's opening request calls `run_code`,
 * and every other request, a session title's among them, gets text.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
function answer(options: GenerateOptions): StreamChunk[] {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  return opensTurn ? toolCallResponse(PROGRAM_CALL, RUN_CODE_NAME, { code: PROGRAM, description: 'read the file once' }) : textResponse('done')
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p2-05 code-mode driver requires the overlay path')

await writeFile(join(process.cwd(), READ_FILE), `${READ_LINE}\n`)
process.env.DSH_TOOLS_MODE = 'ptc'
process.env.DSH_PERMISSION_MODE = 'danger-full-access'

/** Every audit payload the kernel was handed, in order. */
const auditEntries: unknown[] = []

const ctx = await bootProductionProfile({
  binName: 'p2-05-code-mode',
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
  if (root === undefined) throw new Error('p2-05 code-mode driver: no root agent after creation')
  await runFixtureTurn(ctx, { task: `Read the file ${READ_FILE} once from a program.` })
  const events = root.session.snapshotEvents()
  const report: CodeModeReport = {
    manifests: events.flatMap(event => event.type !== 'action/manifest-appended' ? [] : [{
      actionId: event.data.actionId,
      origin: event.data.origin,
      capability: event.data.capability,
    }]),
    decisions: auditEntries.flatMap((payload) => {
      const record = payload as { actionId?: unknown; decision?: { effect?: unknown } }
      return record.actionId === undefined ? [] : [{ actionId: record.actionId, effect: record.decision?.effect }]
    }),
    programResult: events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type === 'tool-result' && block.toolCallId === PROGRAM_CALL
        ? block.content.flatMap(part => part.type === 'text' ? [part.text] : [])
        : [])).join(''),
  }
  process.stdout.write(`P2-05-CODE-MODE ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
