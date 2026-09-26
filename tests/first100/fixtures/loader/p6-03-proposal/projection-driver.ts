/**
 * Driver for two edges of P6-03 acceptance[1]'s projection
 * (「forget 后主存、索引、cache、projection 在 SLA 内清除并留下合规 tombstone。」)
 * on the shipped composition. In both, a session recalls one record into a
 * model request and the record is then forgotten. After that:
 * - `restart`: the host process restarts and the session is resumed, and it
 *   takes one turn whose task recalls nothing;
 * - `empty-query`: the same process takes one more turn whose task is
 *   whitespace, so its step has no query to recall against.
 *
 * Every phase boots the SHIPPED headless profile through
 * `bootProductionProfile`, with the base layer's `memory` row over
 * `./.memory` (`./base.patch.yml`) and its `memory-context` row enabled
 * (`./recall.patch.yml`). It pins the Trust Kernel as the shipped launcher
 * does. The phases are:
 * - `restart` launches `before` and then `after <session>` the way it was
 *   itself launched: same Node flags, working directory and environment, so
 *   the same `./.sessions`, `./.memory` and `DSH_HOME`. It prints one
 *   `P6-03-PROJECTION <json>` line holding both readings.
 * - `before` proposes `recalled`, creates the root agent after boot, and runs
 *   one turn whose task is the recall key only `recalled` holds. It then
 *   forgets `recalled`, reports, and disposes the tree.
 * - `after <session>` resumes that session the way the Web host does when a
 *   client opens it, runs one turn whose task recalls nothing, and reports.
 * - `empty-query` does what `before` does, then runs one turn whose task is
 *   whitespace, and prints one `P6-03-PROJECTION <json>` line.
 * @module tests/first100/fixtures/loader/p6-03-proposal/projection-driver
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type { MemoryClaimOrigin, MemoryRecordId, MemoryScope } from '@deepseek-ai/dsh-memory'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The route the scripted model registers. */
const PROVIDER = 'p6-03-projection-mock'
/** The task of the turn that recalls `recalled`: only that record's content holds it. */
const RECALL_KEY = 'p6-03-projection-recall-key'
/** Content only `recalled` carries, so a model request holding it carries that record. */
const MARKER = 'p6-03-projection-recalled-marker'
/** The task of the resumed session's turn; no record holds it. */
const AFTER_RESTART_TASK = 'p6-03-projection-after-restart'
/** The task of the step with no query: whitespace, which the recall consumer treats as no query. */
const EMPTY_TASK = ' '
/** The line prefix one phase of `restart` reports under. */
const PHASE_TAG = 'P6-03-PHASE'
/** Deadline for one phase process. */
const PHASE_TIMEOUT_MS = 90_000

/** The scripted model's requests, as `MockAdapter` records them. */
type Requests = MockAdapter['requests']

/**
 * The code an error carries, or its text.
 * @param error - what a step threw.
 * @returns the code or the text.
 */
function failureOf(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : String(error)
}

/**
 * The session's own step requests from `from` on; a request made for another purpose (a title) is not one.
 * @param adapter - the scripted model.
 * @param from - the index of the first request to read.
 * @returns those requests.
 */
function stepRequests(adapter: MockAdapter, from: number): Requests {
  return adapter.requests.slice(from).filter(request => request.purpose === undefined)
}

/**
 * Whether any of these requests carries the recalled record's content.
 * @param requests - the requests.
 * @returns true when one carries it.
 */
function carriesRecalled(requests: Requests): boolean {
  return requests.some(request => JSON.stringify(request.messages).includes(MARKER))
}

/**
 * Whether any of these requests holds the first turn's task as a user-authored
 * message, so it was made in the history of the session that recalled.
 * @param requests - the requests.
 * @returns true when one holds it.
 */
function holdsFirstTask(requests: Requests): boolean {
  return requests.some(request => request.messages.some(message => message.source.kind === 'user'
    && message.content.some(block => block.type === 'text' && block.text === RECALL_KEY)))
}

/**
 * Register the scripted model and refuse every question, including the
 * shipped headless profile's workspace-trust question.
 * @param ctx - the booted root context.
 * @returns the scripted model.
 */
function scriptModel(ctx: Context): MockAdapter {
  const adapter = new MockAdapter(Array.from({ length: 16 }, () => textResponse('ok')))
  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.on('approval/request', () => Promise.resolve('rejected' as const))
  return adapter
}

/**
 * Propose `recalled`, create the root agent, recall it in one turn, and forget it.
 * @param ctx - the booted root context.
 * @param adapter - the scripted model.
 * @param thrown - what each step threw, keyed by step.
 * @returns the root session's id, and whether a request before the forget carried the recalled content.
 */
async function recallThenForget(ctx: Context, adapter: MockAdapter, thrown: Record<string, string>): Promise<{ readonly session: string | null; readonly recalledBefore: boolean }> {
  const cwd = process.cwd()
  const observed = await observeWorkspaceIdentity(cwd)
  const tenantId = TenantId('local')
  const principal = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
  // The workspace scope `memory-context` reads under for a session working in `cwd`.
  const scope: MemoryScope = {
    tenantId,
    workspace: {
      canonicalPath: observed.canonicalPath,
      identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
    },
  }
  const asserted: MemoryClaimOrigin = { kind: 'user-asserted', assertedBy: 'p6-03-writer' }
  const step = async (name: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run()
    } catch (error: unknown) {
      thrown[name] = failureOf(error)
    }
  }
  let id: MemoryRecordId | undefined
  await step('propose', async () => {
    id = (await ctx.memory.propose({
      principal,
      scope,
      origin: asserted,
      purpose: 'answer questions about this project',
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      sensitivity: 'normal',
      content: { note: `${RECALL_KEY} ${MARKER}` },
    })).id
  })
  // Created after boot, as a shipped launcher creates its root agent.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd,
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await step('turn-recall', () => runFixtureTurn(ctx, { task: RECALL_KEY }))
  const recalledBefore = carriesRecalled(stepRequests(adapter, 0))
  await step('forget', async () => {
    if (id === undefined) throw new Error('propose minted no id')
    await ctx.memory.forget({ principal, scope, id })
  })
  const [root] = ctx.agents.roots()
  return { session: root?.id ?? null, recalledBefore }
}

/**
 * Take one turn and read the session's requests made during it.
 * @param ctx - the booted root context.
 * @param adapter - the scripted model.
 * @param thrown - what each step threw, keyed by step.
 * @param task - the turn's task.
 * @returns how many step requests the turn made, whether one carried the recalled content, and whether one holds the first turn's task.
 */
async function laterTurn(ctx: Context, adapter: MockAdapter, thrown: Record<string, string>, task: string): Promise<Record<string, unknown>> {
  const from = adapter.requests.length
  try {
    await runFixtureTurn(ctx, { task })
  } catch (error: unknown) {
    thrown['turn-later'] = failureOf(error)
  }
  const requests = stepRequests(adapter, from)
  return { thrown, requestsAfter: requests.length, carriesForgotten: carriesRecalled(requests), holdsFirstTask: holdsFirstTask(requests) }
}

/**
 * Run one phase of `restart` in a fresh process launched the way this one was.
 * @param args - the phase's arguments after the script path.
 * @returns what the phase reported.
 */
function runPhase(args: readonly string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: PHASE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  })
  const json = /P6-03-PHASE (?<json>.+)/u.exec(result.stdout)?.groups?.json
  if (json === undefined) {
    throw new Error(`p6-03 projection phase ${args.slice(2).join(' ')} reported nothing (status ${String(result.status)}, signal ${String(result.signal)}); stderr tail:\n${result.stderr.slice(-1500)}`)
  }
  return JSON.parse(json) as Record<string, unknown>
}

const [configPath, recallPath, phase, sessionArg] = process.argv.slice(2)
if (configPath === undefined || recallPath === undefined) {
  throw new Error('p6-03 projection driver requires the base and recall overlay paths')
}
// The host user acts in `$DSH_TENANT`, else `local`; `./recall.patch.yml` reads in `local`.
process.env.DSH_TENANT = ''

if (phase === 'restart') {
  const before = runPhase([configPath, recallPath, 'before'])
  const session = before.session
  if (typeof session !== 'string') throw new Error(`p6-03 projection: before reported no session: ${JSON.stringify(before)}`)
  const after = runPhase([configPath, recallPath, 'after', session])
  process.stdout.write(`P6-03-PROJECTION ${JSON.stringify({ variant: 'restart', before, after })}\n`)
} else if (phase === 'before' || phase === 'after' || phase === 'empty-query') {
  const ctx = await bootProductionProfile({
    binName: 'p6-03-projection',
    profile: 'headless',
    overlayPaths: [resolveConfigPath(configPath, undefined), resolveConfigPath(recallPath, undefined)],
    prepare: (prepared) => {
      pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
    },
  })
  try {
    const adapter = scriptModel(ctx)
    const thrown: Record<string, string> = {}
    if (phase === 'before') {
      const recalled = await recallThenForget(ctx, adapter, thrown)
      process.stdout.write(`${PHASE_TAG} ${JSON.stringify({ thrown, ...recalled })}\n`)
    } else if (phase === 'after') {
      if (sessionArg === undefined) throw new Error('p6-03 projection driver: `after` requires the session id')
      // What the Web host does when a client opens the session
      // (`session-controller/src/agent.ts` `resumeObserved`).
      try {
        await ctx.agents.resume({ resumeSessionId: SessionId(sessionArg), agentOptions: { provider: PROVIDER, model: PROVIDER } })
      } catch (error: unknown) {
        thrown.resume = failureOf(error)
      }
      process.stdout.write(`${PHASE_TAG} ${JSON.stringify(await laterTurn(ctx, adapter, thrown, AFTER_RESTART_TASK))}\n`)
    } else {
      const recalled = await recallThenForget(ctx, adapter, thrown)
      const before = { thrown: { ...thrown }, ...recalled }
      const after = await laterTurn(ctx, adapter, {}, EMPTY_TASK)
      process.stdout.write(`P6-03-PROJECTION ${JSON.stringify({ variant: 'empty-query', before, after })}\n`)
    }
  } finally {
    await ctx.fiber.dispose()
  }
} else {
  throw new Error(`p6-03 projection driver: unknown phase ${String(phase)}`)
}
