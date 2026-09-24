import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { checkFencing, type Lease, type WorkItemId } from '@deepseek-ai/dsh-lease-contract'
import { openLeaseStore } from '@deepseek-ai/dsh-lease-sqlite'
import {
  launchAcpTestAgent,
  startStubModelServer,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { attachedPrincipal, countRecords, persistedHostUserId, readSessionLog } from '../../session-log.ts'
import { cleanupAcpExampleTest } from './cleanup.ts'

/**
 * End-to-end: boot the shipped ACP profile as a real subprocess speaking ACP over
 * its stdio, drive it with a real ACP SDK client app, send a real prompt, and
 * verify the WORLD (a file the agent wrote), not the agent's self-report. Owns
 * and disposes the subprocess in afterEach. Key-gated.
 *
 * Also asserts stdout purity (only framed JSON-RPC on stdout) — that one runs
 * WITHOUT a key, since it only needs the server to boot and answer initialize.
 */

const AGENT: AgentUnderTest = {
  binScript: fileURLToPath(new URL('../../../../src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  profile: 'acp',
  tsconfigPath: fileURLToPath(new URL('../../../../../../tsconfig.json', import.meta.url)),
}
const DANGER_FULL_ACCESS_ENV = { DSH_PERMISSION_MODE: 'danger-full-access' }

/**
 * Where this profile persists sessions: `dshHomePath('sessions')`
 * (`../cordis.yml:30`), and the launcher points `DSH_HOME` at the test's own
 * directory (`session-snapshot/src/launcher.ts:132`).
 * @param cwd - the directory the agent was launched in.
 * @returns that launch's session storage directory.
 */
function sessionsRootFor(cwd: string): string {
  return join(cwd, '.dsh', 'sessions')
}

/**
 * Every stored Run that names one session, read from the Run Service's store
 * file: `dshHomePath('runs', 'runs.json')` on `dsh-base`'s `run` row, which
 * this profile does not override.
 * @param cwd - the directory the agent was launched in.
 * @param sessionId - the session the Runs belong to.
 * @returns the Run ids, in store order.
 */
async function runIdsForSession(cwd: string, sessionId: string): Promise<string[]> {
  const document = JSON.parse(await readFile(join(cwd, '.dsh', 'runs', 'runs.json'), 'utf8')) as {
    readonly runs: readonly { readonly id: string; readonly sessionIds: readonly string[] }[]
  }
  return document.runs.filter(run => run.sessionIds.includes(sessionId)).map(run => run.id)
}

/**
 * A file's text, or `undefined` when the file was never written.
 * @param path - the file to read.
 * @returns its contents, or `undefined` on ENOENT; any other failure throws.
 */
async function readIfWritten(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

let spawned: LaunchedAcpTestAgent | undefined
let workdir: string | undefined

afterEach(async () => {
  const ownedSpawned = spawned
  const ownedWorkdir = workdir
  spawned = undefined
  workdir = undefined
  await cleanupAcpExampleTest(ownedSpawned, ownedWorkdir)
})

describe('acp-agent over real stdio (no key required)', () => {
  it('emits only framed JSON-RPC on stdout', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    // Inspect the launcher's raw-byte tee in addition to driving its SDK client.
    // A dummy key lets the deepseek adapter APPLY (it only checks the key is
    // present at boot, not valid — the key is used only on a real model call,
    // which this purity test never triggers). So this runs WITHOUT real creds.
    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-boot',
        ...DANGER_FULL_ACCESS_ENV,
      },
    })
    await spawned.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    const lines = spawned.rawStdout().split('\n').filter(line => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      // Every stdout line MUST parse as JSON (a JSON-RPC frame). A non-JSON
      // line means a logger/print leaked onto the protocol channel.
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
  }, 30_000)

  it('session/new succeeds over real stdio (no model call)', async () => {
    // REGRESSION GUARD (this exact RPC exposed the missing-inject Loader bug):
    // `session/new` drives the
    // full bridge → `ctx.agents.create({sessionId, meta:{cwd}})` → AgentLoop →
    // registry/persistence path, ALL of which run from the JSON-RPC read loop
    // OUTSIDE the bridge plugin's injection scope. A lazy `ctx.<service>` read
    // on that path throws and the RPC fails with an Internal error — yet the
    // call never touches the model, so this reproduces WITHOUT a key. The
    // key-gated prompt test below never caught it (it needs real creds); the
    // initialize-only purity test never caught it (initialize does not reach
    // the factory). This closes that gap: boot the real subprocess and create a
    // session, asserting the RPC RESOLVES (not rejects with an inject error).
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    // A dummy key lets the deepseek adapter boot (it only checks presence, not
    // validity, at apply time); no model call is made, so the key is never used.
    spawned = launchAcpTestAgent({
      agent: AGENT,
      cwd: workdir,
      env: {
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? 'sk-dummy-for-boot',
        ...DANGER_FULL_ACCESS_ENV,
      },
    })
    const { client } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })
    expect(typeof sessionId).toBe('string')
    expect(sessionId.length).toBeGreaterThan(0)
  }, 60_000)

  /*
   * P2-01 acceptance[0] on the ACP surface: the first action manifest names
   * the host-user principal, exactly one `identity/attached` is logged, and a
   * resume adds no second record.
   *
   * The commit before this one asserted the opposite values — the anonymous
   * principal and zero attachments — and was observed green, so what these
   * conditions replaced is on record rather than assumed.
   *
   * Keyless with a real action: the stand-in model endpoint answers the turn
   * with one `bash` call, so the session genuinely appends an action manifest
   * without a credential and without network egress. `session/new` alone would
   * append none, and "the manifest follows by construction" is precisely the
   * inference this program stopped accepting.
   */
  it('P2-01 acceptance[0]: a launched acp session acts as the host user, attached once', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-host-user-'))
    const stub = await startStubModelServer({
      // Per request: call, close the turn, then call again after the resume.
      // The second call is what proves `session/resume` really composed an
      // Agent -- only a running Agent appends a manifest.
      toolCalls: [
        { name: 'bash', arguments: { command: 'printf ACP_OK > first.txt', description: 'Write the first proof file' } },
        undefined,
        { name: 'bash', arguments: { command: 'printf ACP_OK > second.txt', description: 'Write the second proof file' } },
      ],
    })
    const env = {
      DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
      DEEPSEEK_BASE_URL: stub.baseUrl,
      ...DANGER_FULL_ACCESS_ENV,
    }
    let first: LaunchedAcpTestAgent | undefined
    let second: LaunchedAcpTestAgent | undefined
    try {
      first = launchAcpTestAgent({ agent: AGENT, cwd: workdir, env })
      await first.spawned
      await first.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      const { sessionId } = await first.client.newSession({ cwd: workdir, mcpServers: [] })
      await first.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'write the proof file' }],
      })
      await first.client.closeSession({ sessionId })
      await first.close()
      first = undefined

      // The first manifest, not any of them: acceptance[0] is about what the
      // session was attributed to from its first action onward.
      const log = await readSessionLog(sessionsRootFor(workdir))
      const manifests = log.records.filter(record => record.type === 'action/manifest-appended')
      expect(manifests.length).toBeGreaterThan(0)
      expect(manifests[0]?.data?.actor).not.toMatch(/^anonymous:/)
      expect(manifests[0]?.data?.actor).toBe(attachedPrincipal(log))
      expect(countRecords(log, 'identity/attached')).toBe(1)

      // And that principal is THE host user, not merely some non-anonymous
      // one: the launcher persisted this id under its own home, and
      // `hostUserIdentity` brands that exact string as the principal id.
      expect(attachedPrincipal(log)).toBe(await persistedHostUserId(join(workdir, '.dsh')))

      // The resume half, through the surface's own `session/resume` method
      // (`packages/acp/acp/src/index.ts:430`). The `identity/attached` count
      // goes 1 -> 1, because the resumed launch resolves the same persisted
      // host user and `resolveSessionIdentity` logs only a change. Asserting
      // "no second record" alone would hold vacuously if the resumed session
      // never composed an Agent, so one more prompt runs and the growing
      // manifest count is asserted first: only a composed, running Agent
      // appends one.
      second = launchAcpTestAgent({ agent: AGENT, cwd: workdir, env })
      await second.spawned
      await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await second.client.resumeSession({ sessionId, cwd: workdir, mcpServers: [] })
      await second.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'write the second proof file' }],
      })
      await second.client.closeSession({ sessionId })

      const resumed = await readSessionLog(sessionsRootFor(workdir))
      const resumedManifests = resumed.records.filter(record => record.type === 'action/manifest-appended')
      expect(resumedManifests.length).toBeGreaterThan(manifests.length)
      expect(resumedManifests.at(-1)?.data?.actor).toBe(attachedPrincipal(resumed))
      expect(countRecords(resumed, 'identity/attached')).toBe(1)
    } finally {
      await stub.close()
      await Promise.allSettled([first?.close(), second?.close()]
        .filter((value): value is Promise<void> => value !== undefined))
    }
  }, 120_000)
})

/** What the SIGKILLed host left on disk, read before and after it died. */
interface KilledHost {
  readonly sessionId: string
  /** The Runs the store names for the session, read while the host was alive. */
  readonly runIds: readonly string[]
  /** The session's lease row, read while the host was alive: its token is `{ workItem, epoch, holder }`. */
  readonly lease: Lease
  /** A second connection to the host's `leases.sqlite`, opened after the host created it. */
  readonly leases: ReturnType<typeof openLeaseStore>
}

/** Everything the takeover cases assert, recorded once. */
interface TakeoverObservation {
  readonly killed: KilledHost
  /** The lease row after the wait, read immediately before the second host starts. */
  readonly restartLease: Lease | undefined
  /** When `restartLease` was read. */
  readonly restartObservedAtMs: number
  /** The Runs the store names for the session after the second host's turn. */
  readonly runIdsAfter: readonly string[]
  /** The lease row after the second host's turn, read while it is still alive. */
  readonly currentLease: Lease | undefined
  /** `second.txt`, which only the second host's tool call writes. */
  readonly secondProof: string | undefined
}

/** The margin past the dead host's last expiry before the second host starts. */
const EXPIRY_MARGIN_MS = 1_000
/** A bound on the wait: the shipped lease expires at most 30 s after the kill, so a longer wait means the row is not that lease. */
const MAX_LEASE_WAIT_MS = 45_000

/**
 * Drive one host through a tool call, read what it wrote to disk, then SIGKILL
 * it: no disposer runs, so its lease is neither renewed nor released.
 * @param cwd - the launch directory both hosts share, and so one `DSH_HOME`.
 * @param env - the launch environment.
 * @returns what the host left behind.
 */
async function runThenKillHost(cwd: string, env: Record<string, string>): Promise<KilledHost> {
  const host = launchAcpTestAgent({ agent: AGENT, cwd, env })
  try {
    await host.spawned
    await host.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await host.client.newSession({ cwd, mcpServers: [] })
    await host.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'write the first proof file' }] })
    // The work item is the session (`RunPlugin.open`), and the host opened the
    // store before its first Run, so the file exists by now.
    const leases = openLeaseStore(join(cwd, '.dsh', 'leases'))
    const lease = leases.get(sessionId as WorkItemId)
    if (lease === undefined) throw new Error(`the host holds no lease row for session ${sessionId}`)
    return { sessionId, runIds: await runIdsForSession(cwd, sessionId), lease, leases }
  } finally {
    await host.close('SIGKILL')
  }
}

/*
 * P4-05 acceptance[2]'s reclaim branch across two real processes, read only
 * from what the product writes to disk: the lease row in `leases.sqlite`, the
 * Run store, and the file the tool call writes.
 *
 * The first host is SIGKILLed, and the test waits out the lease it last renewed
 * (the shipped 30 s; nothing here shortens `leaseMs`) before the second host
 * resumes the session and runs one tool call. Each observation is made once in
 * `beforeAll`, and the cases only read them. `vitest.e2e.config.ts`'s `retry: 2`
 * re-runs a case body and never `beforeAll`, so a retry re-reads the same data
 * and cannot turn a first failure into a pass.
 *
 * Not observed: the in-process `orphaned` lifecycle label, which the adopting
 * host writes only to `agent.lifecycle` and to a log line no shipped exporter
 * prints, and acceptance[2]'s "fail safely" branch, which has no producer.
 */
describe('P4-05 acceptance[2]: a restarted acp host takes over the Run a SIGKILLed host left behind (no key required)', () => {
  let takeoverWorkdir: string | undefined
  let stub: Awaited<ReturnType<typeof startStubModelServer>> | undefined
  let second: LaunchedAcpTestAgent | undefined
  let observed: TakeoverObservation | undefined

  const observation = (): TakeoverObservation => {
    if (observed === undefined) throw new Error('beforeAll recorded no takeover observation')
    return observed
  }

  beforeAll(async () => {
    takeoverWorkdir = await mkdtemp(join(tmpdir(), 'acp-e2e-takeover-'))
    const cwd = takeoverWorkdir
    stub = await startStubModelServer({
      toolCalls: [
        { name: 'bash', arguments: { command: 'printf ACP_OK > first.txt', description: 'Write the first proof file' } },
        undefined,
        { name: 'bash', arguments: { command: 'printf ACP_OK > second.txt', description: 'Write the second proof file' } },
      ],
    })
    const env = {
      DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
      DEEPSEEK_BASE_URL: stub.baseUrl,
      ...DANGER_FULL_ACCESS_ENV,
    }

    const killed = await runThenKillHost(cwd, env)
    // Read again after the kill: a heartbeat between the first read and the
    // kill moves the expiry, and the wait is for the row as the dead host left it.
    const atKill = killed.leases.get(killed.lease.workItem)
    if (atKill === undefined) throw new Error(`the lease row for session ${killed.sessionId} vanished at the kill`)
    const waitMs = atKill.expiresAtMs - Date.now() + EXPIRY_MARGIN_MS
    if (waitMs > MAX_LEASE_WAIT_MS) throw new Error(`the dead host's lease expires in ${String(waitMs)} ms, longer than the shipped lease allows`)
    if (waitMs > 0) await sleep(waitMs)
    const restartLease = killed.leases.get(killed.lease.workItem)
    const restartObservedAtMs = Date.now()

    second = launchAcpTestAgent({ agent: AGENT, cwd, env })
    await second.spawned
    await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await second.client.resumeSession({ sessionId: killed.sessionId, cwd, mcpServers: [] })
    await second.client.prompt({
      sessionId: killed.sessionId,
      prompt: [{ type: 'text', text: 'write the second proof file' }],
    })

    observed = {
      killed,
      restartLease,
      restartObservedAtMs,
      runIdsAfter: await runIdsForSession(cwd, killed.sessionId),
      currentLease: killed.leases.get(killed.lease.workItem),
      secondProof: await readIfWritten(join(cwd, 'second.txt')),
    }
  }, 180_000)

  afterAll(async () => {
    const ownedSecond = second
    const ownedWorkdir = takeoverWorkdir
    second = undefined
    takeoverWorkdir = undefined
    try {
      await stub?.close()
    } finally {
      await cleanupAcpExampleTest(ownedSecond, ownedWorkdir)
    }
  })

  it('orphan: before the second host starts, the lease row still names the killed host at its epoch and has expired', () => {
    const { killed, restartLease, restartObservedAtMs } = observation()
    expect(restartLease?.holder).toBe(killed.lease.holder)
    expect(restartLease?.epoch).toBe(killed.lease.epoch)
    expect(restartLease?.expiresAtMs).toBeLessThan(restartObservedAtMs)
  })

  it('the second host continues the same Run id the killed host opened', () => {
    const { killed, runIdsAfter } = observation()
    expect(killed.runIds).toHaveLength(1)
    expect(runIdsAfter).toEqual(killed.runIds)
  })

  it('the lease row now names the second host', () => {
    const { killed, currentLease } = observation()
    expect(currentLease).toBeDefined()
    expect(currentLease?.holder).not.toBe(killed.lease.holder)
  })

  it('the lease row carries an epoch greater than the killed host\'s', () => {
    const { killed, currentLease } = observation()
    expect(currentLease?.epoch).toBeGreaterThan(killed.lease.epoch)
  })

  it('the killed host\'s token is refused as stale-epoch against the current lease', () => {
    const { killed, currentLease } = observation()
    const token = { workItem: killed.lease.workItem, epoch: killed.lease.epoch, holder: killed.lease.holder }
    expect(checkFencing(token, currentLease)).toEqual({ admitted: false, reason: 'stale-epoch' })
  })

  it('the second host\'s tool call ran: the file it writes is on disk', () => {
    expect(observation().secondProof).toBe('ACP_OK')
  })
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('acp-agent e2e: real prompt over ACP', () => {
  it('runs a real turn and the agent writes the requested file (verified on disk)', async () => {
    workdir = await mkdtemp(join(tmpdir(), 'acp-e2e-'))
    spawned = launchAcpTestAgent({ agent: AGENT, cwd: workdir, env: DANGER_FULL_ACCESS_ENV })
    const { client, updates } = spawned

    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    // Any absolute cwd is honored; use the temp `workdir` as this session's
    // workspace (the bash tool will run there) — it need not equal the launch dir.
    const { sessionId } = await client.newSession({ cwd: workdir, mcpServers: [] })

    const res = await client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'Use the bash tool to write the exact text ACP_OK into a file named proof.txt in the current directory. Then stop.' }],
    })
    expect(['end_turn', 'max_tokens']).toContain(res.stopReason)

    // Assert the filesystem effect independently of the model response.
    const proof = await readFile(join(workdir, 'proof.txt'), 'utf8')
    expect(proof).toContain('ACP_OK')

    // The transport exposes committed semantic facts without UI projections;
    // the world effect independently proves that the standard tool lifecycle ran.
    expect(updates.some(update => update.sessionUpdate === 'agent_message_chunk')).toBe(true)
    expect(updates.some(update => update.sessionUpdate === 'tool_call')).toBe(true)
    expect(updates.some(update => update.sessionUpdate === 'tool_call_update')).toBe(true)
  }, 180_000)
})
