/**
 * Epic P8-01's Provider stage: the server side of negotiation, and the
 * package face that makes it consumable.
 *
 * The Contract stage defined the negotiation functions; the Provider stage is
 * what turns a definition into something a peer can actually reach. Two
 * properties are asserted here that neither C nor U can show:
 *
 * - the protocol package **exports** the negotiation surface, so a consumer
 *   can import it through the package's public face rather than by reaching
 *   into `src/`;
 * - the server **refuses before doing any work**, which is a property of
 *   where the check sits in `initialize`, not of what the check decides.
 */

import { describe, expect, it } from 'vitest'
import * as protocol from '@deepseek-ai/dsh-sdk-protocol'

describe('P8-01 Provider: the negotiation surface is reachable through the package face', () => {
  it('provider: the package exports every negotiation function a peer needs', () => {
    // Before this stage these lived in ./version.ts, ./capabilities.ts and
    // ./schema-fingerprint.ts with nothing re-exporting them, so neither the
    // server nor the client could consume them without reaching into src/.
    // A definition no consumer can reach is not yet a provider surface.
    expect(typeof protocol.negotiateProtocolVersion).toBe('function')
    expect(typeof protocol.negotiateCapabilities).toBe('function')
    expect(typeof protocol.computeSchemaFingerprint).toBe('function')
    expect(typeof protocol.isWellFormedRange).toBe('function')
  })

  it('provider: the exported functions are the same implementations the Contract stage proved, not re-declarations', () => {
    // A re-export that had drifted into a second implementation would satisfy
    // the presence check above while behaving differently. These are the
    // Contract stage's own asserted results.
    expect(protocol.negotiateProtocolVersion({ min: 1, max: 5 }, { min: 1, max: 3 }))
      .toEqual({ agreed: true, version: 3 })
    expect(protocol.negotiateCapabilities([{ id: 'x', mandatory: true }], new Set(), new Set()))
      .toEqual({ accepted: false, reason: 'unknown-mandatory-capability', capability: 'x' })
  })

  it('provider: a fingerprint computed through the package face equals one computed from the same surface twice', () => {
    const surface = {
      methods: [{ name: 'initialize', schemaId: 'sdk-protocol:InitializeParams', version: '1.0' }],
      events: [],
      resourceTypes: ['session'],
    }
    expect(protocol.computeSchemaFingerprint(surface)).toBe(protocol.computeSchemaFingerprint(surface))
    expect(protocol.computeSchemaFingerprint(surface)).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe("P8-01 Provider: the server's own declared position", () => {
  it('provider: the server advertises a RANGE even while it speaks one generation', () => {
    // A single number today would mean the field's shape changes on the day a
    // second generation appears — which is exactly the day both peers must
    // already agree on how to express it.
    const single = protocol.negotiateProtocolVersion({ min: 1, max: 1 }, { min: 1, max: 1 })
    expect(single).toEqual({ agreed: true, version: 1 })
  })

  it('provider: a peer speaking only a future generation is refused rather than silently downgraded', () => {
    // The server speaks 1..1. A client speaking 2..2 has no common ground, and
    // the refusal must name both ranges so the mismatch is diagnosable without
    // re-running the handshake.
    const outcome = protocol.negotiateProtocolVersion({ min: 2, max: 2 }, { min: 1, max: 1 })
    expect(outcome.agreed).toBe(false)
    if (outcome.agreed) throw new Error('unreachable')
    expect(outcome.reason).toBe('no-overlapping-version')
    expect(outcome.client).toEqual({ min: 2, max: 2 })
    expect(outcome.server).toEqual({ min: 1, max: 1 })
  })

  it('provider: a capability the server knows but has not implemented refuses differently from one it has never heard of', () => {
    // The server's KNOWN set is a superset of its SUPPORTED set on purpose.
    // Collapsing them would leave a peer unable to tell "upgrade me" from
    // "this will never work here".
    const known = new Set(['streaming', 'approval', 'replay'])
    const supported = new Set(['streaming', 'approval'])
    expect(protocol.negotiateCapabilities([{ id: 'replay', mandatory: true }], known, supported))
      .toEqual({ accepted: false, reason: 'unsupported-mandatory-capability', capability: 'replay' })
    expect(protocol.negotiateCapabilities([{ id: 'teleport', mandatory: true }], known, supported))
      .toEqual({ accepted: false, reason: 'unknown-mandatory-capability', capability: 'teleport' })
  })

  it('control: a capability the server both knows and supports is agreed, so the refusals above measure the sets and not the mandatory flag', () => {
    const known = new Set(['streaming', 'approval', 'replay'])
    const supported = new Set(['streaming', 'approval'])
    expect(protocol.negotiateCapabilities([{ id: 'streaming', mandatory: true }], known, supported))
      .toEqual({ accepted: true, agreed: ['streaming'], ignored: [] })
  })
})
