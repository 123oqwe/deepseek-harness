/**
 * Provider-stage RED scaffold for Epic P2-02's durable Capability Token
 * registry: real lineage reconstruction and cascading revocation
 * (acceptance[1]), a durable nonce ledger behind the replay check, and an
 * audit trail that carries only redacted records (acceptance[2]).
 *
 * Every case here observes something the Contract stage's own
 * `./token.spec.ts` structurally cannot. That file passes `isTokenRevoked`
 * three literal strings (`'digest-root'`, `'digest-child'`,
 * `'digest-grandchild'`) that no token ever produced — a correct test of the
 * membership check, but not of cascading revocation, because nothing there
 * builds a lineage out of tokens that were really issued. Every lineage
 * below is reconstructed by the service from tokens it actually minted, and
 * the digests are `digestToken` outputs, never hand-written strings.
 *
 * Every durability case constructs a SECOND store and a SECOND service over
 * the same path, sharing no value, map, or closure with the first — so a
 * fact that survives came from bytes on disk, and an in-memory double
 * cannot pass.
 *
 * must[1] ("TrustKernel 签发/验证") is deliberately unobserved here: it is
 * BLOCKED on two unmet prerequisites (`signatureRoots` is `Object.freeze({})`,
 * so no key material exists to sign or verify with; and a ctx-mediated
 * kernel enforcement point is gated on the vendored Cordis `Fiber` fix,
 * per `docs/architecture/trust-kernel-boundary.md`). No case below asserts
 * anything about a signature's origin, because nothing in this repository
 * can honestly establish one today.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CapabilityName,
  CapabilityTokenNonce,
  CapabilityTokenService,
  createFileCapabilityTokenStore,
  digestToken,
  redactTokenForLog,
  TokenBudget,
} from '../src/index.ts'
import type {
  CapabilityToken,
  SignedCapabilityToken,
  TokenAttenuationRequest,
  TokenIssuanceRequest,
} from '../src/index.ts'

const trustRoot = createTrustKernel().signatureRoots

const FIXED_TIME = 1_700_000_000_000
const ROOT_EXPIRES_AT = FIXED_TIME + 1_000_000

const tenant = TenantId('tenant-fixture')
const capability = CapabilityName('fs')
const rootSubject = PrincipalId('root-agent')
const childSubject = PrincipalId('child-agent')
const grandchildSubject = PrincipalId('grandchild-agent')

const ROOT_VERBS = ['read', 'write'] as const
const ROOT_RESOURCES = ['file:///workspace/a', 'file:///workspace/b'] as const

let directory: string
let storePath: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-capability-token-'))
  storePath = join(directory, 'tokens.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function issuanceRequest(overrides: Partial<TokenIssuanceRequest> = {}): TokenIssuanceRequest {
  return {
    subject: rootSubject,
    tenant,
    capability,
    verbs: [...ROOT_VERBS],
    resources: [...ROOT_RESOURCES],
    constraints: { budget: TokenBudget(1000) },
    expiresAt: ROOT_EXPIRES_AT,
    ...overrides,
  }
}

function attenuationRequest(overrides: Partial<TokenAttenuationRequest> = {}): TokenAttenuationRequest {
  return {
    subject: childSubject,
    verbs: ['read'],
    resources: [ROOT_RESOURCES[0]],
    constraints: { budget: TokenBudget(500) },
    expiresAt: ROOT_EXPIRES_AT - 1000,
    nonce: CapabilityTokenNonce('nonce-child'),
    ...overrides,
  }
}

/** A service over this test's own store path — the only way one is built. */
async function openService(): Promise<CapabilityTokenService> {
  return CapabilityTokenService.restore(createFileCapabilityTokenStore(storePath), trustRoot)
}

/** Accept an attenuation that must succeed, failing loudly rather than silently skipping. */
async function attenuateOrThrow(
  service: CapabilityTokenService,
  parent: SignedCapabilityToken,
  request: TokenAttenuationRequest,
): Promise<SignedCapabilityToken> {
  const decision = await service.attenuate(parent, request)
  if (!decision.accepted) throw new Error(`expected an accepted attenuation, got ${decision.reason}`)
  return decision.child
}

/** Build the root → child → grandchild delegation chain every lineage case shares. */
async function seedThreeGenerations(service: CapabilityTokenService): Promise<{
  root: SignedCapabilityToken
  child: SignedCapabilityToken
  grandchild: SignedCapabilityToken
}> {
  const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
  const child = await attenuateOrThrow(service, root, attenuationRequest())
  const grandchild = await attenuateOrThrow(service, child, attenuationRequest({
    subject: grandchildSubject,
    verbs: ['read'],
    resources: [ROOT_RESOURCES[0]],
    constraints: { budget: TokenBudget(100) },
    expiresAt: ROOT_EXPIRES_AT - 2000,
    nonce: CapabilityTokenNonce('nonce-grandchild'),
  }))
  return { root, child, grandchild }
}

describe('P2-02 Provider — the file-backed store is durable across a restart', () => {
  it('reports an empty state for a path that has never been written to, rather than failing', async () => {
    const state = await createFileCapabilityTokenStore(storePath).load()
    expect(state).toStrictEqual({ tokens: [], revokedDigests: [], spentNonces: [], auditRecords: [] })
  })

  it('reads back through a separate store instance exactly what the first instance wrote, signature bytes included', async () => {
    const issued = await (await openService()).issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    const reread = await createFileCapabilityTokenStore(storePath).load()
    expect(reread.tokens).toStrictEqual([issued])
    expect(reread.tokens[0]?.signature).toBeInstanceOf(Uint8Array)
  })
})

describe('P2-02 Provider — acceptance[1]: a lineage reconstructed from really-issued tokens, not a hand-built array', () => {
  it('reconstructs a grandchild\'s full root-first digest chain by walking recorded parentDigest hops', async () => {
    const service = await openService()
    const { root, child, grandchild } = await seedThreeGenerations(service)
    expect(service.lineageOf(digestToken(grandchild.token))).toStrictEqual([
      digestToken(root.token),
      digestToken(child.token),
      digestToken(grandchild.token),
    ])
  })

  it('reconstructs a root token\'s lineage as exactly its own single digest', async () => {
    const service = await openService()
    const { root } = await seedThreeGenerations(service)
    expect(service.lineageOf(digestToken(root.token))).toStrictEqual([digestToken(root.token)])
  })

  it('reconstructs no lineage for a digest no recorded token has', async () => {
    const service = await openService()
    await seedThreeGenerations(service)
    expect(service.lineageOf(digestToken(unrecordedToken()))).toBeUndefined()
  })

  it('the grandchild\'s own token never names the root\'s digest, so a cascade cannot be a direct digest match', async () => {
    const service = await openService()
    const { root, child, grandchild } = await seedThreeGenerations(service)
    expect(grandchild.token.parentDigest).toStrictEqual(digestToken(child.token))
    expect(grandchild.token.parentDigest).not.toStrictEqual(digestToken(root.token))
  })

  it('revoking the root invalidates a grandchild two attenuation hops away', async () => {
    const service = await openService()
    const { root, grandchild } = await seedThreeGenerations(service)
    await service.revoke(digestToken(root.token))
    expect(service.isRevoked(digestToken(grandchild.token))).toBe(true)
  })

  it('revoking an intermediate child invalidates its own descendant but leaves the root valid', async () => {
    const service = await openService()
    const { root, child, grandchild } = await seedThreeGenerations(service)
    await service.revoke(digestToken(child.token))
    expect(service.isRevoked(digestToken(grandchild.token))).toBe(true)
    expect(service.isRevoked(digestToken(root.token))).toBe(false)
  })

  it('revoking one branch\'s root leaves an unrelated branch\'s descendant valid', async () => {
    const service = await openService()
    const { root, grandchild } = await seedThreeGenerations(service)
    const otherRoot = await service.issue(
      issuanceRequest({ subject: PrincipalId('other-root-agent') }),
      CapabilityTokenNonce('nonce-other-root'),
    )
    const otherChild = await attenuateOrThrow(service, otherRoot, attenuationRequest({
      subject: PrincipalId('other-child-agent'),
      nonce: CapabilityTokenNonce('nonce-other-child'),
    }))
    await service.revoke(digestToken(root.token))
    expect(service.isRevoked(digestToken(grandchild.token))).toBe(true)
    expect(service.isRevoked(digestToken(otherChild.token))).toBe(false)
  })

  it('a revocation recorded before a restart still invalidates the descendant after it', async () => {
    const seeded = await openService()
    const { root, grandchild } = await seedThreeGenerations(seeded)
    await seeded.revoke(digestToken(root.token))

    const restarted = await openService()
    expect(restarted.isRevoked(digestToken(grandchild.token))).toBe(true)
  })
})

describe('P2-02 Provider — the nonce ledger behind the replay check is durable', () => {
  it('verifies a freshly issued token whose nonce has never been spent', async () => {
    const service = await openService()
    const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    expect(await service.verify(root, FIXED_TIME)).toStrictEqual({ verified: true, token: root.token })
  })

  it('refuses a second presentation of the same token as replayed', async () => {
    const service = await openService()
    const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    await service.verify(root, FIXED_TIME)
    expect(await service.verify(root, FIXED_TIME)).toStrictEqual({ verified: false, reason: 'replayed' })
  })

  it('still refuses a replay after a restart, because the spent nonce was recorded durably', async () => {
    const seeded = await openService()
    const root = await seeded.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    await seeded.verify(root, FIXED_TIME)

    const restarted = await openService()
    expect(await restarted.verify(root, FIXED_TIME)).toStrictEqual({ verified: false, reason: 'replayed' })
  })

  it('still verifies a sibling token whose own nonce was never spent, after the same restart', async () => {
    const seeded = await openService()
    const spent = await seeded.issue(issuanceRequest(), CapabilityTokenNonce('nonce-spent'))
    const unspent = await seeded.issue(issuanceRequest(), CapabilityTokenNonce('nonce-unspent'))
    await seeded.verify(spent, FIXED_TIME)

    const restarted = await openService()
    expect(await restarted.verify(unspent, FIXED_TIME)).toStrictEqual({ verified: true, token: unspent.token })
  })

  it('refuses an expired token through the service exactly as verifyToken does', async () => {
    const service = await openService()
    const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    expect(await service.verify(root, ROOT_EXPIRES_AT)).toStrictEqual({ verified: false, reason: 'expired' })
  })
})

describe('P2-02 Provider — attenuation decisions are delegated, and a refusal records nothing', () => {
  it('records an accepted child so its lineage is reconstructable', async () => {
    const service = await openService()
    const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    const child = await attenuateOrThrow(service, root, attenuationRequest())
    expect(service.lineageOf(digestToken(child.token))).toStrictEqual([digestToken(root.token), digestToken(child.token)])
  })

  it('refuses a widening request with attenuateToken\'s own reason, unchanged', async () => {
    const service = await openService()
    const root = await service.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    const decision = await service.attenuate(root, attenuationRequest({ verbs: ['read', 'execute'] }))
    expect(decision).toStrictEqual({ accepted: false, reason: 'verbs-not-subset' })
  })

  it('writes nothing at all for a refused attenuation: no token, no audit record, across a restart', async () => {
    const seeded = await openService()
    const root = await seeded.issue(issuanceRequest(), CapabilityTokenNonce('nonce-root'))
    await seeded.attenuate(root, attenuationRequest({ verbs: ['read', 'execute'] }))

    const restarted = await openService()
    const state = await createFileCapabilityTokenStore(storePath).load()
    expect(state.tokens).toStrictEqual([root])
    expect(restarted.auditRecords()).toStrictEqual([redactTokenForLog(root)])
  })
})

describe('P2-02 Provider — acceptance[2]: the audit trail carries only a digest and security metadata', () => {
  it('records exactly redactTokenForLog\'s output for each issued and attenuated token, oldest first', async () => {
    const service = await openService()
    const { root, child, grandchild } = await seedThreeGenerations(service)
    expect(service.auditRecords()).toStrictEqual([
      redactTokenForLog(root),
      redactTokenForLog(child),
      redactTokenForLog(grandchild),
    ])
  })

  it('never lets a nonce or a signature byte reach the audit surface', async () => {
    const service = await openService()
    await seedThreeGenerations(service)
    const serialized = JSON.stringify(service.auditRecords())
    expect(serialized).not.toContain('nonce-root')
    expect(serialized).not.toContain('nonce-child')
    expect(serialized).not.toContain('nonce-grandchild')
    expect(serialized).not.toContain('signature')
  })

  it('keeps the audit trail free of nonces after a restart, when it is read back from disk', async () => {
    const seeded = await openService()
    await seedThreeGenerations(seeded)

    const restarted = await openService()
    const serialized = JSON.stringify(restarted.auditRecords())
    expect(serialized).not.toContain('nonce-root')
    expect(restarted.auditRecords()).toHaveLength(3)
  })

  it('keeps every audit record\'s digest equal to the digest of a token the store really holds', async () => {
    const service = await openService()
    await seedThreeGenerations(service)
    const state = await createFileCapabilityTokenStore(storePath).load()
    const storedDigests = new Set<string>(state.tokens.map(signed => digestToken(signed.token)))
    for (const record of service.auditRecords()) {
      expect(storedDigests.has(record.digest)).toBe(true)
    }
  })

  it('leaves the audit trail on disk carrying no nonce, even though the token registry beside it must', async () => {
    const service = await openService()
    await seedThreeGenerations(service)
    const raw = JSON.parse(await readFile(storePath, 'utf8')) as { auditRecords: unknown; tokens: unknown }
    expect(JSON.stringify(raw.auditRecords)).not.toContain('nonce-root')
    expect(JSON.stringify(raw.tokens)).toContain('nonce-root')
  })
})

/** A structurally valid token this service was never asked to record, for the negative lineage case. */
function unrecordedToken(): CapabilityToken {
  return {
    subject: PrincipalId('never-recorded'),
    tenant,
    capability,
    verbs: [...ROOT_VERBS],
    resources: [...ROOT_RESOURCES],
    constraints: { budget: TokenBudget(1000) },
    expiresAt: ROOT_EXPIRES_AT,
    nonce: CapabilityTokenNonce('nonce-never-recorded'),
    delegationDepth: 0,
    parentDigest: null,
  }
}
