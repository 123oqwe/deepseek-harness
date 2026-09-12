import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService, { type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

describe('ACP machine permission policy', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  async function ownedRequest(overrides: Partial<ApprovalRequest> = {}): Promise<ApprovalRequest> {
    if (harness === undefined) throw new Error('missing harness')
    await harness.ctx.plugin(ApprovalService)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-9'), name: 'bash', arguments: '{}' })
    return { agent, toolName: 'bash', callId: ToolCallId('call-9'), ...overrides }
  }

  it('maps the two advertised one-shot choices', async () => {
    harness = await makeBridgeHarness()
    harness.onPermission = () => {
      expect(harness?.sessionUpdates.at(-1)?.update).toMatchObject({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-9',
      })
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    }
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('allowed-once')
    expect(harness.permissionRequests[0]).toMatchObject({
      sessionId: request.agent.session.id,
      toolCall: { toolCallId: 'call-9' },
      options: [
        { optionId: 'allow-once', kind: 'allow_once' },
        { optionId: 'reject-once', kind: 'reject_once' },
      ],
    })

    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('maps cancellation and unknown choices without granting access', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('cancelled')
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'unknown-grant' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('fails closed when the client errors the permission request', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    harness.onPermission = () => { throw new Error('client gone') }
    await expect(harness.ctx.approval.request(request)).resolves.toBe('unavailable')
  })

  it('delegates a same-id foreign agent', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    const events = [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }]
    const foreign = {
      session: {
        id: request.agent.session.id,
        seq: events.length,
        eventAt: (seq: number) => events[seq],
        snapshotEvents: () => events,
        append: () => ({}),
      },
    } as unknown as Agent
    await expect(harness.ctx.approval.request({ agent: foreign, toolName: 'bash', callId: ToolCallId('call') }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })

  it('delegates requests that have no protocol tool-call identity', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request({ agent: request.agent, toolName: request.toolName }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })
})

describe('P2-06 must[0]: the ACP decider is shown the action, not only its id', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  /** One owned ask, with the six display fields the dispatch path builds. */
  async function askWithDisplay(): Promise<ApprovalRequest> {
    if (harness === undefined) throw new Error('missing harness')
    await harness.ctx.plugin(ApprovalService)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-9'), name: 'bash', arguments: '{}' })
    return {
      agent,
      toolName: 'bash',
      callId: ToolCallId('call-9'),
      display: {
        manifestDigest: 'digest-abc',
        arguments: '{"command":"<redacted>"}',
        resource: 'process:rm -rf /tmp/x',
        riskClass: 'internal-write',
        expectedDiff: 'tool bash executes with the manifested arguments',
        expiresAtMs: 1_700_000_060_000,
      },
    }
  }

  it('carries all six fields into the standard\'s own toolCall projection', async () => {
    // The six ride `toolCall`, which is the field ACP gives an agent for saying
    // what is being permitted. A sibling field of this harness's invention
    // would be telling a conformant client something it has no rule to read.
    harness = await makeBridgeHarness()
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    // The ask is built BEFORE the service is read: `askWithDisplay` is what
    // mounts `ApprovalService`, so reading `ctx.approval` in the same
    // expression reads it before the mount.
    const ask = await askWithDisplay()
    await harness.ctx.approval.request(ask)

    const sent = harness.permissionRequests[0]
    expect(sent?.toolCall.title).toBe('bash — internal-write')
    const shown = (sent?.toolCall.content ?? []).map(block =>
      block.type === 'content' && block.content.type === 'text' ? block.content.text : '').join('\n')
    expect(shown).toContain('process:rm -rf /tmp/x')
    expect(shown).toContain('tool bash executes with the manifested arguments')
    expect(shown).toContain('{"command":"<redacted>"}')
    expect(shown).toContain('digest-abc')
    expect(shown).toContain('2023-11-14T22:14:20.000Z')
  })

  it('shows the REDACTED arguments and never the raw ones', async () => {
    // acceptance[1] at the surface: what the decider sees is the redaction, and
    // the digest the approval is bound to covers the value behind it.
    harness = await makeBridgeHarness()
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    const ask = await askWithDisplay()
    await harness.ctx.approval.request(ask)

    expect(JSON.stringify(harness.permissionRequests[0])).not.toContain('rm -rf /tmp/secret')
    expect(JSON.stringify(harness.permissionRequests[0])).toContain('<redacted>')
  })

  it('sends the payload it always sent when the ask carries no manifest', async () => {
    // The non-tool-call path and every pre-existing asker: an ask with no
    // display must reach the client unchanged rather than with empty fields,
    // which a client would render as "this action touches nothing".
    harness = await makeBridgeHarness()
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    const ask = await askWithDisplay()
    const { display, ...withoutDisplay } = ask
    void display
    await harness.ctx.approval.request(withoutDisplay)

    expect(harness.permissionRequests[0]?.toolCall).toEqual({ toolCallId: 'call-9' })
  })
})
