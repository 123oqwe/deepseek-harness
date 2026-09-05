/**
 * Epic P8-01's Contract stage: protocol version negotiation, capability
 * discovery, and schema fingerprinting.
 *
 * `contract:` asserts a promise the exported surface makes; `control:` proves
 * the assertion beside it measures a decision rather than a constant.
 */

import { describe, expect, it } from 'vitest'
import { isWellFormedRange, negotiateProtocolVersion } from '../src/version.ts'
import type { ProtocolVersionRange } from '../src/version.ts'
import { negotiateCapabilities } from '../src/capabilities.ts'
import type { CapabilityDeclaration, CapabilityId } from '../src/capabilities.ts'
import { computeSchemaFingerprint } from '../src/schema-fingerprint.ts'
import type { ProtocolSurface } from '../src/schema-fingerprint.ts'

/**
 * A supported range.
 * @param min - lowest supported version.
 * @param max - highest supported version.
 * @returns the range.
 */
function range(min: number, max: number): ProtocolVersionRange {
  return { min, max }
}

describe('P8-01 Contract: acceptance[0] — negotiation is deterministic in both directions', () => {
  it('contract: a new client against an old server agrees on the highest version both support', () => {
    expect(negotiateProtocolVersion(range(1, 5), range(1, 3))).toEqual({ agreed: true, version: 3 })
  })

  it('contract: an old client against a new server reaches the same version as the reverse pairing', () => {
    // acceptance[0] names both directions, and a rule that is not symmetric
    // would give two peers different answers about the same pair.
    expect(negotiateProtocolVersion(range(1, 3), range(1, 5)))
      .toEqual(negotiateProtocolVersion(range(1, 5), range(1, 3)))
  })

  it('contract: the highest mutually supported version wins, not the lowest', () => {
    // Lowest would silently hold both peers at the oldest shape either has
    // ever supported, which is how a capability stops being used without
    // anyone deciding to stop using it.
    expect(negotiateProtocolVersion(range(2, 7), range(4, 9))).toEqual({ agreed: true, version: 7 })
  })

  it('contract: non-overlapping ranges refuse with a machine-readable reason and BOTH ranges, so no field silently vanishes', () => {
    expect(negotiateProtocolVersion(range(1, 2), range(5, 9))).toEqual({
      agreed: false,
      reason: 'no-overlapping-version',
      client: range(1, 2),
      server: range(5, 9),
    })
  })

  it('contract: adjacent-but-disjoint ranges refuse rather than meeting in the middle', () => {
    expect(negotiateProtocolVersion(range(1, 3), range(4, 6)).agreed).toBe(false)
  })

  it('contract: ranges touching at exactly one version agree on it', () => {
    expect(negotiateProtocolVersion(range(1, 4), range(4, 8))).toEqual({ agreed: true, version: 4 })
  })

  it('contract: an inverted range is refused rather than normalised, since it describes no version the peer claimed', () => {
    expect(negotiateProtocolVersion(range(5, 1), range(1, 9)).agreed).toBe(false)
    expect(isWellFormedRange(range(5, 1))).toBe(false)
  })

  it('control: a well-formed range is accepted, so the refusal above measures the inversion', () => {
    expect(isWellFormedRange(range(1, 5))).toBe(true)
    expect(negotiateProtocolVersion(range(1, 5), range(1, 9)).agreed).toBe(true)
  })
})

describe('P8-01 Contract: must[2] — an unknown mandatory capability refuses the connection', () => {
  const known = new Set<CapabilityId>(['streaming', 'approval', 'replay'])
  const supported = new Set<CapabilityId>(['streaming', 'approval'])

  /**
   * One declaration.
   * @param id - the capability id.
   * @param mandatory - whether the peer requires it.
   * @returns the declaration.
   */
  function needs(id: string, mandatory: boolean): CapabilityDeclaration {
    return { id, mandatory }
  }

  it('contract: a mandatory capability this build has never heard of refuses, naming the capability', () => {
    expect(negotiateCapabilities([needs('teleport', true)], known, supported))
      .toEqual({ accepted: false, reason: 'unknown-mandatory-capability', capability: 'teleport' })
  })

  it('contract: a mandatory capability this build knows but does not implement refuses with a DIFFERENT reason', () => {
    // must[2] distinguishes them and a peer can act on the difference:
    // unknown means version skew, unsupported means a real gap.
    expect(negotiateCapabilities([needs('replay', true)], known, supported))
      .toEqual({ accepted: false, reason: 'unsupported-mandatory-capability', capability: 'replay' })
  })

  it('contract: an unknown OPTIONAL capability is ignored rather than refused, which is the point of the split', () => {
    const result = negotiateCapabilities([needs('teleport', false)], known, supported)
    expect(result).toEqual({ accepted: true, agreed: [], ignored: ['teleport'] })
  })

  it('contract: ignored optional capabilities are RECORDED, not dropped, so a peer can see what was not used', () => {
    const result = negotiateCapabilities([needs('replay', false), needs('streaming', false)], known, supported)
    expect(result).toEqual({ accepted: true, agreed: ['streaming'], ignored: ['replay'] })
  })

  it('contract: negotiation fails fast on the first mandatory failure rather than collecting them', () => {
    // Any single mandatory failure is fatal, so a list would suggest the peer
    // could fix them independently.
    expect(negotiateCapabilities([needs('teleport', true), needs('replay', true)], known, supported))
      .toEqual({ accepted: false, reason: 'unknown-mandatory-capability', capability: 'teleport' })
  })

  it('control: a fully supported mandatory set is accepted, so the refusals above measure the capability and not the mandatory flag', () => {
    expect(negotiateCapabilities([needs('streaming', true), needs('approval', true)], known, supported))
      .toEqual({ accepted: true, agreed: ['streaming', 'approval'], ignored: [] })
  })

  it('contract: an empty declaration set is accepted, so a peer declaring nothing is not treated as declaring something impossible', () => {
    expect(negotiateCapabilities([], known, supported)).toEqual({ accepted: true, agreed: [], ignored: [] })
  })
})

describe('P8-01 Contract: acceptance[2] and [3] — the fingerprint is stable per surface and moves with it', () => {
  const surface: ProtocolSurface = {
    methods: [
      { name: 'initialize', schemaId: 'sdk-protocol:InitializeParams', version: '1.0' },
      { name: 'session/prompt', schemaId: 'sdk-protocol:SessionPromptParams', version: '1.0' },
    ],
    events: [{ name: 'session/event', schemaId: 'sdk-protocol:SessionEvent', version: '1.0' }],
    resourceTypes: ['session', 'agent'],
  }

  it('contract: the same surface fingerprints identically across calls', () => {
    expect(computeSchemaFingerprint(surface)).toBe(computeSchemaFingerprint(surface))
  })

  it('contract: declaration order does not move the fingerprint, since order is not wire-visible', () => {
    // A fingerprint that reported drift for a source reorder would report
    // false drift for a refactor, and one that cries wolf stops being read.
    const reordered: ProtocolSurface = {
      methods: [...surface.methods].reverse(),
      events: surface.events,
      resourceTypes: [...surface.resourceTypes].reverse(),
    }
    expect(computeSchemaFingerprint(reordered)).toBe(computeSchemaFingerprint(surface))
  })

  it('contract: a version bump on one method moves the fingerprint', () => {
    const bumped: ProtocolSurface = {
      ...surface,
      methods: [{ ...surface.methods[0]!, version: '2.0' }, surface.methods[1]!],
    }
    expect(computeSchemaFingerprint(bumped)).not.toBe(computeSchemaFingerprint(surface))
  })

  it('contract: adding a method moves the fingerprint, so a new wire surface cannot ship unnoticed', () => {
    const added: ProtocolSurface = {
      ...surface,
      methods: [...surface.methods, { name: 'session/cancel', schemaId: 'sdk-protocol:Cancel', version: '1.0' }],
    }
    expect(computeSchemaFingerprint(added)).not.toBe(computeSchemaFingerprint(surface))
  })

  it('contract: removing a resource type moves the fingerprint', () => {
    expect(computeSchemaFingerprint({ ...surface, resourceTypes: ['session'] }))
      .not.toBe(computeSchemaFingerprint(surface))
  })

  it('contract: a method and an event with the same name are distinguished, so the two kinds cannot collide', () => {
    const swapped: ProtocolSurface = {
      methods: [{ name: 'ping', schemaId: 'x', version: '1.0' }],
      events: [],
      resourceTypes: [],
    }
    const asEvent: ProtocolSurface = {
      methods: [],
      events: [{ name: 'ping', schemaId: 'x', version: '1.0' }],
      resourceTypes: [],
    }
    expect(computeSchemaFingerprint(swapped)).not.toBe(computeSchemaFingerprint(asEvent))
  })

  it('contract: names containing the field separator cannot forge another surface, because fields are length-prefixed', () => {
    // NOTE: this pair moves the `:` CHARACTER, so the two field sequences
    // differ whether or not fields are length-prefixed — removing the prefixing
    // does not redden this case (BLOCKED-085). It is kept as a plain
    // difference check; the case below is the one that tests the prefixing.
    const one: ProtocolSurface = { methods: [{ name: 'a:b', schemaId: 'x', version: '1.0' }], events: [], resourceTypes: [] }
    const two: ProtocolSurface = {
      methods: [{ name: 'a', schemaId: 'b:x', version: '1.0' }],
      events: [],
      resourceTypes: [],
    }
    expect(computeSchemaFingerprint(one)).not.toBe(computeSchemaFingerprint(two))
  })

  it('contract: two surfaces whose fields concatenate identically still fingerprint differently, which is what length-prefixing buys', () => {
    // The real collision: the BOUNDARY moves while the character sequence does
    // not. Unprefixed, both absorb 'ab' + 'c' -> "abc" and 'a' + 'bc' -> "abc",
    // so an unprefixed hash cannot tell a method named `ab` with schema `c`
    // from one named `a` with schema `bc`. Prefixing is the only thing
    // separating them, so removing it must break this case and nothing else
    // needs to.
    const boundaryLeft: ProtocolSurface = {
      methods: [{ name: 'ab', schemaId: 'c', version: '1.0' }],
      events: [],
      resourceTypes: [],
    }
    const boundaryRight: ProtocolSurface = {
      methods: [{ name: 'a', schemaId: 'bc', version: '1.0' }],
      events: [],
      resourceTypes: [],
    }
    expect(computeSchemaFingerprint(boundaryLeft)).not.toBe(computeSchemaFingerprint(boundaryRight))
  })
})

describe('P8-01 Fault: the N-2/N-1/N compatibility matrix (validation[0])', () => {
  // Three consecutive generations, each pair negotiated in both directions.
  // A matrix rather than a few hand-picked pairs, because acceptance[0]'s
  // promise is about ANY new-against-old pairing, and a rule that held for one
  // pair and not another would still satisfy a spot check.
  const N = 3
  const generations: Record<string, ProtocolVersionRange> = {
    'N-2': { min: 1, max: N - 2 },
    'N-1': { min: 1, max: N - 1 },
    N: { min: 1, max: N },
  }

  it('enforcement: every ordered pair of adjacent generations negotiates, and the result never exceeds either peer', () => {
    for (const [clientName, client] of Object.entries(generations)) {
      for (const [serverName, server] of Object.entries(generations)) {
        const result = negotiateProtocolVersion(client, server)
        const label = `${clientName} -> ${serverName}`
        expect(result.agreed, label).toBe(true)
        if (!result.agreed) continue
        expect(result.version, label).toBeLessThanOrEqual(client.max)
        expect(result.version, label).toBeLessThanOrEqual(server.max)
      }
    }
  })

  it('enforcement: the matrix is symmetric — swapping the peers never changes the agreed version', () => {
    for (const client of Object.values(generations)) {
      for (const server of Object.values(generations)) {
        expect(negotiateProtocolVersion(client, server)).toEqual(negotiateProtocolVersion(server, client))
      }
    }
  })

  it('enforcement: a peer that has dropped support for the oldest generation refuses it rather than agreeing to a version it cannot speak', () => {
    // The case a matrix of overlapping ranges alone would miss: real
    // deprecation removes the low end, and the refusal must be explicit.
    const dropped: ProtocolVersionRange = { min: N, max: N }
    const ancient: ProtocolVersionRange = { min: 1, max: 1 }
    expect(negotiateProtocolVersion(ancient, dropped)).toEqual({
      agreed: false,
      reason: 'no-overlapping-version',
      client: ancient,
      server: dropped,
    })
  })
})

describe('P8-01 Fault: deliberately breaking the contract must be detected (validation[1])', () => {
  const known = new Set<CapabilityId>(['streaming', 'approval', 'replay'])

  it('enforcement: removing a mandatory capability from the supported set turns an accepted handshake into a refusal', () => {
    // validation[1] asks for a deliberate deletion to be caught. Same
    // declaration, same known set, one capability withdrawn from support.
    const declared: CapabilityDeclaration[] = [{ id: 'streaming', mandatory: true }]
    expect(negotiateCapabilities(declared, known, new Set(['streaming', 'approval'])).accepted).toBe(true)
    expect(negotiateCapabilities(declared, known, new Set(['approval'])))
      .toEqual({ accepted: false, reason: 'unsupported-mandatory-capability', capability: 'streaming' })
  })

  it('enforcement: withdrawing a capability from the KNOWN set changes the refusal reason, so the two failures stay distinguishable', () => {
    const declared: CapabilityDeclaration[] = [{ id: 'replay', mandatory: true }]
    expect(negotiateCapabilities(declared, known, new Set()))
      .toEqual({ accepted: false, reason: 'unsupported-mandatory-capability', capability: 'replay' })
    expect(negotiateCapabilities(declared, new Set(['streaming']), new Set()))
      .toEqual({ accepted: false, reason: 'unknown-mandatory-capability', capability: 'replay' })
  })

  it('enforcement: changing a schema version on any single surface entry moves the fingerprint, so an enum or required-field edit cannot ship silently', () => {
    const base: ProtocolSurface = {
      methods: [{ name: 'initialize', schemaId: 'sdk-protocol:InitializeParams', version: '1.0' }],
      events: [],
      resourceTypes: [],
    }
    const edited: ProtocolSurface = {
      ...base,
      methods: [{ name: 'initialize', schemaId: 'sdk-protocol:InitializeParams', version: '1.1' }],
    }
    expect(computeSchemaFingerprint(edited)).not.toBe(computeSchemaFingerprint(base))
  })

  it('control: an unrelated edit that changes no wire-visible field leaves the fingerprint alone, so the case above measures the change and not the act of editing', () => {
    const base: ProtocolSurface = {
      methods: [{ name: 'a', schemaId: 'x', version: '1.0' }, { name: 'b', schemaId: 'y', version: '1.0' }],
      events: [],
      resourceTypes: ['session'],
    }
    const reordered: ProtocolSurface = { ...base, methods: [base.methods[1]!, base.methods[0]!] }
    expect(computeSchemaFingerprint(reordered)).toBe(computeSchemaFingerprint(base))
  })
})

describe('P8-01 Fault: cross-implementation agreement on one fixture (validation[2])', () => {
  // validation[2] asks that TypeScript and Python clients derive the SAME
  // negotiated profile from one handshake fixture. The Python half cannot run
  // here; what CAN be asserted is that the profile is a pure function of the
  // fixture, with no dependence on ambient state, ordering, or invocation
  // count -- which is the property that makes two implementations able to
  // agree at all. A profile that varied per call could not be matched by any
  // second implementation.
  const fixture = {
    client: { min: 1, max: 4 } satisfies ProtocolVersionRange,
    server: { min: 2, max: 6 } satisfies ProtocolVersionRange,
    declared: [
      { id: 'streaming', mandatory: true },
      { id: 'replay', mandatory: false },
    ] satisfies CapabilityDeclaration[],
    known: new Set<CapabilityId>(['streaming', 'replay']),
    supported: new Set<CapabilityId>(['streaming']),
  }

  it('enforcement: the negotiated profile is identical across repeated derivations from one fixture', () => {
    const derive = (): unknown => ({
      version: negotiateProtocolVersion(fixture.client, fixture.server),
      capabilities: negotiateCapabilities(fixture.declared, fixture.known, fixture.supported),
    })
    expect(JSON.stringify(derive())).toBe(JSON.stringify(derive()))
  })

  it('enforcement: the fixture pins the exact profile, so a second implementation has a concrete target rather than a description', () => {
    // Written as literals rather than as a comparison against the functions
    // themselves: a Python port must match THESE values, and a test that
    // compared the code to itself would give it nothing to match.
    expect(negotiateProtocolVersion(fixture.client, fixture.server)).toEqual({ agreed: true, version: 4 })
    expect(negotiateCapabilities(fixture.declared, fixture.known, fixture.supported))
      .toEqual({ accepted: true, agreed: ['streaming'], ignored: ['replay'] })
  })
})
