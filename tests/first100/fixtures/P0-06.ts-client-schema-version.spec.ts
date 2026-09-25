/**
 * P0-06, BLOCKED-310 closing condition 4, TypeScript half: over a real
 * handshake on the shipped `sdk` profile, the `initialize` the shipped
 * TypeScript client sends declares the `sdk-protocol:InitializeParams` schema
 * version this build registers.
 *
 * Launched as `P8-01.real-handshake-ts-client.spec.ts` launches it:
 * `@deepseek-ai/dsh-sdk-client`'s `HarnessClient` with
 * `NODE_OPTIONS='--import tsx/esm'` and a dummy key. The one difference is
 * `dshBin`: `./loader/p0-06-client-schema-version/recording-bin.ts` starts
 * `apps/cli/src/bin.ts` with the same arguments and records every byte the
 * client writes to it. The cases read the recorded `initialize` request; the
 * expected version is read from this build's schema registry.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { getSchema, type SchemaId } from '@deepseek-ai/dsh-schema-registry'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const recordingBin = fileURLToPath(new URL('./loader/p0-06-client-schema-version/recording-bin.ts', import.meta.url))

/** The route the caller passes to `initialize`. */
const ROUTE = { provider: 'deepseek-official', model: 'deepseek-v4-pro' } as const

/** One JSON-RPC message the client wrote, as far as these cases read it. */
interface ClientMessage {
  readonly method?: unknown
  readonly params?: Record<string, unknown>
}

let cwd: string | undefined
let serverName: string | undefined
let initializeRequest: ClientMessage | undefined
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p006-client-schema-'))
  cleanup = () => rm(dshHome, { recursive: true, force: true })
  cwd = dshHome
  const recording = join(dshHome, 'client-stdin.jsonl')
  const client = new HarnessClient({
    dshBin: recordingBin,
    profile: 'sdk',
    dshHome,
    processCwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: '--import tsx/esm',
      DEEPSEEK_API_KEY: 'p006-keyless',
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      A409_REAL_BIN: join(repoRoot, 'apps/cli/src/bin.ts'),
      A409_STDIN_OUT: recording,
    },
    initializeTimeoutMs: 90_000,
  })
  try {
    const result = await client.initialize({ cwd: dshHome, ...ROUTE })
    serverName = result.serverInfo.name
  } finally {
    await client.close()
  }
  const messages = (await readFile(recording, 'utf8'))
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as ClientMessage)
  initializeRequest = messages.find(message => message.method === 'initialize')
}, 180_000)

afterAll(async () => { await cleanup?.() })

describe('P0-06 BLOCKED-310 condition 4 on the shipped sdk profile: the shipped TypeScript client over a real handshake', () => {
  it('control: the recorder saw the initialize of the client, with the cwd, provider and model the caller passed, and the peer is the shipped sdk runtime', () => {
    expect(serverName).toBe('deepseek-harness-sdk-runtime')
    expect(initializeRequest?.params?.['cwd']).toBe(cwd)
    expect(initializeRequest?.params?.['provider']).toBe(ROUTE.provider)
    expect(initializeRequest?.params?.['model']).toBe(ROUTE.model)
  })

  it('the initialize the shipped client sends declares the sdk-protocol:InitializeParams schemaVersion this build registers', () => {
    const registered = getSchema('sdk-protocol:InitializeParams' as SchemaId)?.version
    expect(registered).toEqual({ major: 1, minor: 0 })
    expect(initializeRequest?.params?.['schemaVersion'], JSON.stringify(initializeRequest?.params)).toEqual(registered)
  })
})
