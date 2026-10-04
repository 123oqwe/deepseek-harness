/**
 * Epic P2-07 U1c validation[2] on the TypeScript client: `listApprovals` and
 * `decideApproval` send the SDK's approval requests and refuse an answer that
 * is not one. The server side of these requests is covered by
 * `@deepseek-ai/dsh-sdk-jsonrpc-server`'s own cases; here the runtime is never
 * started, and `request` answers in its place.
 */
import { describe, expect, it, vi } from 'vitest'
import { createProcessHarnessClient, SdkProtocolError, type HarnessClient } from '../src/client.ts'

/**
 * A client whose runtime is never spawned: every case stubs `request`.
 * @returns the client.
 */
function unstartedClient(): HarnessClient {
  return createProcessHarnessClient({
    command: process.execPath,
    args: [],
    environment: () => ({}),
    description: 'never started',
    initializeTimeoutMs: 1_000,
  })
}

const approval = {
  id: 'a-1',
  sessionId: 'session-a',
  toolName: 'bash',
  requestDigest: 'sha256:a-1',
  state: 'requested',
  revision: 0,
  deadlineMs: 1,
} as const

describe('P2-07 U1c validation[2]: the TypeScript client\'s approval calls', () => {
  it('lists approvals, narrowed to a session when one is named', async () => {
    const client = unstartedClient()
    const request = vi.spyOn(client, 'request').mockResolvedValue({ approvals: [approval] })

    expect(await client.listApprovals()).toEqual([approval])
    expect(await client.listApprovals('session-a')).toEqual([approval])
    expect(request.mock.calls).toEqual([['approval/list', {}], ['approval/list', { sessionId: 'session-a' }]])
  })

  it('decides from a revision and returns the outcome as the server answered it', async () => {
    const client = unstartedClient()
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce({ ok: false, conflict: 'stale-revision', approval })

    expect(await client.decideApproval({ id: 'a-1', revision: 0, decision: 'approved' }))
      .toEqual({ ok: false, conflict: 'stale-revision', approval })
    expect(request).toHaveBeenCalledWith('approval/decide', { id: 'a-1', revision: 0, decision: 'approved' })
  })

  it('refuses an answer that carries no approvals or no outcome', async () => {
    const client = unstartedClient()
    vi.spyOn(client, 'request').mockResolvedValue({})

    await expect(client.listApprovals()).rejects.toThrow(SdkProtocolError)
    await expect(client.decideApproval({ id: 'a-1', revision: 0, decision: 'denied' })).rejects.toThrow(SdkProtocolError)
  })
})
