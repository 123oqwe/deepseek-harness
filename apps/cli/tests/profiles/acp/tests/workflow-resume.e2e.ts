import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import { openLeaseStore } from '@deepseek-ai/dsh-lease-sqlite'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'
import {
  launchAcpTestAgent,
  startStubModelServer,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
  type StubModelServer,
} from '@deepseek-ai/dsh-session-snapshot'

/**
 * P4-08 acceptance[0] and acceptance[1] on the shipped acp composition, across
 * two real processes, read from what the product writes: the run's journal,
 * each child's session log, the lease rows, the model requests the stand-in
 * endpoint receives, and ACP's `tool_call_update`.
 *
 * The first host runs a three-child workflow and is SIGKILLed while one model
 * request goes unanswered: the first child's (K0), the second's (K1), the
 * third's (K2), or the parent's next request after the tool returned (K3). The
 * kill point is confirmed on disk before the kill: the journal names exactly
 * the finished steps, and each finished child's own log holds its `turn/end`.
 * Once the leases the dead host held have expired, a second host resumes the
 * session and the stand-in model calls `workflow` with `resume`.
 *
 * The run id reaches the model from the journal file name, not from the
 * product: the tool never shows a foreground run's id, so on the shipped
 * product nothing hands it to a model after a crash. These cases observe the
 * tool resuming a run it is given.
 *
 * Every scenario is driven once in `beforeAll` and the cases only read what it
 * recorded. `vitest.e2e.config.ts`'s `retry: 2` re-runs a case body and never
 * `beforeAll`, so a retry re-reads the same data.
 */

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}

/** The three child prompts, in the order the script awaits them. */
const CHILD_PROMPTS = ['P4-08 child one', 'P4-08 child two', 'P4-08 child three'] as const
/** Present in every child prompt and in no parent message. */
const CHILD_PROMPT_MARKER = 'P4-08 child'
const SCRIPT = `const a = await agent('${CHILD_PROMPTS[0]}'); const b = await agent('${CHILD_PROMPTS[1]}'); const c = await agent('${CHILD_PROMPTS[2]}'); return [a, b, c]`
/** The same script with one comment added, which changes its digest and nothing else. */
const CHANGED_SCRIPT = `${SCRIPT}\n// changed after the kill`
const META = { name: 'p408-resume-probe', description: 'Three sequential children, killed and resumed.' }
/** What every child of the killed host answers. */
const FIRST_HOST_OUTPUT = 'P4-08 output from the killed host'
/** What every child of the restarted host answers. */
const SECOND_HOST_OUTPUT = 'P4-08 output from the restarted host'
const START_CALL_ID = 'p408-start'
const RESUME_CALL_ID = 'p408-resume'

/** The margin past the dead host's last expiry before the second hosts start. */
const EXPIRY_MARGIN_MS = 1_000
/** A bound on the lease wait: the shipped leases expire at most 30 s after the kill. */
const MAX_LEASE_WAIT_MS = 45_000
/** A bound on the wait for the first host's journal to stand at the kill point. */
const JOURNAL_WAIT_MS = 30_000

/** Where the first host is killed, and what the second host resumes with. */
interface KillPoint {
  /** The label the case titles use. */
  readonly label: string
  /** 1-based arrival index of the model request the first host never gets an answer to. */
  readonly hold: number
  /** How many `agent()` calls had completed when the first host died. */
  readonly finished: number
  /** The script the resume call carries. */
  readonly resumeScript: string
}

const K0: KillPoint = { label: 'K0', hold: 2, finished: 0, resumeScript: SCRIPT }
const K1: KillPoint = { label: 'K1', hold: 3, finished: 1, resumeScript: SCRIPT }
const K2: KillPoint = { label: 'K2', hold: 4, finished: 2, resumeScript: SCRIPT }
const K3: KillPoint = { label: 'K3', hold: 5, finished: 3, resumeScript: SCRIPT }
const CHANGED: KillPoint = { label: 'K2 with a changed script', hold: 4, finished: 2, resumeScript: CHANGED_SCRIPT }
const SCENARIOS: readonly KillPoint[] = [K0, K1, K2, K3, CHANGED]

/** The fields of a run's journal file (`dsh-workflow-journal`'s `WorkflowJournal`) these cases read. */
interface JournalFile {
  readonly scriptDigest: string
  readonly entries: readonly {
    readonly stepId: string
    readonly outcome: string
    readonly childReceipts: readonly string[]
    readonly verified: boolean
  }[]
}

/** What the SIGKILLed first host left on disk. */
interface Killed {
  readonly cwd: string
  readonly sessionId: string
  /** The interrupted run: the one journal file the first host wrote is named after it. */
  readonly runId: string
  /** The run's journal as it stood when the first host was killed. */
  readonly atKill: JournalFile
  /** When the later of the session's and the run's lease rows, as the dead host left them, expires. */
  readonly leasesExpireAtMs: number
}

/** What the restarted host did with the resume call, read after its turn ended. */
interface Resumed {
  /** ACP's status for the resume call: `completed`, or `failed` for an isError result. */
  readonly status: string | undefined
  /** The resume call's result as the model read it: the `tool` message in the restarted host's next request. */
  readonly text: string | undefined
  /** Model requests the restarted host's workflow children made. */
  readonly childRequests: number
  /** The run id of every journal file after the restarted host's turn, sorted. */
  readonly journalIds: readonly string[]
  /** The interrupted run's journal after the restarted host's turn. */
  readonly journal: JournalFile | undefined
  /** The journals a refused resume kept aside under `refused/`, by file name. */
  readonly refused: readonly JournalFile[]
}

interface Observation {
  readonly killed: Killed
  readonly resumed: Resumed
}

/** Everything the scenarios acquired, released in `afterAll` whether or not they finished. */
const owned = {
  hosts: [] as LaunchedAcpTestAgent[],
  stubs: [] as StubModelServer[],
  workdirs: [] as string[],
}
const observations = new Map<KillPoint, Observation>()
const failures = new Map<KillPoint, unknown>()

/**
 * The launch environment for one host: keyless, pointed at its stand-in
 * endpoint, and in the mode where neither tool asks for approval.
 * @param stub - the endpoint this host's model requests go to.
 * @returns the extra environment for the launch.
 */
function envFor(stub: StubModelServer): Record<string, string> {
  return {
    DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
    DEEPSEEK_BASE_URL: stub.baseUrl,
    DSH_PERMISSION_MODE: 'danger-full-access',
  }
}

/**
 * Every journal a launch wrote, by run id: `dshHomePath('journals')` holds one
 * `<runId>.json` per run (`workflow-journal/src/store.ts:25`), and the
 * launcher points `DSH_HOME` at `<cwd>/.dsh`. A journal is replaced by rename,
 * so each file read is one whole version of it.
 * @param cwd - the launch directory.
 * @param subdirectory - a subdirectory of the journals directory to read instead, such as `refused`.
 * @returns the journals, keyed by run id (by file name without `.json` in a subdirectory).
 */
async function journalsUnder(cwd: string, subdirectory?: string): Promise<Map<string, JournalFile>> {
  const directory = join(cwd, '.dsh', 'journals', ...subdirectory === undefined ? [] : [subdirectory])
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  const journals = new Map<string, JournalFile>()
  for (const name of names.filter(entry => entry.endsWith('.json'))) {
    journals.set(name.slice(0, -'.json'.length), JSON.parse(await readFile(join(directory, name), 'utf8')) as JournalFile)
  }
  return journals
}

/**
 * Whether a journal stands exactly at a kill point: the finished steps
 * completed and, before the last one, the next step in flight.
 * @param journal - the journal to test.
 * @param finished - how many steps the kill point has completed.
 * @returns whether the step outcomes are exactly that.
 */
function standsAt(journal: JournalFile, finished: number): boolean {
  const expected = [
    ...Array.from({ length: finished }, () => 'completed'),
    ...finished < CHILD_PROMPTS.length ? ['in-flight'] : [],
  ]
  return journal.entries.map(entry => entry.outcome).join() === expected.join()
}

/**
 * The event types one session's durable log holds, decoded from its complete
 * Zstandard frames. Chosen by session id, because the directory also holds the
 * parent's log and every other child's; a torn tail is left undecoded, because
 * the host that wrote it may have died mid-write.
 * @param cwd - the launch directory.
 * @param sessionId - the session whose log is read.
 * @returns the event types in log order; empty when no log was written.
 */
async function durableEventTypes(cwd: string, sessionId: string): Promise<string[]> {
  const root = join(cwd, '.dsh', 'sessions')
  const log = (await readdir(root, { recursive: true }))
    .find(path => path.endsWith('.jsonl.zstd') && basename(dirname(path)) === sessionId)
  if (log === undefined) return []
  const bytes = await readFile(join(root, log))
  return scanZstdFrames(bytes).frames
    .flatMap(({ start, end }) => zstdDecompressSync(bytes.subarray(start, end)).toString().split('\n'))
    .filter(line => line.trim().length > 0)
    .map(line => (JSON.parse(line) as { readonly type: string }).type)
}

/** One wire message of a DeepSeek chat request, as the stand-in endpoint recorded it. */
interface WireMessage {
  readonly role?: unknown
  readonly content?: unknown
  readonly tool_call_id?: unknown
}

/**
 * A recorded request's messages.
 * @param request - one request body the stand-in endpoint received.
 * @returns its `messages`, or none when it carries no array.
 */
function messagesOf(request: Record<string, unknown>): readonly WireMessage[] {
  return Array.isArray(request.messages) ? request.messages as readonly WireMessage[] : []
}

/**
 * The text of one wire message's content, which is a string or a list of parts.
 * @param content - the message's `content`.
 * @returns its text parts joined.
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => (typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).join('')
}

/**
 * Whether one user message of a request carries the given text.
 * @param request - one recorded request body.
 * @param text - the text to find.
 * @returns whether a `user` message contains it.
 */
function userMessageContains(request: Record<string, unknown>, text: string): boolean {
  return messagesOf(request).some(message => message.role === 'user' && messageText(message.content).includes(text))
}

/**
 * What the model read as one tool call's result: the `tool` message answering
 * it, in the first recorded request that carries one.
 * @param requests - the requests one stand-in endpoint received.
 * @param callId - the tool call's wire id.
 * @returns the result text, or `undefined` when no request carries it.
 */
function toolResultText(requests: readonly Record<string, unknown>[], callId: string): string | undefined {
  for (const request of requests) {
    const answer = messagesOf(request).find(message => message.role === 'tool' && message.tool_call_id === callId)
    if (answer !== undefined) return messageText(answer.content)
  }
  return undefined
}

/**
 * The agent count and value a completed `workflow` result reports to the model
 * (`tool-workflow/src/index.ts` `renderResult`).
 * @param text - the result text the model read.
 * @returns the count and the parsed value, or `undefined` when the text reports no completed run.
 */
function reported(text: string | undefined): { readonly agentsStarted: number; readonly value: unknown } | undefined {
  const match = /completed \((\d+) agents?\)\.\nReturn value:\n([\s\S]*)$/u.exec(text ?? '')
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { agentsStarted: Number(match[1]), value: JSON.parse(match[2]) as unknown }
}

/**
 * Drive a first host until the kill point's request is held, confirm the kill
 * point on disk, and SIGKILL it: no disposer runs, so neither lease it holds
 * is renewed or released.
 * @param point - where to kill it.
 * @returns what the dead host left behind.
 */
async function killAtPoint(point: KillPoint): Promise<Killed> {
  const cwd = await mkdtemp(join(tmpdir(), 'acp-e2e-workflow-resume-'))
  owned.workdirs.push(cwd)
  const stub = await startStubModelServer({
    toolCalls: [{ id: START_CALL_ID, name: 'workflow', arguments: { script: SCRIPT, meta: META } }],
    content: FIRST_HOST_OUTPUT,
    holdRequest: point.hold,
  })
  owned.stubs.push(stub)
  const host = launchAcpTestAgent({ agent: AGENT, cwd, env: envFor(stub) })
  owned.hosts.push(host)
  await host.spawned
  await host.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  const { sessionId } = await host.client.newSession({ cwd, mcpServers: [] })
  const turn = host.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'Run the three-child workflow.' }] })
  // The turn cannot end while a request is held; one that ends first never reached the kill point.
  const held = await Promise.race([
    stub.held,
    turn.then(() => { throw new Error(`${point.label}: the first host's turn ended before request ${String(point.hold)} arrived`) }),
  ])

  const firstRequestTools: unknown = stub.requests[0]?.tools
  const offersWorkflow = Array.isArray(firstRequestTools)
    && (firstRequestTools as readonly { readonly function?: { readonly name?: unknown } }[])
      .some(tool => tool.function?.name === 'workflow')
  if (!offersWorkflow) throw new Error(`${point.label}: the shipped acp composition did not offer the model the workflow tool`)
  const heldIsThePointsRequest = point.finished < CHILD_PROMPTS.length
    ? userMessageContains(held, CHILD_PROMPTS[point.finished] ?? '')
    : toolResultText([held], START_CALL_ID) !== undefined
  if (!heldIsThePointsRequest) throw new Error(`${point.label}: request ${String(point.hold)} is not the model call this kill point holds`)

  const [runId, atKill] = await vi.waitFor(async () => {
    const journals = [...(await journalsUnder(cwd)).entries()]
    const only = journals.length === 1 ? journals[0] : undefined
    if (only === undefined || !standsAt(only[1], point.finished)) {
      throw new Error(`${point.label}: the first host's journals do not stand at ${String(point.finished)} finished steps: ${JSON.stringify(journals)}`)
    }
    return only
  }, { timeout: JOURNAL_WAIT_MS, interval: 50 })
  // A step the journal calls completed is reused only if its child's own log
  // says so too, so the kill point is not reached until both are on disk.
  for (const entry of atKill.entries.slice(0, point.finished)) {
    for (const child of entry.childReceipts) {
      if (!(await durableEventTypes(cwd, child)).includes('turn/end')) {
        throw new Error(`${point.label}: ${entry.stepId}'s child ${child} has no durable turn/end at the kill point`)
      }
    }
  }
  await host.close('SIGKILL')

  const leases = openLeaseStore(join(cwd, '.dsh', 'leases'))
  const sessionLease = leases.get(sessionId as WorkItemId)
  if (sessionLease === undefined) throw new Error(`${point.label}: the killed host held no lease row for session ${sessionId}`)
  // Absent at K3: a settled run gives its lease back when it is disposed.
  const runLease = leases.get(runId as WorkItemId)
  return {
    cwd,
    sessionId,
    runId,
    atKill,
    leasesExpireAtMs: Math.max(sessionLease.expiresAtMs, runLease?.expiresAtMs ?? 0),
  }
}

/**
 * Start a second host on the dead one's directory, resume its session, and
 * let the stand-in model resume the interrupted run.
 * @param point - the kill point, which names the script the resume carries.
 * @param killed - what the dead host left behind.
 * @returns what the second host did with the resume.
 */
async function resumeAfterKill(point: KillPoint, killed: Killed): Promise<Resumed> {
  const stub = await startStubModelServer({
    toolCalls: [{
      id: RESUME_CALL_ID,
      name: 'workflow',
      arguments: { resume: killed.runId, script: point.resumeScript, meta: META },
    }],
    content: SECOND_HOST_OUTPUT,
  })
  owned.stubs.push(stub)
  const host = launchAcpTestAgent({ agent: AGENT, cwd: killed.cwd, env: envFor(stub) })
  owned.hosts.push(host)
  await host.spawned
  await host.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
  await host.client.resumeSession({ sessionId: killed.sessionId, cwd: killed.cwd, mcpServers: [] })
  await host.client.prompt({ sessionId: killed.sessionId, prompt: [{ type: 'text', text: 'Resume the interrupted workflow.' }] })

  const journals = await journalsUnder(killed.cwd)
  const refused = await journalsUnder(killed.cwd, 'refused')
  let status: string | undefined
  for (const update of host.updates) {
    if (update.sessionUpdate === 'tool_call_update' && update.toolCallId === RESUME_CALL_ID) status = update.status ?? undefined
  }
  // Everything read above was on disk or delivered before the prompt returned.
  await host.close('SIGKILL')
  return {
    status,
    text: toolResultText(stub.requests, RESUME_CALL_ID),
    childRequests: stub.requests.filter(request => userMessageContains(request, CHILD_PROMPT_MARKER)).length,
    journalIds: [...journals.keys()].sort(),
    journal: journals.get(killed.runId),
    refused: [...refused.keys()].sort().map(name => refused.get(name) as JournalFile),
  }
}

/**
 * The observation `beforeAll` recorded for one kill point.
 * @param point - the kill point.
 * @returns its observation.
 * @throws when that scenario did not reach its observation, carrying why.
 */
function observed(point: KillPoint): Observation {
  const observation = observations.get(point)
  if (observation !== undefined) return observation
  throw new Error(`${point.label}: beforeAll recorded no observation`, { cause: failures.get(point) })
}

/**
 * The values a resume from a kill point returns: the killed host's outputs
 * for the steps that finished before the kill, the restarted host's after.
 * @param finished - how many steps finished before the kill.
 * @returns the expected return value.
 */
function expectedValues(finished: number): string[] {
  return CHILD_PROMPTS.map((_prompt, index) => (index < finished ? FIRST_HOST_OUTPUT : SECOND_HOST_OUTPUT))
}

/**
 * Assert the resumed run kept the interrupted run's id: a fresh start writes
 * a journal under a new id beside it.
 * @param point - the kill point.
 */
function assertKeepsRunId(point: KillPoint): void {
  const { killed, resumed } = observed(point)
  expect(resumed.journalIds).toEqual([killed.runId])
  expect(resumed.status).toBe('completed')
}

/**
 * Assert the steps finished before the kill kept their child, were verified by
 * the resume, and started no child again.
 * @param point - the kill point.
 */
function assertKeepsFinishedSteps(point: KillPoint): void {
  const { killed, resumed } = observed(point)
  const entries = resumed.journal?.entries ?? []
  expect(entries.map(entry => entry.outcome)).toEqual(CHILD_PROMPTS.map(() => 'completed'))
  const finished = entries.slice(0, point.finished)
  expect(finished.map(entry => entry.childReceipts))
    .toEqual(killed.atKill.entries.slice(0, point.finished).map(entry => entry.childReceipts))
  // `verified` is set only by a resume that reconciled the step against its
  // child's log (`workflow-worker-thread/src/host.ts`), never by a first run.
  expect(finished.map(entry => entry.verified)).toEqual(finished.map(() => true))
  expect(resumed.childRequests).toBe(CHILD_PROMPTS.length - point.finished)
}

/**
 * Assert the resumed run returned each finished child's real output.
 * @param point - the kill point.
 */
function assertReturnsRealOutputs(point: KillPoint): void {
  expect(reported(observed(point).resumed.text)?.value).toEqual(expectedValues(point.finished))
}

beforeAll(async () => {
  const kills = await Promise.allSettled(SCENARIOS.map(point => killAtPoint(point)))
  const reached: { readonly point: KillPoint; readonly killed: Killed }[] = []
  for (const [index, outcome] of kills.entries()) {
    const point = SCENARIOS[index]
    if (point === undefined) continue
    if (outcome.status === 'fulfilled') reached.push({ point, killed: outcome.value })
    else failures.set(point, outcome.reason)
  }
  if (reached.length === 0) return

  // One wait for every scenario: the second hosts start once the latest lease
  // any dead host left has expired.
  const waitMs = Math.max(...reached.map(({ killed }) => killed.leasesExpireAtMs)) - Date.now() + EXPIRY_MARGIN_MS
  if (waitMs > MAX_LEASE_WAIT_MS) throw new Error(`a dead host's lease expires in ${String(waitMs)} ms, longer than the shipped lease allows`)
  if (waitMs > 0) await sleep(waitMs)

  const resumes = await Promise.allSettled(reached.map(({ point, killed }) => resumeAfterKill(point, killed)))
  for (const [index, outcome] of resumes.entries()) {
    const scenario = reached[index]
    if (scenario === undefined) continue
    if (outcome.status === 'fulfilled') observations.set(scenario.point, { killed: scenario.killed, resumed: outcome.value })
    else failures.set(scenario.point, outcome.reason)
  }
}, 300_000)

afterAll(async () => {
  const results = [
    ...await Promise.allSettled(owned.hosts.splice(0).map(host => host.close('SIGKILL'))),
    ...await Promise.allSettled(owned.stubs.splice(0).map(stub => stub.close())),
    ...await Promise.allSettled(owned.workdirs.splice(0).map(workdir => rm(workdir, { recursive: true, force: true }))),
  ]
  const cleanupFailures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason as unknown)
  if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, 'workflow-resume e2e cleanup failed')
}, 60_000)

describe('P4-08 acceptance[0]: a workflow killed at an agent() boundary is resumed by a restarted acp host without repeating finished child work (no key required)', () => {
  it('K0: the resumed run keeps the interrupted run id', () => { assertKeepsRunId(K0) })
  it('K1: the resumed run keeps the interrupted run id', () => { assertKeepsRunId(K1) })
  it('K2: the resumed run keeps the interrupted run id', () => { assertKeepsRunId(K2) })
  it('K3: the resumed run keeps the interrupted run id', () => { assertKeepsRunId(K3) })

  it('K1: steps finished before the kill keep their original child and are not started again', () => { assertKeepsFinishedSteps(K1) })
  it('K2: steps finished before the kill keep their original child and are not started again', () => { assertKeepsFinishedSteps(K2) })
  it('K3: steps finished before the kill keep their original child and are not started again', () => { assertKeepsFinishedSteps(K3) })

  it('K1: the resumed values are the children\'s real outputs', () => { assertReturnsRealOutputs(K1) })
  it('K2: the resumed values are the children\'s real outputs', () => { assertReturnsRealOutputs(K2) })
  it('K3: the resumed values are the children\'s real outputs', () => { assertReturnsRealOutputs(K3) })
})

describe('P4-08 acceptance[1]: a changed script is refused visibly and restarted by a restarted acp host (no key required)', () => {
  it('the refusal reaches the caller: the tool result names script-digest-changed', () => {
    const { resumed } = observed(CHANGED)
    expect(resumed.status).toBe('completed')
    expect(resumed.text).toMatch(/^resume refused \(script-digest-changed\)/u)
  })

  it('the refused journal is kept: the interrupted run\'s record survives under its old digest', () => {
    const { resumed } = observed(CHANGED)
    expect(resumed.refused.map(journal => journal.scriptDigest)).toEqual([createHash('sha256').update(SCRIPT).digest('hex')])
    expect(standsAt(resumed.refused[0] as JournalFile, CHANGED.finished)).toBe(true)
  })

  it('restart is observed: the same run id starts every child again under the new digest', () => {
    const { killed, resumed } = observed(CHANGED)
    expect(resumed.journalIds).toEqual([killed.runId])
    expect(resumed.journal?.scriptDigest).toBe(createHash('sha256').update(CHANGED_SCRIPT).digest('hex'))
    expect(resumed.childRequests).toBe(CHILD_PROMPTS.length)
    expect(reported(resumed.text)).toEqual({ agentsStarted: CHILD_PROMPTS.length, value: expectedValues(0) })
  })
})
