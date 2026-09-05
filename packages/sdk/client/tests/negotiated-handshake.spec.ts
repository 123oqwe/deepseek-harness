/**
 * Epic P8-01's Usage stage: what the SDK client does with a negotiated
 * handshake, driven through a real process runtime.
 *
 * The Contract stage proved the negotiation functions in isolation. What only
 * exists once a client consumes a server's reply over a wire is asserted here,
 * and it is asserted by running the client — every case below spawns the fake
 * runtime, performs a real `initialize`, and reads what the client returns.
 *
 * Written this way after a first attempt asserted properties of literal
 * objects instead. Those cases would have passed with the client's reader
 * deleted, which is the defect BLOCKED-085 records: a true assertion that does
 * not exercise the thing it names.
 */

import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createProcessHarnessClient } from '../src/client.ts'
import type { RuntimeProcessOptions } from '../src/launch.ts'
import type { HarnessClient } from '../src/client.ts'

const fakeRuntime = fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))
const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * A client wired to the fake runtime, with `FAKE_NEGOTIATE` set to the JSON the
 * server should merge into its `initialize` result.
 * @param negotiate - the server's negotiated fields, or undefined for a server that predates negotiation.
 * @returns the started client.
 */
function clientWith(negotiate?: unknown): HarnessClient {
  const environment: Record<string, string> = negotiate === undefined
    ? {}
    : { FAKE_NEGOTIATE: JSON.stringify(negotiate) }
  const options: RuntimeProcessOptions = {
    command: process.execPath,
    args: [fakeRuntime],
    environment: () => ({ ...process.env as Record<string, string>, ...environment }),
    description: 'scripted fake runtime',
    initializeTimeoutMs: 5_000,
  }
  const client = createProcessHarnessClient(options)
  cleanups.push(() => client.close())
  return client
}

const COMPLETE = {
  negotiation: {
    protocolVersion: 4,
    agreedCapabilities: ['streaming'],
    ignoredCapabilities: ['replay'],
    downgrades: [],
  },
  protocolVersions: { min: 2, max: 6 },
  schemaFingerprint: 'abc123',
}

describe('P8-01 Usage: negotiated fields survive the client', () => {
  it('contract: a complete negotiation reaches the caller with every field intact', async () => {
    // The defect this replaces: initialize rebuilt its result from serverInfo
    // alone, so a server that negotiated had its answer discarded here.
    const result = await clientWith(COMPLETE).initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.negotiation).toEqual(COMPLETE.negotiation)
    expect(result.protocolVersions).toEqual({ min: 2, max: 6 })
    expect(result.schemaFingerprint).toBe('abc123')
  })

  it('control: the server identity still arrives, so the case above measures the added fields and not a broken handshake', async () => {
    const result = await clientWith(COMPLETE).initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.serverInfo.name).toBe('deepseek-harness-sdk-runtime')
  })
})

describe('P8-01 Usage: absence and malformation are not agreement', () => {
  it('contract: a server that sends no negotiation is admitted, and the field is absent rather than empty', async () => {
    // Absence means "this build predates negotiation". Reading it as an empty
    // agreement would refuse every older server; reading it as a successful
    // agreement would proceed with capabilities neither side confirmed.
    const result = await clientWith().initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.negotiation).toBeUndefined()
    expect(result.serverInfo.name).toBe('deepseek-harness-sdk-runtime')
  })

  it('contract: a malformed range is dropped rather than repaired into a claim the peer never made', async () => {
    const result = await clientWith({ protocolVersions: { min: 'nine', max: 1 } })
      .initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.protocolVersions).toBeUndefined()
  })

  it('contract: a partially-formed negotiation is dropped WHOLE, not read field by field', async () => {
    // A half-read agreement is worse than none: a caller would treat the
    // fields that did arrive as authoritative.
    const result = await clientWith({ negotiation: { protocolVersion: 4 } })
      .initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.negotiation).toBeUndefined()
  })

  it('contract: a negotiation whose capability lists are not string arrays is dropped, since a wire value is only what the peer claimed', async () => {
    const result = await clientWith({
      negotiation: { protocolVersion: 4, agreedCapabilities: 'streaming', ignoredCapabilities: [] },
    }).initialize({ cwd: process.cwd(), provider: 'p', model: 'm' })
    expect(result.negotiation).toBeUndefined()
  })
})

describe('P8-01 Usage: acceptance[1] — refuse before sending a task', () => {
  it('contract: initializeNegotiated throws when the server did not agree to a mandatory capability', async () => {
    const client = clientWith(COMPLETE)
    await expect(client.initializeNegotiated({
      cwd: process.cwd(),
      provider: 'p',
      model: 'm',
      capabilities: [{ id: 'replay', mandatory: true }],
    })).rejects.toThrow(/replay/u)
  })

  it('control: it resolves when every mandatory capability was agreed, so the refusal measures the agreement', async () => {
    const client = clientWith(COMPLETE)
    const result = await client.initializeNegotiated({
      cwd: process.cwd(),
      provider: 'p',
      model: 'm',
      capabilities: [{ id: 'streaming', mandatory: true }],
    })
    expect(result.negotiation?.protocolVersion).toBe(4)
  })

  it('contract: a server predating negotiation is admitted by initializeNegotiated rather than refused for agreeing to nothing', async () => {
    const result = await clientWith().initializeNegotiated({
      cwd: process.cwd(),
      provider: 'p',
      model: 'm',
      capabilities: [{ id: 'streaming', mandatory: true }],
    })
    expect(result.serverInfo.name).toBe('deepseek-harness-sdk-runtime')
  })
})
