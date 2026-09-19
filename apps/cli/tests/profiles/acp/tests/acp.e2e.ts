import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import {
  launchAcpTestAgent,
  startStubModelServer,
  type AgentUnderTest,
  type LaunchedAcpTestAgent,
} from '@deepseek-ai/dsh-session-snapshot'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.js'
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

/** One record of a durable session log, as the log's own JSONL lines carry it. */
interface SessionLogRecord {
  type: string
  data?: Record<string, unknown>
}

/**
 * Read this profile's whole durable log out of the launcher's harness home.
 *
 * Every frame, not just the first: the JSONL backend appends a Zstandard frame
 * per batch, so a one-shot decompress of the file yields the first frame alone.
 * The profile writes under `dshHomePath('sessions')` (`../cordis.yml:30`) and
 * the launcher points `DSH_HOME` at the test's own directory.
 * @param cwd - the directory the agent was launched in.
 * @returns the log's records in file order.
 */
async function readSessionRecords(cwd: string): Promise<SessionLogRecord[]> {
  const sessionsRoot = join(cwd, '.dsh', 'sessions')
  const files = await readdir(sessionsRoot, { recursive: true })
  const log = files.find(file => file.endsWith('.jsonl.zstd'))
  expect(log).toBeDefined()
  const compressed = await readFile(join(sessionsRoot, log!))
  const { frames, tornStart } = scanZstdFrames(compressed)
  expect(tornStart).toBeUndefined()
  return frames
    .flatMap(({ start, end }) => zstdDecompressSync(compressed.subarray(start, end)).toString().trim().split('\n'))
    .map(line => JSON.parse(line) as SessionLogRecord)
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
   * BLOCKED-291 negative control. It pins TODAY'S DEFECT, not the fix: ACP
   * composes its Agent per request (`packages/acp/acp/src/session.ts:128`,
   * reached from `index.ts:248`) without an identity, so nothing is attached
   * and every manifest is attributed to the anonymous dev principal
   * (`action-manifest/src/identity.ts:52`). The assertions below state those
   * values positively, so this case passes only while the defect is there and
   * fails the moment it is fixed — which is what makes the fix's own commit,
   * which flips them to P2-01 acceptance[0]'s form, an observation rather than
   * a claim. It is deliberately not written as an expected failure: an
   * expected failure passes for any reason at all, including a broken
   * environment.
   *
   * Keyless with a real action: the stand-in model endpoint answers the turn
   * with one `bash` call, so the session genuinely appends an action manifest
   * without a credential and without network egress. `session/new` alone would
   * append none, and "the manifest follows by construction" is precisely the
   * inference this program stopped accepting.
   */
  it('BLOCKED-291 negative control: a launched acp session attaches no identity and acts as anonymous', async () => {
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

      const records = await readSessionRecords(workdir)
      const manifests = records.filter(record => record.type === 'action/manifest-appended')
      expect(manifests.length).toBeGreaterThan(0)
      expect(manifests[0]?.data?.actor).toMatch(/^anonymous:/)
      expect(records.filter(record => record.type === 'identity/attached')).toHaveLength(0)

      // The resume half, through the surface's own `session/resume` method
      // (`packages/acp/acp/src/index.ts:430`). The `identity/attached` count
      // must go 0 -> 0 here, and 1 -> 1 once the fix lands. Asserting "no
      // second record" alone would hold vacuously today AND after the fix if
      // the resumed session never composed an Agent, so one more prompt runs
      // and the growing manifest count is asserted first: only a composed,
      // running Agent appends one.
      second = launchAcpTestAgent({ agent: AGENT, cwd: workdir, env })
      await second.spawned
      await second.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      await second.client.resumeSession({ sessionId, cwd: workdir, mcpServers: [] })
      await second.client.prompt({
        sessionId,
        prompt: [{ type: 'text', text: 'write the second proof file' }],
      })
      await second.client.closeSession({ sessionId })

      const resumed = await readSessionRecords(workdir)
      const resumedManifests = resumed.filter(record => record.type === 'action/manifest-appended')
      expect(resumedManifests.length).toBeGreaterThan(manifests.length)
      expect(resumedManifests.at(-1)?.data?.actor).toMatch(/^anonymous:/)
      expect(resumed.filter(record => record.type === 'identity/attached')).toHaveLength(0)
    } finally {
      await stub.close()
      await Promise.allSettled([first?.close(), second?.close()]
        .filter((value): value is Promise<void> => value !== undefined))
    }
  }, 120_000)
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
