/**
 * Driver for B-668's cases, the P2-06 red first (BLOCKED-318): acceptance[0]
 * as C19 narrowed it, acceptance[1] and acceptance[2], on the SHIPPED headless
 * profile, for an approved action whose declared file is left alone, rewritten
 * or created between the ask and the execution.
 *
 * It changes into the working directory the spec shares between both modes,
 * boots headless through `bootProductionProfile` with the originator cases'
 * overlay, leaves `DSH_PERMISSION_MODE` unset so the base layer's default
 * preset applies, sets `DSH_TOOLS_MODE=ptc` first in code mode, and pins the
 * Trust Kernel the way `apps/cli/src/profile-boot.ts` does. It registers a
 * probe that names the file it acts on in `presentCall().locations` and
 * declares no risk domain tags, so the risk gate asks about every call. The
 * operator rejects the workspace-trust question and allows `run_code`; for a
 * probe call it records what it was shown, rewrites a `changed` file or creates
 * a `created` one, and then allows the call.
 *
 * `native` runs one turn per file (unchanged, changed, created); `code-mode`
 * runs one turn whose `run_code` program calls the probe on the unchanged file
 * and then on the changed one. It prints one `P2-06-PRECONDITION <json>` line.
 * @module tests/first100/fixtures/loader/p2-06-approval-precondition/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import {
  type FileKind,
  PRECONDITION_MODES,
  type PreconditionMode,
  type PreconditionReport,
  PROBE_TOOL,
  probeFile,
  SECRET,
} from './shared.ts'

const PROVIDER = 'p2-06-approval-precondition-mock'

/** Text only the turns' tasks carry, followed by what the turn calls. */
const TASK_MARKER = 'B668-CALL'

/** The native turns, one per file, in the order they run. */
const NATIVE_KINDS: readonly FileKind[] = ['unchanged', 'changed', 'created']

/**
 * Whether a command-line word names a mode.
 * @param value - the word.
 * @returns true for a mode.
 */
function isMode(value: string | undefined): value is PreconditionMode {
  return PRECONDITION_MODES.some(mode => mode === value)
}

const [configPath, mode, workspace] = process.argv.slice(2)
if (configPath === undefined || !isMode(mode) || workspace === undefined) {
  throw new Error('p2-06 approval-precondition driver requires the overlay path, a mode, and the shared working directory')
}
process.chdir(workspace)
if (mode === 'code-mode') process.env.DSH_TOOLS_MODE = 'ptc'

/**
 * The absolute path of one declared file.
 * @param kind - what the operator does to it before approving.
 * @returns the path in the shared working directory.
 */
const pathOf = (kind: FileKind): string => join(process.cwd(), probeFile(mode, kind))

/** The code-mode program: call the probe on the unchanged file, then on the changed one, and report each outcome. */
const PROGRAM = [
  'const outcomes = []',
  `for (const path of ${JSON.stringify([pathOf('unchanged'), pathOf('changed')])}) {`,
  `  try { await tools.${PROBE_TOOL}({ path, note: ${JSON.stringify(SECRET)} }); outcomes.push(path + ': ran') }`,
  "  catch (error) { outcomes.push(path + ': ' + (error instanceof Error ? error.message : String(error))) }",
  '}',
  "return outcomes.join('\\n')",
].join('\n')

/**
 * One scripted model answer. A turn's opening request calls what its task
 * names, the latest task deciding because every turn shares one session; any
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
  for (const kind of NATIVE_KINDS) {
    if (task?.includes(`${TASK_MARKER} ${kind}`) === true) {
      return toolCallResponse(`b668-native-${kind}`, PROBE_TOOL, { path: pathOf(kind), note: SECRET })
    }
  }
  if (task?.includes(`${TASK_MARKER} program`) === true) {
    return toolCallResponse('b668-run-code', RUN_CODE_NAME, { code: PROGRAM, description: 'call the probe on two files' })
  }
  return textResponse('done')
}

const ctx = await bootProductionProfile({
  binName: 'p2-06-approval-precondition',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  const runs: { callId: string; file: string }[] = []
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a probe that names the file it acts on and records that it ran',
    parameters: {
      path: { type: 'string', required: true, description: 'The file this call acts on.' },
      note: { type: 'string', required: true, description: 'A value the approval display must redact.' },
    },
    presentCall: args => ({ card: 'generic', title: `probe ${basename(args.path)}`, locations: [{ path: args.path }] }),
    execute: (args, exec) => {
      runs.push({ callId: String(exec.callId), file: basename(args.path) })
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))

  const asked: { actionId: string | null; file: string | null; arguments: string | null }[] = []
  const answered = new Set<string>()
  ctx.on('approval/request', (request) => {
    // `run_code` declares no risk domain tags either, so the program is asked
    // about and allowed; the shipped headless profile's workspace-trust
    // question is rejected, as the P2-03 composition cases reject it.
    if (request.toolName === RUN_CODE_NAME) return Promise.resolve('allowed-once' as const)
    if (request.toolName !== PROBE_TOOL) return Promise.resolve('rejected' as const)
    const args = request.binding?.inputs.args
    const path = args !== null && typeof args === 'object' && !Array.isArray(args) && typeof args.path === 'string' ? args.path : undefined
    asked.push({
      actionId: request.binding?.actionId ?? null,
      file: path === undefined ? null : basename(path),
      arguments: request.display?.arguments ?? null,
    })
    // Only the first ask about a file is allowed. A later ask about the same
    // file, which a re-verification may make, is rejected, so what the cases
    // observe is whether the FIRST approval still covers the file.
    if (path === undefined || answered.has(path)) return Promise.resolve('rejected' as const)
    answered.add(path)
    // The operator's own change to the declared file, made after the ask and
    // before the answer, so the execution that follows the approval meets it.
    if (path.endsWith('-changed.txt')) writeFileSync(path, 'changed after the approval was asked\n')
    if (path.endsWith('-created.txt')) writeFileSync(path, 'created after the approval was asked\n')
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
  if (root === undefined) throw new Error('p2-06 approval-precondition driver: no root agent after creation')
  if (mode === 'native') {
    for (const kind of NATIVE_KINDS) await runFixtureTurn(ctx, { task: `${TASK_MARKER} ${kind}: call ${PROBE_TOOL} once.` })
  } else {
    await runFixtureTurn(ctx, { task: `${TASK_MARKER} program: call ${PROBE_TOOL} on two files from one program.` })
  }

  const events = root.session.snapshotEvents()
  const report: PreconditionReport = {
    mode,
    runs,
    asked,
    bound: events.flatMap(event => event.type !== 'approval/bound' ? [] : [{
      id: String(event.data.id),
      action: event.data.action,
      actionId: event.data.actionId ?? null,
    }]),
    decided: Object.fromEntries(events.flatMap(event => event.type === 'approval/decided' ? [[String(event.data.id), event.data.outcome] as const] : [])),
    results: events.flatMap(event => event.type !== 'tool/result' ? [] : event.data.message.content.flatMap(block =>
      block.type !== 'tool-result' ? [] : [{
        callId: String(block.toolCallId),
        isError: block.isError ?? false,
        text: block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(''),
      }])),
  }
  process.stdout.write(`P2-06-PRECONDITION ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
