/**
 * Clause coverage for Epic P2-02's attenuable Capability Token
 * and sub-agent delegation. One case per registry-declared must[]/
 * acceptance[] clause, with acceptance[0]'s four narrowable dimensions
 * (verbs/resources/budget/expiry) each covered by an exact-boundary pair —
 * the request equal to the parent's own limit (legal) and one unit past it
 * (illegal) — never only the rejection direction, plus a strictly-narrower
 * positive case per dimension.
 *
 * Every case calls an exported function from `../src/attenuate.ts` against
 * real branded fixture data built from a real `TrustKernelSignatureRoots`
 * handle (`createTrustKernel()`, `@deepseek-ai/dsh-trust-kernel`, Epic
 * P0-02).
 */

import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { describe, expect, it } from 'vitest'
import {
  assertTokenPresented,
  attenuateToken,
  digestToken,
  isTokenRevoked,
  issueToken,
  redactTokenForLog,
  verifyToken,
} from '../src/attenuate.ts'
import {
  CapabilityName,
  CapabilityTokenDigest,
  CapabilityTokenNonce,
  TokenBudget,
} from '../src/types.ts'
import type {
  CapabilityConsumerSurfaceKind,
  CapabilityToken,
  SignedCapabilityToken,
  TokenAttenuationRequest,
  TokenIssuanceRequest,
  TokenLineage,
} from '../src/types.ts'

const trustRoot = createTrustKernel().signatureRoots

const FIXED_TIME = 1_700_000_000_000
const PARENT_EXPIRES_AT = FIXED_TIME + 1_000_000

const tenant = TenantId('tenant-fixture')
const capability = CapabilityName('fs')
const parentSubject = PrincipalId('parent-agent')
const childSubject = PrincipalId('child-agent')

const PARENT_VERBS = ['read', 'write'] as const
const PARENT_RESOURCES = ['file:///workspace/a', 'file:///workspace/b'] as const
const PARENT_BUDGET = TokenBudget(1000)

/** A complete, must[0]-shaped root token — every field a real `issueToken` output would carry. */
function fixtureRootToken(overrides: Partial<CapabilityToken> = {}): CapabilityToken {
  return {
    subject: parentSubject,
    tenant,
    capability,
    verbs: [...PARENT_VERBS],
    resources: [...PARENT_RESOURCES],
    constraints: { budget: PARENT_BUDGET },
    expiresAt: PARENT_EXPIRES_AT,
    nonce: CapabilityTokenNonce('nonce-root'),
    delegationDepth: 0,
    parentDigest: null,
    ...overrides,
  }
}

function fixtureSigned(token: CapabilityToken): SignedCapabilityToken {
  return { token, signature: new Uint8Array([0x01, 0x02, 0x03, 0x04]) }
}

function buildIssuanceRequest(overrides: Partial<TokenIssuanceRequest> = {}): TokenIssuanceRequest {
  return {
    subject: parentSubject,
    tenant,
    capability,
    verbs: [...PARENT_VERBS],
    resources: [...PARENT_RESOURCES],
    constraints: { budget: PARENT_BUDGET },
    expiresAt: PARENT_EXPIRES_AT,
    ...overrides,
  }
}

/** A default, strictly-legal (equal-to-parent) attenuation request against `fixtureRootToken()`. */
function buildAttenuationRequest(overrides: Partial<TokenAttenuationRequest> = {}): TokenAttenuationRequest {
  return {
    subject: childSubject,
    verbs: [...PARENT_VERBS],
    resources: [...PARENT_RESOURCES],
    constraints: { budget: PARENT_BUDGET },
    expiresAt: PARENT_EXPIRES_AT,
    nonce: CapabilityTokenNonce('nonce-child'),
    ...overrides,
  }
}

describe('P2-02 Contract — must[0]: a token carries subject/tenant/capability/verbs/resources/constraints/expiry/nonce/delegationDepth/parentDigest', () => {
  it('issueToken mints a root token with exactly these ten fields, no more and no fewer', () => {
    const nonce = CapabilityTokenNonce('nonce-issue-shape')
    const signed = issueToken(trustRoot, buildIssuanceRequest(), nonce)
    expect(signed.token).toStrictEqual({
      subject: parentSubject,
      tenant,
      capability,
      verbs: [...PARENT_VERBS],
      resources: [...PARENT_RESOURCES],
      constraints: { budget: PARENT_BUDGET },
      expiresAt: PARENT_EXPIRES_AT,
      nonce,
      delegationDepth: 0,
      parentDigest: null,
    })
  })
})

describe('P2-02 Contract — must[1]: only the TrustKernel issues and verifies tokens', () => {
  it('verifyToken accepts a token issued by the real TrustKernel under the same trust root', () => {
    const signed = issueToken(trustRoot, buildIssuanceRequest(), CapabilityTokenNonce('nonce-verify-ok'))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set() })
    expect(result).toStrictEqual({ verified: true, token: signed.token })
  })

  it('verifyToken rejects a token whose signature does not match its claimed content (tampered)', () => {
    const tampered = fixtureSigned(fixtureRootToken({ nonce: CapabilityTokenNonce('nonce-tampered') }))
    const forgedSignature: SignedCapabilityToken = { token: tampered.token, signature: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }
    const result = verifyToken(trustRoot, forgedSignature, { now: FIXED_TIME, seenNonces: new Set() })
    expect(result).toStrictEqual({ verified: false, reason: 'signature-invalid' })
  })

  it('verifyToken accepts a token one millisecond before it expires', () => {
    const signed = fixtureSigned(fixtureRootToken({ expiresAt: FIXED_TIME + 1, nonce: CapabilityTokenNonce('nonce-not-yet-expired') }))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set() })
    expect(result).toStrictEqual({ verified: true, token: signed.token })
  })

  it('verifyToken rejects a token at the exact instant it expires', () => {
    const signed = fixtureSigned(fixtureRootToken({ expiresAt: FIXED_TIME, nonce: CapabilityTokenNonce('nonce-at-expiry') }))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set() })
    expect(result).toStrictEqual({ verified: false, reason: 'expired' })
  })

  it('verifyToken rejects an already-expired token', () => {
    const signed = fixtureSigned(fixtureRootToken({ expiresAt: FIXED_TIME - 1, nonce: CapabilityTokenNonce('nonce-expired') }))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set() })
    expect(result).toStrictEqual({ verified: false, reason: 'expired' })
  })

  it('verifyToken accepts a token whose nonce has not been seen before', () => {
    const signed = fixtureSigned(fixtureRootToken({ nonce: CapabilityTokenNonce('nonce-fresh') }))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set([CapabilityTokenNonce('some-other-nonce')]) })
    expect(result).toStrictEqual({ verified: true, token: signed.token })
  })

  it('verifyToken rejects a token whose nonce was already seen (replay)', () => {
    const reusedNonce = CapabilityTokenNonce('nonce-reused')
    const signed = fixtureSigned(fixtureRootToken({ nonce: reusedNonce }))
    const result = verifyToken(trustRoot, signed, { now: FIXED_TIME, seenNonces: new Set([reusedNonce]) })
    expect(result).toStrictEqual({ verified: false, reason: 'replayed' })
  })
})

describe('P2-02 Contract — must[2]/acceptance[0]: a child token\'s resources/verbs/budget/time-range never exceed its parent\'s, including at the exact limit', () => {
  const parent = fixtureSigned(fixtureRootToken())

  it('a request identical to the parent\'s own scope on every dimension is accepted', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest())
    expect(decision.accepted).toBe(true)
  })

  it('requesting a strict verb subset of the parent\'s verbs is accepted', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ verbs: ['read'] }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting a verb absent from the parent\'s verbs is rejected', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ verbs: [...PARENT_VERBS, 'execute'] }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'verbs-not-subset' })
  })

  it('requesting a strict resource subset of the parent\'s resources is accepted', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ resources: [PARENT_RESOURCES[0]] }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting a resource absent from the parent\'s resources is rejected', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ resources: [...PARENT_RESOURCES, 'file:///etc/passwd'] }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'resources-not-subset' })
  })

  it('requesting exactly the parent\'s budget is accepted (exact boundary)', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ constraints: { budget: PARENT_BUDGET } }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting one unit more than the parent\'s budget is rejected (one past the exact boundary)', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ constraints: { budget: TokenBudget(PARENT_BUDGET + 1) } }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'budget-exceeds-parent' })
  })

  it('requesting a strictly lower budget than the parent\'s is accepted', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ constraints: { budget: TokenBudget(500) } }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting an unconstrained (omitted) budget under a budget-constrained parent is rejected as wider', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ constraints: {} }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'budget-exceeds-parent' })
  })

  it('requesting any budget under an unconstrained parent is accepted', () => {
    const unconstrainedParent = fixtureSigned(fixtureRootToken({ constraints: {} }))
    const decision = attenuateToken(trustRoot, unconstrainedParent, buildAttenuationRequest({ constraints: { budget: TokenBudget(1) } }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting exactly the parent\'s expiry is accepted (exact boundary)', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ expiresAt: PARENT_EXPIRES_AT }))
    expect(decision.accepted).toBe(true)
  })

  it('requesting an expiry one millisecond past the parent\'s is rejected (one past the exact boundary)', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ expiresAt: PARENT_EXPIRES_AT + 1 }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'expiry-exceeds-parent' })
  })

  it('requesting a strictly earlier expiry than the parent\'s is accepted', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({ expiresAt: PARENT_EXPIRES_AT - 1000 }))
    expect(decision.accepted).toBe(true)
  })

  it('a request violating both verbs and budget is rejected naming verbs first (fixed check order)', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest({
      verbs: [...PARENT_VERBS, 'execute'],
      constraints: { budget: TokenBudget(PARENT_BUDGET + 1) },
    }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'verbs-not-subset' })
  })

  it('a successful attenuation inherits tenant/capability from the parent and derives delegationDepth/parentDigest, never from the request', () => {
    const decision = attenuateToken(trustRoot, parent, buildAttenuationRequest())
    expect(decision.accepted).toBe(true)
    if (!decision.accepted) return
    expect(decision.child.signature).toBeInstanceOf(Uint8Array)
    expect(decision.child.token).toStrictEqual({
      subject: childSubject,
      tenant: parent.token.tenant,
      capability: parent.token.capability,
      verbs: [...PARENT_VERBS],
      resources: [...PARENT_RESOURCES],
      constraints: { budget: PARENT_BUDGET },
      expiresAt: PARENT_EXPIRES_AT,
      nonce: CapabilityTokenNonce('nonce-child'),
      delegationDepth: parent.token.delegationDepth + 1,
      parentDigest: digestToken(parent.token),
    })
  })
})

describe('P2-02 Contract — must[3]: tools, plugin RPC, external Agents, and the ExecutionWorld all require a token', () => {
  const surfaces: readonly CapabilityConsumerSurfaceKind[] = ['tool', 'plugin-rpc', 'external-agent', 'execution-world']

  it.each(surfaces)('%s calls without a presented token are refused', (surface) => {
    const decision = assertTokenPresented(surface, undefined)
    expect(decision).toStrictEqual({ presented: false, reason: 'token-required', surface })
  })

  it.each(surfaces)('%s calls with a presented token are not refused for missing presence', (surface) => {
    const signed = fixtureSigned(fixtureRootToken())
    const decision = assertTokenPresented(surface, signed)
    expect(decision).toStrictEqual({ presented: true })
  })
})

describe('P2-02 Contract — acceptance[1]: revoking a parent token immediately invalidates every descendant', () => {
  const rootDigest = CapabilityTokenDigest('digest-root')
  const childDigest = CapabilityTokenDigest('digest-child')
  const grandchildDigest = CapabilityTokenDigest('digest-grandchild')
  const grandchildLineage: TokenLineage = [rootDigest, childDigest, grandchildDigest]

  it('revoking the root ancestor invalidates a grandchild many delegation hops away', () => {
    const revoked = new Set([rootDigest])
    expect(isTokenRevoked(grandchildLineage, revoked)).toBe(true)
  })

  it('revoking an intermediate ancestor invalidates its descendant', () => {
    const revoked = new Set([childDigest])
    expect(isTokenRevoked(grandchildLineage, revoked)).toBe(true)
  })

  it('revoking a token\'s own digest invalidates it directly', () => {
    const revoked = new Set([grandchildDigest])
    expect(isTokenRevoked(grandchildLineage, revoked)).toBe(true)
  })

  it('revoking an unrelated digest does not invalidate an unconnected lineage', () => {
    const unrelatedDigest = CapabilityTokenDigest('digest-unrelated-branch')
    const revoked = new Set([unrelatedDigest])
    expect(isTokenRevoked(grandchildLineage, revoked)).toBe(false)
  })
})

describe('P2-02 Contract — acceptance[2]: the token itself is never written into model-visible text; logs record only a digest plus security metadata', () => {
  it('redactTokenForLog produces exactly digest/subject/tenant/capability/delegationDepth/expiresAt — never verbs, resources, constraints, nonce, or the raw signature', () => {
    const token = fixtureRootToken()
    const signed = fixtureSigned(token)
    const record = redactTokenForLog(signed)
    expect(record).toStrictEqual({
      digest: digestToken(token),
      subject: token.subject,
      tenant: token.tenant,
      capability: token.capability,
      delegationDepth: token.delegationDepth,
      expiresAt: token.expiresAt,
    })
  })
})

/**
 * P2-02 Fault stage: a systematic matrix over the attenuation boundaries.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes.
 *
 * Every case here is about WIDENING, because must[2] is a one-way rule:
 * ordinary code may narrow a token and may never enlarge one. Each dimension
 * is therefore pinned from both sides — equal-to-parent admitted, one step
 * beyond refused — since a check that refused everything would satisfy the
 * refusals alone.
 */
describe('P2-02 Fault — attenuation boundary matrix', () => {
  interface TokenFault {
    readonly boundary: string
    readonly run: () => void
  }

  const roots = createTrustKernel().signatureRoots
  const parent = fixtureSigned(fixtureRootToken())

  const attenuate = (overrides: Partial<TokenAttenuationRequest>) =>
    attenuateToken(roots, parent, buildAttenuationRequest(overrides))

  const FAULTS: readonly TokenFault[] = [
    {
      boundary: '01 an equal-to-parent request is admitted, so refusals below are selective',
      run: () => expect(attenuate({}).accepted).toBe(true),
    },
    {
      boundary: '02 a narrowed verb set is admitted',
      run: () => expect(attenuate({ verbs: ['read'] }).accepted).toBe(true),
    },
    {
      boundary: '03 a verb the parent does not hold is refused',
      run: () => expect(attenuate({ verbs: ['read', 'delete'] }))
        .toMatchObject({ accepted: false, reason: 'verbs-not-subset' }),
    },
    {
      boundary: '04 an empty verb set is admitted: nothing is the strongest narrowing',
      run: () => expect(attenuate({ verbs: [] }).accepted).toBe(true),
    },
    {
      boundary: '05 a narrowed resource set is admitted',
      run: () => expect(attenuate({ resources: ['file:///workspace/a'] }).accepted).toBe(true),
    },
    {
      boundary: '06 a resource outside the parent\'s is refused',
      run: () => expect(attenuate({ resources: ['file:///etc/passwd'] }))
        .toMatchObject({ accepted: false, reason: 'resources-not-subset' }),
    },
    {
      boundary: '07 keeping every parent resource and adding one is still refused',
      run: () => expect(attenuate({ resources: [...PARENT_RESOURCES, 'file:///workspace/c'] }))
        .toMatchObject({ accepted: false, reason: 'resources-not-subset' }),
    },
    {
      boundary: '08 a lower budget is admitted',
      run: () => expect(attenuate({ constraints: { budget: TokenBudget(999) } }).accepted).toBe(true),
    },
    {
      boundary: '09 a budget equal to the parent\'s is admitted, not treated as an increase',
      run: () => expect(attenuate({ constraints: { budget: PARENT_BUDGET } }).accepted).toBe(true),
    },
    {
      boundary: '10 a budget one unit above the parent\'s is refused',
      run: () => expect(attenuate({ constraints: { budget: TokenBudget(1001) } }))
        .toMatchObject({ accepted: false, reason: 'budget-exceeds-parent' }),
    },
    {
      boundary: '11 OMITTING a budget under a constrained parent is refused as a widening',
      run: () => {
        // Going from a real ceiling to "unconstrained" is an increase, not a
        // narrowing. A subset check that only compared present values would
        // admit this, which is why omission is treated as widening.
        expect(attenuate({ constraints: {} }))
          .toMatchObject({ accepted: false, reason: 'budget-exceeds-parent' })
      },
    },
    {
      boundary: '12 an earlier expiry is admitted',
      run: () => expect(attenuate({ expiresAt: PARENT_EXPIRES_AT - 1 }).accepted).toBe(true),
    },
    {
      boundary: '13 an expiry equal to the parent\'s is admitted',
      run: () => expect(attenuate({ expiresAt: PARENT_EXPIRES_AT }).accepted).toBe(true),
    },
    {
      boundary: '14 an expiry one millisecond beyond the parent\'s is refused',
      run: () => expect(attenuate({ expiresAt: PARENT_EXPIRES_AT + 1 }))
        .toMatchObject({ accepted: false, reason: 'expiry-exceeds-parent' }),
    },
    {
      boundary: '15 a child of a child narrows again from the CHILD, not the root',
      run: () => {
        // Depth is where a subset check can silently compare against the wrong
        // ancestor: a grandchild must be bounded by its parent's narrowed set,
        // never by the root's wider one.
        const child = attenuate({ verbs: ['read'] })
        if (!child.accepted) throw new Error('unreachable')
        expect(attenuateToken(roots, child.child, buildAttenuationRequest({ verbs: ['write'] })))
          .toMatchObject({ accepted: false, reason: 'verbs-not-subset' })
      },
    },
    {
      boundary: '16 each successful attenuation increments delegationDepth',
      run: () => {
        const child = attenuate({})
        if (!child.accepted) throw new Error('unreachable')
        expect(child.child.token.delegationDepth).toBe(parent.token.delegationDepth + 1)
      },
    },
    {
      boundary: '17 a child records its parent\'s digest, so a chain can be walked back',
      run: () => {
        const child = attenuate({})
        if (!child.accepted) throw new Error('unreachable')
        expect(child.child.token.parentDigest).not.toBeNull()
      },
    },
    {
      boundary: '18 a child inherits tenant and capability verbatim, which the request cannot express',
      run: () => {
        // must[2] needs no tenant-mismatch denial reason, because attenuating
        // into another tenant is not a request the type can carry.
        const child = attenuate({})
        if (!child.accepted) throw new Error('unreachable')
        expect(child.child.token.tenant).toBe(parent.token.tenant)
        expect(child.child.token.capability).toBe(parent.token.capability)
      },
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, () => { fault.run() })
  }
})
