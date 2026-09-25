/**
 * P2-01 acceptance[0] on the webhook surface: an action a webhook delivery
 * triggers traces to the integration the HMAC key stands for, a
 * ServicePrincipal, rather than to a principal synthesized per session.
 *
 * The webhook surface is the documented user patch over the shipped `web`
 * profile (`docs/user/guide/github-review.md`): the example
 * `apps/cli/config/examples/github-review/cordis.yml`, which
 * `apps/web/tests/github-ready-review.e2e.ts` also uses. No bundle mounts
 * `@deepseek-ai/dsh-webhook` by itself. The harness is the one
 * `./host-user.e2e.ts` uses: the launcher's own `runProfile`, in-process, with
 * `--no-open --port 0`, a temporary `$DSH_HOME` and the example as the one
 * `--patch`. One signed `pull_request` / `ready_for_review` delivery goes to
 * the ingress; the example rule turns it into a Workspace Session whose prompt
 * carries the PR title, and the stand-in model answers that prompt's first
 * step with one `bash` call, so the session appends an action manifest.
 *
 * `runProfile` reads its home and posture from `process.env` and adds
 * `SIGTERM`, `SIGINT` and `unhandledRejection` listeners to the process; the
 * case restores the variables it set and removes the listeners it added.
 *
 * @module apps/cli/tests/profiles/web/tests/webhook-actor
 */

import { createHmac } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../../../src/profile-boot.ts'
import { isFirstStepAfterPrompt, startRoutingStubModelServer } from '../../routing-stub-model.ts'
import { attachedIdentity, countRecords, readSessionLogs, type ReadLog } from '../../session-log.ts'

/** The documented webhook patch, as shipped with the CLI. */
const WEBHOOK_PATCH = fileURLToPath(new URL('../../../../config/examples/github-review/cordis.yml', import.meta.url))

/** Text only this case's delivery carries, in the PR title the rule copies into the prompt. */
const PROMPT_MARKER = 'A-421-WEBHOOK-ACTOR'

/** The HMAC secret the ingress verifies deliveries with. */
const SECRET = 'a421-webhook-secret'

/** The process events `runProfile` adds listeners for. */
const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const

/** What the one launch left, read after it closed. */
interface Observation {
  readonly status: number
  readonly webhookLogs: readonly ReadLog[]
}

let observation: Observation | undefined

/**
 * A TCP port nothing listens on at the moment of the call.
 * @returns the port number.
 */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  if (address === null || typeof address === 'string') throw new Error('no port was bound')
  return address.port
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
 * Whether a session log is the one a webhook delivery created.
 * @param log - one session log.
 * @returns true when a user message in it came from a webhook.
 */
function isWebhookSession(log: ReadLog): boolean {
  return log.records.some(record => record.type === 'user/message'
    && (record.data?.['source'] as { kind?: unknown } | undefined)?.kind === 'webhook')
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-a421-webhook-'))
  const home = join(root, '.dsh')
  const project = join(root, 'project')
  await mkdir(project)
  const stub = await startRoutingStubModelServer(request => isFirstStepAfterPrompt(request, PROMPT_MARKER)
    ? { name: 'bash', arguments: { command: 'printf A-421', description: 'Print the proof string' } }
    : undefined)
  const port = await freePort()
  const launchEnv: Readonly<Record<string, string>> = {
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
    DEEPSEEK_BASE_URL: stub.baseUrl,
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    // Empty, not absent: the launch pins its Trust Kernel as a shipped launch does.
    DSH_TRUST_KERNEL_INSECURE: '',
    DSH_GITHUB_WEBHOOK_PORT: String(port),
    DSH_GITHUB_WEBHOOK_SECRET: SECRET,
    DSH_GITHUB_REVIEW_WORKSPACE: project,
  }
  const savedEnv = new Map(Object.keys(launchEnv).map((name): [string, string | undefined] => [name, process.env[name]]))
  const emitter: NodeJS.EventEmitter = process
  const savedListeners = new Map(PROCESS_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
  let ctx: Context | undefined
  try {
    Object.assign(process.env, launchEnv)
    ctx = (await runProfile({
      environment: loadLayeredEnv('dsh', project),
      profile: 'web',
      fromDefaultProfile: undefined,
      patchFiles: [WEBHOOK_PATCH],
      args: ['--no-open', '--port', '0'],
    })).ctx
    const live = ctx

    const body = JSON.stringify({
      action: 'ready_for_review',
      number: 421,
      repository: { full_name: 'deepseek-harness/deepseek-harness' },
      pull_request: {
        title: `${PROMPT_MARKER}: print the proof string with bash, then stop`,
        html_url: 'https://github.com/deepseek-harness/deepseek-harness/pull/421',
        draft: false,
        user: { login: 'octocat' },
        base: { ref: 'master', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        head: { ref: 'a421', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      },
    })
    const response = await fetch(`http://127.0.0.1:${String(port)}/github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`,
        'x-github-event': 'pull_request',
        'x-github-delivery': 'a421-ready',
      },
      body,
    })

    // The runtime creates the Workspace Session after it answers the delivery.
    await vi.waitFor(() => {
      expect(live.agents.list().some(agent => agent.session.header.cwd === project)).toBe(true)
    }, { timeout: 60_000, interval: 100 })
    const agent = live.agents.list().find(candidate => candidate.session.header.cwd === project)
    if (agent === undefined) throw new Error('the webhook session has no live agent')
    await agent.whenIdle()
    await live.sessions.flush(agent.session)
    await live.fiber.dispose()
    ctx = undefined
    removeAddedListeners(savedListeners)

    const logs = await readSessionLogs(join(home, 'sessions'))
    observation = { status: response.status, webhookLogs: logs.filter(isWebhookSession) }
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
}, 180_000)

afterAll(() => { observation = undefined })

describe('dsh --profile web with the documented GitHub webhook patch, booted in-process through the launcher (no key required)', () => {
  it('control: the signed delivery is accepted and creates one webhook session whose first action manifest names an actor', () => {
    expect(observation?.status).toBe(202)
    expect(observation?.webhookLogs).toHaveLength(1)
    const manifests = observation?.webhookLogs[0]?.records.filter(record => record.type === 'action/manifest-appended') ?? []
    expect(manifests.length).toBeGreaterThan(0)
    expect(typeof manifests[0]?.data?.['actor']).toBe('string')
    expect(String(manifests[0]?.data?.['actor'])).not.toBe('')
  })

  it('P2-01 acceptance[0]: an action a webhook delivery triggers traces to the integration ServicePrincipal the HMAC key stands for', () => {
    const log = observation?.webhookLogs[0]
    if (log === undefined) throw new Error('no webhook session was observed')
    const actor = log.records.find(record => record.type === 'action/manifest-appended')?.data?.['actor']
    expect(countRecords(log, 'identity/attached'), `first manifest actor: ${String(actor)}`).toBe(1)
    const identity = attachedIdentity(log)
    expect(identity.principal?.kind).toBe('service')
    expect(actor).toBe(identity.principal?.id)
    expect(String(actor)).not.toMatch(/^anonymous:/)
  })
})
