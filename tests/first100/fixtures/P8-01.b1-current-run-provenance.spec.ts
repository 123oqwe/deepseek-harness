/**
 * P8-01 blind review B1 on the SHIPPED `sdk` and `acp` profiles: a subagent's
 * Run takes its provenance from its parent agent's current Run, not from the
 * first Run its parent session ever opened.
 *
 * The SDK server is the only writer of a Run's provenance, so the session is
 * created over the SDK and continued over ACP, the one shipped path that
 * resumes a persisted session through its protocol (`session/resume`). Three
 * launches share one working directory and one `DSH_HOME`, against a keyless
 * stand-in model that answers from each request's content:
 *
 * 1. `--profile sdk` initializes with one optional capability the server does
 *    not know, so the negotiation is not the empty default, sends one task to
 *    session `p801-b1`, and shuts down; that session's Run is now finished.
 * 2. `--profile acp` resumes `p801-b1` and sends a task whose first step
 *    delegates once through the shipped `subagent` tool. The resumed session
 *    opens a second Run, which carries no provenance because the ACP server
 *    records none. The Run Service's store is read after this launch.
 * 3. `--profile sdk` again sends a prompt to `p801-b1`, which shows that an
 *    SDK connection cannot continue a session that already exists.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-session-snapshot'
import type { StubToolCall } from '@deepseek-ai/dsh-session-snapshot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isFirstStepAfterPrompt, startRoutingStubModelServer, type StubRequest } from '../../../apps/cli/tests/profiles/routing-stub-model.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

/** The session the SDK creates and ACP resumes. */
const SESSION = 'p801-b1'
/** Text only the SDK launch's task contains. */
const TASK_SDK = 'P801-B1-SDK: say ok.'
/** Text only the resumed session's task contains. */
const TASK_RESUMED = 'P801-B1-RESUMED: delegate the check once, then say ok.'
/** Text only the delegated child's prompt contains. */
const CHILD = 'P801-B1-CHILD: reply with ok.'
/** Text only the second SDK launch's prompt contains. */
const TASK_AGAIN = 'P801-B1-AGAIN: say ok.'
/** An optional capability no server knows, so the negotiation records it as ignored. */
const UNKNOWN_OPTIONAL = 'x-p801-optional'
/** ACP's stable protocol version, the value `@agentclientprotocol/sdk` exports as `PROTOCOL_VERSION`. */
const ACP_PROTOCOL_VERSION = 1

/** A Run as the store file holds it, reduced to the members read here. */
interface StoredRun {
  readonly id: string
  readonly sessionIds: readonly string[]
  readonly provenance?: { readonly negotiation?: unknown }
}

/** One JSON-RPC frame the SDK server wrote. */
type Frame = Record<string, unknown>

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  if (isFirstStepAfterPrompt(request, TASK_RESUMED)) {
    return { name: 'subagent', arguments: { description: 'delegated check', prompt: CHILD } }
  }
  return undefined
}

/** What one `--profile sdk` launch returned and how it exited. */
interface SdkLaunch<T> {
  readonly result: T
  readonly exitCode: number | undefined
  readonly stderr: string
}

/**
 * Run one `--profile sdk` launch through a scripted exchange, then shut it down.
 * @param env - the launch's environment.
 * @param script - sends frames and waits for replies; runs before `shutdown`.
 * @returns what the script returned, and the exit code the caller judges.
 */
async function withSdkLaunch<T>(
  env: NodeJS.ProcessEnv,
  script: (send: (frame: Frame) => void, wait: (what: string, predicate: (frame: Frame) => boolean) => Promise<Frame>) => Promise<T>,
): Promise<SdkLaunch<T>> {
  const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'sdk'], {
    cwd: repoRoot,
    env,
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
  try {
    const result = await script(send, wait)
    send({ id: 99, method: 'shutdown' })
    const exit = await child
    return { result, exitCode: exit.exitCode, stderr }
  } finally {
    child.kill('SIGKILL')
    await child
  }
}

interface Observation {
  negotiation: unknown
  runs: StoredRun[]
  secondSdkPrompt: Frame
  secondSdkExitCode: number | undefined
}

let observed: Observation | undefined
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
  const stub = await startRoutingStubModelServer(answer)
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-p801-b1-'))
  cleanup = async () => {
    await stub.close()
    await rm(workdir, { recursive: true, force: true })
  }
  const shared = {
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'p801-keyless',
    DEEPSEEK_BASE_URL: stub.baseUrl,
  }
  // The same homes `launchAcpTestAgent` derives from its cwd, so all three
  // launches read and write one session store and one Run store.
  const sdkEnv = { ...shared, DSH_HOME: join(workdir, '.dsh'), DSH_AGENTS_HOME: join(workdir, '.agents') }
  const turnEnd = (frame: Frame): boolean => {
    const params = frame.params as { sessionId?: unknown; event?: { type?: unknown } } | undefined
    return frame.method === 'session.event' && params?.sessionId === SESSION && params.event?.type === 'turn/end'
  }
  const base = { cwd: workdir, provider: 'deepseek-official', model: 'deepseek-v4-pro' }

  const created = await withSdkLaunch(sdkEnv, async (send, wait) => {
    send({ id: 1, method: 'initialize', params: { ...base, capabilities: [{ id: UNKNOWN_OPTIONAL, mandatory: false }] } })
    const initialized = await wait('the initialize result', frame => frame.id === 1)
    if (initialized.error !== undefined) throw new Error(`initialize refused: ${JSON.stringify(initialized.error)}`)
    send({ id: 2, method: 'session/prompt', params: { sessionId: SESSION, contentBlocks: [{ type: 'text', text: TASK_SDK }] } })
    await wait(`session ${SESSION} turn/end`, turnEnd)
    return (initialized.result as { negotiation?: unknown } | undefined)?.negotiation
  })
  if (created.exitCode !== 0) throw new Error(`the first sdk launch exited ${String(created.exitCode)}; stderr:\n${created.stderr}`)

  // A patch that changes nothing: the launcher always applies one.
  const noopPatch = join(workdir, 'p801-b1-noop.patch.yml')
  await writeFile(noopPatch, '- id: session-title-llm\n  disabled: true\n')
  const acp = launchAcpTestAgent({
    agent: {
      binScript,
      configPath: noopPatch,
      profile: 'acp',
      tsconfigPath: join(repoRoot, 'tsconfig.json'),
    },
    cwd: workdir,
    env: shared,
    requestPermission: (params) => {
      const allow = params.options.find(option => option.kind === 'allow_once' || option.kind === 'allow_always')
      return Promise.resolve(allow === undefined
        ? { outcome: { outcome: 'cancelled' as const } }
        : { outcome: { outcome: 'selected' as const, optionId: allow.optionId } })
    },
  })
  try {
    await acp.spawned
    await acp.client.initialize({ protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} })
    await acp.client.resumeSession({ sessionId: SESSION, cwd: workdir })
    await acp.client.prompt({ sessionId: SESSION, prompt: [{ type: 'text', text: TASK_RESUMED }] })
    // The child's first request is what shows its session started, and so that
    // its Run was opened.
    const deadline = Date.now() + 60_000
    while (!stub.requests.some(request => JSON.stringify(request.messages ?? []).includes(CHILD))) {
      if (Date.now() > deadline) throw new Error(`the delegated child made no request within 60 s; stderr:\n${acp.stderr()}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  } finally {
    await acp.close()
  }
  const store = JSON.parse(await readFile(join(workdir, '.dsh', 'runs', 'runs.json'), 'utf8')) as { runs: StoredRun[] }

  const again = await withSdkLaunch(sdkEnv, async (send, wait) => {
    send({ id: 1, method: 'initialize', params: base })
    await wait('the second initialize result', frame => frame.id === 1)
    send({ id: 2, method: 'session/prompt', params: { sessionId: SESSION, contentBlocks: [{ type: 'text', text: TASK_AGAIN }] } })
    return wait('the second prompt response', frame => frame.id === 2)
  })

  observed = { negotiation: created.result, runs: store.runs, secondSdkPrompt: again.result, secondSdkExitCode: again.exitCode }
}, 300_000)

afterAll(async () => { await cleanup?.() })

describe('P8-01 B1 on the shipped sdk and acp profiles: a session the sdk created and acp resumed delegates once', () => {
  it('control: the session has two Runs, the sdk one carrying the handshake\'s negotiation and the acp one carrying none', () => {
    const parentRuns = (observed?.runs ?? []).filter(run => run.sessionIds.includes(SESSION))
    // Not the empty default: the unknown optional capability is recorded as ignored.
    expect((observed?.negotiation as { ignoredCapabilities?: unknown } | undefined)?.ignoredCapabilities).toEqual([UNKNOWN_OPTIONAL])
    expect(parentRuns).toHaveLength(2)
    expect(parentRuns[0]?.provenance?.negotiation).toEqual(observed?.negotiation)
    expect(parentRuns[1]?.provenance).toBeUndefined()
  })

  it('control: the delegated subagent opened exactly one Run', () => {
    expect((observed?.runs ?? []).filter(run => !run.sessionIds.includes(SESSION))).toHaveLength(1)
  })

  it('P8-01 blind review B1: the subagent\'s Run carries the provenance of its parent agent\'s current Run, not of the first Run its parent session opened', () => {
    const parentRuns = (observed?.runs ?? []).filter(run => run.sessionIds.includes(SESSION))
    const [childRun] = (observed?.runs ?? []).filter(run => !run.sessionIds.includes(SESSION))
    expect(childRun?.provenance).toEqual(parentRuns.at(-1)?.provenance)
  })

  it('reachability: a second sdk launch cannot continue a session an sdk launch created', () => {
    expect(observed?.secondSdkPrompt.error, `the response: ${JSON.stringify(observed?.secondSdkPrompt)}; exit code ${String(observed?.secondSdkExitCode)}`).toBeDefined()
  })
})
