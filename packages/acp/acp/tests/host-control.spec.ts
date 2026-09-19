/**
 * P2-12 acceptance[3] on the automation surface: what an ACP client is told
 * about a host emergency stop, and what it is told when nobody is watching.
 *
 * ACP has no host-level notification — all fourteen `SessionUpdate` kinds are
 * session-level — so the state travels in `_meta`, which the protocol reserves
 * for exactly this and about which it tells implementations to assume nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import { brandString } from '@deepseek-ai/dsh-brand'

/**
 * The control plane's own request type, taken from its method rather than
 * imported.
 *
 * `PrincipalId` lives in `@deepseek-ai/dsh-principal`, which this package does
 * not depend on and does not need to: the one edge already declared for the
 * service type names this too, and `Parameters` follows a rename where a second
 * import would drift.
 */
type ControlRequest = Parameters<ControlPlaneService['control']>[1]

/**
 * One stop request, in the shape the control plane's own cases use
 * (`api/session-controller/tests/control-stop.host.spec.ts:51-55`).
 */
const REQUEST: ControlRequest = {
  requestedBy: brandString<ControlRequest['requestedBy']>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}
import { HOST_CONTROL_META_KEY } from '../src/host-control.ts'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

let harness: BridgeHarness | undefined

afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

/** Mount the real control plane over a real store on an existing harness. */
async function mountControlPlane(active: BridgeHarness): Promise<ControlPlaneService> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-acp-control-'))
  await active.ctx.plugin(ControlPlaneService, { storePath: root })
  const plane = active.ctx.get('controlPlane')
  if (plane === undefined) throw new Error('the control plane did not mount')
  return plane
}

/** The host control state a message carried, or undefined when it carried none. */
function controlIn(meta: { [key: string]: unknown } | null | undefined): unknown {
  return meta?.[HOST_CONTROL_META_KEY]
}

describe('ACP host control state', () => {
  it('says NOTHING when no control plane is mounted, rather than reporting "not stopped"', async () => {
    // The reachable case: this server ships in compositions that mount no
    // control plane. An absent key is unknown; `{ stopped: false }` would be a
    // claim, and a client cannot tell a claim from a silence after the fact.
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(controlIn(created._meta)).toBeUndefined()
  })

  it('tells a session that opens AFTER the stop was raised, without waiting for an edge', async () => {
    // The late connection. A client that was not listening when the stop
    // happened would otherwise show a running host forever — the disagreement
    // between surfaces the clause forbids, produced by the mechanism meant to
    // prevent it.
    harness = await makeBridgeHarness()
    const plane = await mountControlPlane(harness)
    plane.control('pause-new-actions', REQUEST)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(controlIn(created._meta)).toMatchObject({
      stopped: true,
      record: { requestedBy: 'operator-1', reason: 'human-requested' },
    })
  })

  it('announces the stop to an already-open session, and the release after it', async () => {
    // The live edge, both ways. A surface left showing a lifted stop is worse
    // than one that never learned of it, so the release is asserted too.
    harness = await makeBridgeHarness()
    const plane = await mountControlPlane(harness)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const sessionId = (await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })).sessionId

    plane.control('pause-new-actions', REQUEST)
    await vi.waitFor(() => {
      const stopped = harness!.sessionUpdates.filter(entry => entry.sessionId === sessionId)
      expect(stopped.some(entry => (controlIn(entry.meta) as { stopped?: boolean } | undefined)?.stopped === true)).toBe(true)
    })

    plane.control('resume', REQUEST)
    await vi.waitFor(() => {
      const released = harness!.sessionUpdates.filter(entry => entry.sessionId === sessionId)
      expect(released.some(entry => (controlIn(entry.meta) as { stopped?: boolean } | undefined)?.stopped === false)).toBe(true)
    })
  })
})
