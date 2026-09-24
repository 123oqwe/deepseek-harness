/**
 * BLOCKED-332 (P4-05 acceptance[0]) closing condition 3 on the SHIPPED `sdk`
 * profile: when a session's Run is advanced to `failed`, a client of the real
 * host receives the state and the reason through the `session.event` or
 * `session.status` notifications it already consumes.
 *
 * One launch of `apps/cli/src/bin.ts --profile sdk`, driven over its stdio as
 * an SDK client drives it, with one patch that inserts
 * `./loader/p4-05-terminal-sdk/fail-run-tool.ts`: a read-only tool whose body
 * advances the calling agent's Run to `failed` through the shipped
 * `ctx.runs.advance`. A keyless stand-in model calls that tool in the task's
 * first step; the Run plugin then refuses the next step. The reason the tool
 * gives appears nowhere else, so a notification carrying it came from the
 * transition.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import type { StubToolCall } from '@deepseek-ai/dsh-session-snapshot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isFirstStepAfterPrompt, startRoutingStubModelServer, type StubRequest } from '../../../apps/cli/tests/profiles/routing-stub-model.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const failRunTool = fileURLToPath(new URL('./loader/p4-05-terminal-sdk/fail-run-tool.ts', import.meta.url))

/** The session the client prompts. */
const SESSION = 'p405-c3'
/** Text only the task contains. */
const TASK = 'P405-C3: end the run with the test tool.'
/** The reason `fail-run-tool.ts` gives for the transition. */
const FAIL_REASON = 'BLOCKED-332 condition 3: advanced to failed by the test tool'

/** One JSON-RPC frame the SDK server wrote. */
type Frame = Record<string, unknown>

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  return isFirstStepAfterPrompt(request, TASK) ? { name: 'p4_05_fail_run', arguments: {} } : undefined
}

let notifications: Frame[] = []
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
  const stub = await startRoutingStubModelServer(answer)
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p405-c3-'))
  cleanup = async () => {
    await stub.close()
    await rm(dshHome, { recursive: true, force: true })
  }
  const patch = join(dshHome, 'p405-c3.patch.yml')
  await writeFile(patch, `- insert:\n    - id: p4-05-fail-run-tool\n      name: '${pathToFileURL(failRunTool).href}'\n`)
  const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'sdk', '--patch', patch], {
    cwd: repoRoot,
    env: {
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'p405-keyless',
      DEEPSEEK_BASE_URL: stub.baseUrl,
    },
    timeout: 90_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
  const frames: Frame[] = []
  let buffer = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      const frame = JSON.parse(line) as Frame
      // A server request (id and method) is answered, not left to stall the turn.
      if (frame.id !== undefined && typeof frame.method === 'string') {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32_601, message: `unanswered: ${frame.method}` } })}\n`)
      }
      frames.push(frame)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const send = (frame: Frame): void => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`) }
  const wait = async (what: string, predicate: (frame: Frame) => boolean): Promise<Frame> => {
    const deadline = Date.now() + 60_000
    for (;;) {
      const found = frames.find(predicate)
      if (found !== undefined) return found
      if (Date.now() > deadline) throw new Error(`no ${what} within 60 s; stderr:\n${stderr}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  const forSession = (frame: Frame): boolean =>
    (frame.params as { sessionId?: unknown } | undefined)?.sessionId === SESSION
  try {
    send({ id: 1, method: 'initialize', params: { cwd: dshHome, provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
    const initialized = await wait('the initialize result', frame => frame.id === 1)
    if (initialized.error !== undefined) throw new Error(`initialize refused: ${JSON.stringify(initialized.error)}`)
    send({ id: 2, method: 'session/prompt', params: { sessionId: SESSION, contentBlocks: [{ type: 'text', text: TASK }] } })
    await wait(`session ${SESSION} turn/end`, frame => frame.method === 'session.event' && forSession(frame)
      && (frame.params as { event?: { type?: unknown } }).event?.type === 'turn/end')
    // The prompt's own response, so any notification sent before it is in.
    await wait('the prompt response', frame => frame.id === 2)
    send({ id: 3, method: 'shutdown' })
    await wait('the shutdown response', frame => frame.id === 3)
    const exit = await child
    if (exit.exitCode !== 0) throw new Error(`dsh --profile sdk exited ${String(exit.exitCode)}; stderr:\n${stderr}`)
    notifications = frames.filter(frame => (frame.method === 'session.event' || frame.method === 'session.status') && forSession(frame))
  } finally {
    child.kill('SIGKILL')
    await child
  }
}, 180_000)

afterAll(async () => { await cleanup?.() })

/**
 * The session events of one type the client received.
 * @param type - the event type.
 * @returns their `event` payloads, in arrival order.
 */
function eventsOfType(type: string): readonly Record<string, unknown>[] {
  return notifications.flatMap((frame) => {
    const event = (frame.params as { event?: Record<string, unknown> } | undefined)?.event
    return frame.method === 'session.event' && event?.type === type ? [event] : []
  })
}

describe('BLOCKED-332 on the shipped sdk profile: a client of the real host when the session\'s Run is advanced to failed', () => {
  it('control: the test tool advanced the Run, and the turn ended because the next step was refused', () => {
    expect(JSON.stringify(eventsOfType('tool/result'))).toContain('advance: advanced')
    const ends = eventsOfType('turn/end').map(event => (event.data as { reason?: { kind?: unknown } } | undefined)?.reason?.kind)
    expect(ends).toEqual(['blocked'])
  })

  it('condition 3: a session.event or session.status the client receives carries the state failed and the reason the transition was given', () => {
    const resultAt = notifications.findIndex(frame => JSON.stringify(frame).includes('advance: advanced'))
    const afterResult = resultAt < 0 ? [] : notifications.slice(resultAt)
    const carrying = afterResult.filter((frame) => {
      const text = JSON.stringify(frame.params)
      return text.includes('failed') && text.includes(FAIL_REASON)
    })
    expect(carrying.length, `notifications after the tool result: ${JSON.stringify(afterResult.map(frame => frame.method))}`).toBeGreaterThan(0)
  })
})
