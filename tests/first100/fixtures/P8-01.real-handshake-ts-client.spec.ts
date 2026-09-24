/**
 * P8-01 on the SHIPPED `sdk` profile, the TypeScript half of BLOCKED-314's
 * closing condition 1(3): over a real handshake, the shipped TypeScript client
 * hands its caller the server's `protocolVersions` and `schemaFingerprint`.
 *
 * The client is `@deepseek-ai/dsh-sdk-client`'s public `HarnessClient`,
 * launching `apps/cli/src/bin.ts --profile sdk` through its own `dshBin`
 * option; `NODE_OPTIONS` loads tsx so the source bin runs, as
 * `P8-01.run-provenance.spec.ts` launches it. No scripted peer is involved:
 * the client's `initialize` meets the shipped server. The dummy key only
 * satisfies adapter loading; the handshake calls no model.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/** What the caller received from `initialize`, reduced to the fields read here. */
interface Handshake {
  readonly serverName: string
  readonly protocolVersions: unknown
  readonly schemaFingerprint: unknown
}

let handshake: Handshake | undefined
let committedFingerprint: string | undefined
let cleanup: (() => Promise<void>) | undefined

beforeAll(async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-p801-handshake-'))
  cleanup = () => rm(dshHome, { recursive: true, force: true })
  const artifact = JSON.parse(await readFile(join(repoRoot, 'spec', 'control-protocol.schema.json'), 'utf8')) as { fingerprint?: unknown }
  committedFingerprint = typeof artifact.fingerprint === 'string' ? artifact.fingerprint : undefined
  const client = new HarnessClient({
    dshBin: join(repoRoot, 'apps/cli/src/bin.ts'),
    profile: 'sdk',
    dshHome,
    processCwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: '--import tsx/esm',
      DEEPSEEK_API_KEY: 'p801-keyless',
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
    },
    initializeTimeoutMs: 90_000,
  })
  try {
    const result = await client.initialize({ cwd: dshHome, provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    handshake = {
      serverName: result.serverInfo.name,
      protocolVersions: result.protocolVersions,
      schemaFingerprint: result.schemaFingerprint,
    }
  } finally {
    await client.close()
  }
}, 180_000)

afterAll(async () => { await cleanup?.() })

describe('P8-01 on the shipped sdk profile: the shipped TypeScript client over a real handshake', () => {
  it('control: the peer is the shipped sdk runtime', () => {
    expect(handshake?.serverName).toBe('deepseek-harness-sdk-runtime')
  })

  it('BLOCKED-314 condition 1(3): the caller receives the server\'s protocolVersions', () => {
    expect(handshake?.protocolVersions).toEqual({ min: 1, max: 1 })
  })

  it('BLOCKED-314 condition 1(3): the caller receives the server\'s schemaFingerprint, the one the committed control-protocol artifact records', () => {
    expect(committedFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    expect(handshake?.schemaFingerprint).toBe(committedFingerprint)
  })
})
