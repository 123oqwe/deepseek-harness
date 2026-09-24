/**
 * P8-01 acceptance[4] and P0-06 acceptance[1] on the SHIPPED `sdk` profile:
 * every Run opened under one SDK connection carries that connection's
 * negotiation, and an incompatible handshake is refused on the wire with
 * fields a program can read.
 *
 * One launch of `apps/cli/src/bin.ts --profile sdk`, driven over its stdio as
 * an SDK client drives it, against a keyless stand-in model that answers from
 * each request's content. The launch first sends an incompatible
 * `schemaVersion` and reads the refusal, then initializes with one optional
 * capability the server does not know, so the agreed negotiation is not the
 * empty default. Two sessions follow; the first delegates once through the
 * shipped `subagent` tool, so a subagent's Run is among the Runs. After
 * `shutdown` the Run Service's store file is read, the way a restarted host
 * reads it.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import type { StubToolCall } from '@deepseek-ai/dsh-session-snapshot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isFirstStepAfterPrompt, startRoutingStubModelServer, type StubRequest } from '../../../apps/cli/tests/profiles/routing-stub-model.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

/** Text only the first session's task contains. */
const TASK_A = 'P801-SESSION-A: delegate the check once, then say ok.'
/** Text only the delegated child's prompt contains. */
const CHILD = 'P801-CHILD: reply with ok.'
/** Text only the second session's task contains. */
const TASK_B = 'P801-SESSION-B: say ok.'
/** An optional capability no server knows, so the negotiation records it as ignored. */
const UNKNOWN_OPTIONAL = 'x-p801-optional'

/** A Run as the store file holds it, reduced to the members read here. */
interface StoredRun {
  readonly id: string
  readonly sessionIds: readonly string[]
  readonly provenance?: { readonly negotiation?: unknown }
}

/**
 * Answer one request from what it carries.
 * @param request - the request body.
 * @returns the tool call this step makes, or `undefined` to answer with text.
 */
function answer(request: StubRequest): StubToolCall | undefined {
  if (isFirstStepAfterPrompt(request, TASK_A)) {
    return { name: 'subagent', arguments: { description: 'delegated check', prompt: CHILD } }
  }
  return undefined
}

interface Observation {
  refusal: Record<string, unknown>
  initialized: Record<string, unknown>
  runs: StoredRun[]
}

let observed: Observation | undefined
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
  const stub = await startRoutingStubModelServer(answer)
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p801-provenance-'))
  cleanup = async () => {
    await stub.close()
    await rm(dshHome, { recursive: true, force: true })
  }
  const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'sdk'], {
    cwd: repoRoot,
    env: {
      DSH_HOME: dshHome,
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'p801-keyless',
      DEEPSEEK_BASE_URL: stub.baseUrl,
    },
    timeout: 90_000,
    killSignal: 'SIGKILL',
    reject: false,
  })
  const frames: Record<string, unknown>[] = []
  let buffer = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      const frame = JSON.parse(line) as Record<string, unknown>
      // A server request (id and method) is answered, not left to stall the turn.
      if (frame.id !== undefined && typeof frame.method === 'string') {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32_601, message: `unanswered: ${frame.method}` } })}\n`)
      }
      frames.push(frame)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  const send = (frame: Record<string, unknown>): void => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`) }
  const wait = async (what: string, predicate: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 60_000
    for (;;) {
      const found = frames.find(predicate)
      if (found !== undefined) return found
      if (Date.now() > deadline) throw new Error(`no ${what} within 60 s; stderr:\n${stderr}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  const turnEnd = (sessionId: string) => (frame: Record<string, unknown>): boolean => {
    const params = frame.params as { sessionId?: unknown; event?: { type?: unknown } } | undefined
    return frame.method === 'session.event' && params?.sessionId === sessionId && params.event?.type === 'turn/end'
  }
  try {
    const base = { cwd: dshHome, provider: 'deepseek-official', model: 'deepseek-v4-pro' }
    send({ id: 1, method: 'initialize', params: { ...base, schemaVersion: { major: 3, minor: 0 } } })
    const refusal = await wait('the refused initialize', frame => frame.id === 1)
    send({ id: 2, method: 'initialize', params: { ...base, capabilities: [{ id: UNKNOWN_OPTIONAL, mandatory: false }] } })
    const initialized = await wait('the initialize result', frame => frame.id === 2)
    if (initialized.error !== undefined) throw new Error(`initialize refused: ${JSON.stringify(initialized.error)}`)
    send({ id: 3, method: 'session/prompt', params: { sessionId: 'p801-a', contentBlocks: [{ type: 'text', text: TASK_A }] } })
    await wait('session p801-a turn/end', turnEnd('p801-a'))
    send({ id: 4, method: 'session/prompt', params: { sessionId: 'p801-b', contentBlocks: [{ type: 'text', text: TASK_B }] } })
    await wait('session p801-b turn/end', turnEnd('p801-b'))
    send({ id: 5, method: 'shutdown' })
    await wait('the shutdown response', frame => frame.id === 5)
    const exit = await child
    if (exit.exitCode !== 0) throw new Error(`dsh --profile sdk exited ${String(exit.exitCode)}; stderr:\n${stderr}`)
    const store = JSON.parse(await readFile(join(dshHome, 'runs', 'runs.json'), 'utf8')) as { runs: StoredRun[] }
    observed = { refusal, initialized, runs: store.runs }
  } finally {
    child.kill('SIGKILL')
    await child
  }
}, 180_000)

afterAll(async () => { await cleanup?.() })

describe('P8-01 on the shipped sdk profile: the negotiation reaches every Run, and a refusal says why', () => {
  it('P0-06 acceptance[1]: the shipped sdk profile refuses an incompatible schemaVersion on the wire with its code and schemaId', () => {
    expect((observed?.refusal.error as { data?: unknown } | undefined)?.data).toEqual({
      code: 'SCHEMA_MAJOR_MISMATCH',
      schemaId: 'sdk-protocol:InitializeParams',
      encounteredVersion: { major: 3, minor: 0 },
      registeredVersion: { major: 1, minor: 0 },
    })
  })

  it('control: the shipped sdk profile opens one Run for each SDK session and one for the delegated subagent, so the case below measures provenance and not a missing Run', () => {
    // Read from the store alone, so the case does not depend on the name of any
    // notification the server sends.
    const sessions = (observed?.runs ?? []).map(run => run.sessionIds.join(','))
    expect(sessions).toHaveLength(3)
    expect(sessions).toEqual(expect.arrayContaining(['p801-a', 'p801-b']))
    expect(sessions.filter(ids => ids !== 'p801-a' && ids !== 'p801-b')).toHaveLength(1)
  })

  it('P8-01 acceptance[4]: every Run the connection opened, the subagent\'s included, carries the handshake\'s negotiation', () => {
    const negotiation = (observed?.initialized.result as { negotiation?: { ignoredCapabilities?: unknown } } | undefined)?.negotiation
    // Not the empty default: the unknown optional capability is recorded as ignored.
    expect(negotiation?.ignoredCapabilities).toEqual([UNKNOWN_OPTIONAL])
    expect(observed?.runs.length).toBe(3)
    for (const run of observed?.runs ?? []) {
      expect(run.provenance?.negotiation, `run ${run.id} (${run.sessionIds.join(', ')})`).toEqual(negotiation)
    }
  })
})
