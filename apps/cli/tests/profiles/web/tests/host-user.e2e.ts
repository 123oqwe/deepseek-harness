/**
 * P2-01 acceptance[0] on the `web` profile: a session created through the Web
 * app's session controller acts as the host user from its first action and
 * attaches that identity once, and resuming it through the same controller
 * in a second launch adds no second attachment.
 *
 * The harness is the launcher's own `runProfile`
 * (`apps/cli/src/profile-boot.ts:546`), called in-process with the arguments
 * `apps/cli/src/bin.ts:34-40` passes for `dsh --profile web --no-open
 * --port 0`, against a temporary `$DSH_HOME` and no `--patch`, so the
 * composition is the shipped `web` template (dsh-base plus dsh-web-app,
 * `packages/boot/app-boot/src/profile.ts:127-130`) initialized in that home.
 * In-process because the subject is the controller's own methods, which a
 * subprocess would reach only over the authenticated HTTP gateway: `create`
 * (`packages/api/session-controller/src/index.ts:244-247`, then
 * `commands.ts:89-128` and `agent.ts:235-272`, creating at `agent.ts:482-492`)
 * and `prompt` (`index.ts:346-350`, then `commands.ts:306-380`), which in the
 * second launch finds no live agent and resumes the persisted session
 * (`agent.ts:173-225`, `:403-437`). Every creation and resumption takes
 * `agentOptions()` (`agent.ts:510-513`). Never `ctx.agents.create` directly:
 * that would test this file, not the controller.
 *
 * No built web frontend is needed: the frontend-static row reads its
 * `index.html` per request (`packages/bundle/web-app/src/index.ts:156-170`),
 * and this case sends none. Built `lib/` is needed, as for every launched
 * profile here: the Loader imports each row's package through its exports.
 *
 * The stand-in model answers the loop's first request after each prompt with
 * one `bash` call, and every other request with text: the request that carries
 * the call's result, and the session-title request, which offers no tools.
 * dsh-base mounts `session-title-first-prompt-llm`, whose request races the
 * loop's, so the answer is chosen from each request's content
 * (`../../routing-stub-model.ts`).
 *
 * `runProfile` reads its home and posture from `process.env` and adds
 * `SIGTERM`, `SIGINT` and `unhandledRejection` listeners to the process; the
 * case restores the variables it set and removes the listeners each launch
 * added.
 *
 * @module apps/cli/tests/profiles/web/tests/host-user
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { runProfile } from '../../../../src/profile-boot.ts'
import { isFirstStepAfterPrompt, startRoutingStubModelServer } from '../../routing-stub-model.ts'
import {
  attachedIdentity,
  attachedPrincipal,
  countRecords,
  DEFAULT_HOST_TENANT,
  persistedHostUserId,
  readSessionLog,
} from '../../session-log.ts'

/** Text only this case's prompts contain, so the stand-in can tell the loop's prompt steps apart. */
const PROMPT_MARKER = 'P2-01-WEB-HOST-USER'

/** The process events `runProfile` adds listeners for. */
const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const

/**
 * Boot the shipped `web` profile in-process, as `dsh --profile web --no-open
 * --port 0` does.
 * @param project - the invoking directory, whose `.env` layer the launch reads; it has none.
 * @returns the root context once every row has started.
 */
async function launchWeb(project: string): Promise<Context> {
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh', project),
    profile: 'web',
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: ['--no-open', '--port', '0'],
  })
  return ctx
}

/**
 * Remove the process listeners added since a snapshot.
 * @param before - each event's listeners when the snapshot was taken.
 */
function removeAddedListeners(before: ReadonlyMap<string, readonly unknown[]>): void {
  const emitter: NodeJS.EventEmitter = process
  for (const [event, listeners] of before) {
    for (const listener of emitter.listeners(event)) {
      if (!listeners.includes(listener)) emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }
}

/**
 * Prompt one session through the controller, wait until its agent is idle,
 * and flush its log to disk.
 * @param ctx - a launched web profile's root context.
 * @param sessionId - the session to prompt.
 * @param requestId - the client-minted request id the controller records.
 * @param text - the prompt text.
 */
async function promptAndSettle(ctx: Context, sessionId: SessionId, requestId: string, text: string): Promise<void> {
  await ctx.sessionController.prompt({
    requestId: brandString<SessionRequestId>(requestId),
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text }],
  }, new AbortController().signal)
  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`session ${sessionId} has no live agent after the controller accepted its prompt`)
  await agent.whenIdle()
  await ctx.sessions.flush(agent.session)
}

describe('dsh --profile web, booted in-process through the launcher (no key required)', () => {
  it('P2-01 acceptance[0]: a web session created through the session controller acts as the host user, attached once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-p2-01-web-'))
    const home = join(root, '.dsh')
    const project = join(root, 'project')
    await mkdir(project)
    const stub = await startRoutingStubModelServer(request => isFirstStepAfterPrompt(request, PROMPT_MARKER)
      ? { name: 'bash', arguments: { command: 'printf P2-01-WEB', description: 'Print the proof string' } }
      : undefined)
    const launchEnv: Readonly<Record<string, string>> = {
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(root, '.agents'),
      DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
      DEEPSEEK_BASE_URL: stub.baseUrl,
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      // Empty, not absent: the launch pins its Trust Kernel as a shipped
      // launch does, whatever this process inherited.
      DSH_TRUST_KERNEL_INSECURE: '',
    }
    const savedEnv = new Map(Object.keys(launchEnv).map((name): [string, string | undefined] => [name, process.env[name]]))
    const emitter: NodeJS.EventEmitter = process
    const savedListeners = new Map(PROCESS_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
    let ctx: Context | undefined
    try {
      Object.assign(process.env, launchEnv)

      ctx = await launchWeb(project)
      const { sessionId } = await ctx.sessionController.create({ cwd: project })
      await promptAndSettle(ctx, sessionId, 'p2-01-web-first', `${PROMPT_MARKER}: print the proof string with bash, then stop.`)
      await ctx.fiber.dispose()
      ctx = undefined
      removeAddedListeners(savedListeners)

      // The first manifest, not any of them: acceptance[0] is about what the
      // session was attributed to from its first action onward.
      const log = await readSessionLog(join(home, 'sessions'))
      const manifests = log.records.filter(record => record.type === 'action/manifest-appended')
      expect(manifests.length).toBeGreaterThan(0)
      expect(manifests[0]?.data?.actor).not.toMatch(/^anonymous:/)
      expect(manifests[0]?.data?.actor).toBe(attachedPrincipal(log))
      expect(countRecords(log, 'identity/attached')).toBe(1)

      // THE host user: the id the launch persisted under its own home.
      const hostUserId = await persistedHostUserId(home)
      expect(attachedPrincipal(log)).toBe(hostUserId)

      // The whole chain the attachment carries: one entry, the host user, in
      // the tenant `resolveTenantId` falls back to when nothing names another.
      const hostUser = { kind: 'user', id: hostUserId, tenantId: DEFAULT_HOST_TENANT }
      const identity = attachedIdentity(log)
      expect(identity.chain?.entries).toHaveLength(1)
      expect(identity.chain?.entries?.[0]?.principal).toEqual(hostUser)
      expect(identity.principal).toEqual(hostUser)

      // The resume half, in a second launch over the same home: the
      // controller holds no live agent for the session, so its `prompt`
      // resumes it. The manifest count is asserted to grow first, because
      // "no second record" would also hold if no agent had been composed at
      // all: only a running agent appends a manifest.
      ctx = await launchWeb(project)
      await promptAndSettle(ctx, sessionId, 'p2-01-web-second', `${PROMPT_MARKER}: print the proof string once more, then stop.`)
      await ctx.fiber.dispose()
      ctx = undefined
      removeAddedListeners(savedListeners)

      const resumed = await readSessionLog(join(home, 'sessions'))
      const resumedManifests = resumed.records.filter(record => record.type === 'action/manifest-appended')
      expect(resumedManifests.length).toBeGreaterThan(manifests.length)
      expect(resumedManifests.at(-1)?.data?.actor).toBe(attachedPrincipal(resumed))
      expect(countRecords(resumed, 'identity/attached')).toBe(1)
    } finally {
      await ctx?.fiber.dispose()
      removeAddedListeners(savedListeners)
      for (const [name, value] of savedEnv) {
        if (value === undefined) Reflect.deleteProperty(process.env, name)
        else process.env[name] = value
      }
      await stub.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 240_000)
})
