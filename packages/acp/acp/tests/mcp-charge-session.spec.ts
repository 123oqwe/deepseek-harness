/**
 * P4-11 must[1]: both ACP session paths mount the request's MCP servers charged
 * to the session they open, so a server's reconnects count against that
 * session's Run whether the session was created or resumed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as mcp from '../src/mcp.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

vi.mock('../src/mcp.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/mcp.ts')>()
  return { ...real, mountAcpMcpServers: vi.fn(real.mountAcpMcpServers) }
})

/**
 * The session the latest MCP mount was charged to.
 * @returns the fourth argument of the latest `mountAcpMcpServers` call.
 */
function lastChargeSession(): SessionId | undefined {
  return vi.mocked(mcp.mountAcpMcpServers).mock.calls.at(-1)?.[3]
}

describe('P4-11 must[1]: an ACP session charges its MCP reconnects to its own Run', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
    vi.mocked(mcp.mountAcpMcpServers).mockClear()
  })

  it('control: a created session mounts its MCP servers charged to itself, so the case below measures the resume path', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(lastChargeSession()).toBe(SessionId(created.sessionId))
  })

  it('a resumed session mounts its MCP servers charged to itself', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('first answer')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId: created.sessionId, prompt: [{ type: 'text', text: 'first prompt' }] })
    await harness.client.closeSession({ sessionId: created.sessionId })
    vi.mocked(mcp.mountAcpMcpServers).mockClear()

    await harness.client.resumeSession({ sessionId: created.sessionId, cwd: process.cwd(), mcpServers: [] })

    expect(vi.mocked(mcp.mountAcpMcpServers)).toHaveBeenCalledTimes(1)
    expect(lastChargeSession()).toBe(SessionId(created.sessionId))
  })
})
