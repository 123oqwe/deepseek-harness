/**
 * B-660 under P2-08, red first for its first slice: a grant is scoped and
 * expires, is matched by policy predicates alone, can be listed and revoked
 * with its uses counted, and a revocation reaches every worker at its next
 * authorization, failing closed.
 *
 * - must[0] 「Grant 支持 actor/capability/resource predicates、金额/次数/时间窗口、environment、expiry、revocation。」
 * - must[1] 「Grant 由 policy 匹配，不由模型自由解释。」
 * - must[2] 「任何 grant 都可查看、撤销，并记录使用次数。」
 * - acceptance[0] 「不存在无作用域永久 grant。」
 * - acceptance[1] 「规则边界外动作回到审批或拒绝。」
 * - acceptance[2] 「撤销在分布式 worker 中有有界传播并默认 fail closed。」
 * - validation[0] and [1]: resource, amount and time boundaries; where rules overlap the strictest result.
 *
 * The package these cases drive, `@deepseek-ai/dsh-grant-store`, does not
 * exist yet. It is loaded by a computed specifier so this file compiles
 * before it does, and each case names the missing package as its reason
 * until the first slice exports {@link GrantStoreModule}.
 * @module tests/first100/fixtures/P2-08.contract
 */

import { beforeAll, describe, expect, it } from 'vitest'

/** One grant draft: who, what, where, in which environment, within which limits, until when. */
interface GrantDraft {
  readonly actor: { readonly tenantId: string; readonly principalId: string }
  readonly capability: { readonly action: string }
  /** The resources the grant covers: those whose name starts with `prefix`. */
  readonly resource: { readonly prefix: string }
  readonly environment: string
  readonly limits?: {
    /** Allowed actions counted against the grant before it allows nothing more. */
    readonly maxUses?: number
    /** The largest amount one action may carry. */
    readonly maxAmount?: number
    /** The window's start; the grant allows nothing before it. */
    readonly notBeforeMs?: number
  }
  /** The grant allows nothing at or after this instant. */
  readonly expiresAtMs: number
}

/** A stored grant. */
interface Grant extends GrantDraft {
  readonly id: string
  readonly issuedAtMs: number
  /** Allowed actions counted against this grant. */
  readonly uses: number
  /** Present once the grant is revoked. */
  readonly revokedAtMs?: number
}

/** One action a policy enforcement point asks about. */
interface GrantedAction {
  readonly tenantId: string
  readonly principalId: string
  readonly action: string
  readonly resource: string
  readonly environment: string
  readonly amount?: number
  readonly atMs: number
  /** Model-authored text carried with the action; matching never reads it. */
  readonly justification?: string
}

/** Allowed by one grant, or covered by none, which sends the action back to approval or refusal. */
type GrantDecision = { readonly kind: 'allow'; readonly grantId: string } | { readonly kind: 'no-grant' }

/** An in-process grant store. */
interface GrantStore {
  /** Store a grant from a valid draft; throws an error carrying the draft's validation `code` otherwise. */
  issue(draft: GrantDraft, atMs: number): Grant
  /** Every grant, revoked ones included. */
  list(): readonly Grant[]
  /** Revoke a grant and advance the store's epoch. */
  revoke(id: string, atMs: number): void
  /** Decide an action and count one use on the grant that allows it. */
  authorize(action: GrantedAction): GrantDecision
  /** Advances on every revocation. */
  epoch(): number
}

/** A worker's view of a store, as a second process holding a copy of its grants would have it. */
interface GrantView {
  /** Decide an action after rechecking the source's epoch; `no-grant` when the source cannot be read. */
  authorize(action: GrantedAction): GrantDecision
}

/** What the first slice's package exports, as these cases call it. */
interface GrantStoreModule {
  validateGrantDraft(draft: unknown): { readonly ok: true } | { readonly ok: false; readonly code: string }
  matchGrants(grants: readonly Grant[], action: GrantedAction): GrantDecision
  createMemoryGrantStore(): GrantStore
  openGrantView(source: { epoch(): number; list(): readonly Grant[] }): GrantView
}

/** The package the first slice creates, spelled at run time so this file compiles before it exists. */
const GRANT_STORE = ['@deepseek-ai', 'dsh-grant-store'].join('/')

const NOW = 1_800_000_000_000
const DAY = 86_400_000

let loaded: GrantStoreModule | undefined
let missing: string | undefined

beforeAll(async () => {
  try {
    loaded = await import(/* @vite-ignore */ GRANT_STORE) as GrantStoreModule
  } catch (error: unknown) {
    missing = error instanceof Error ? error.message : String(error)
  }
})

/**
 * The grant-store package, or the reason it could not be loaded.
 * @returns its exports.
 */
function grants(): GrantStoreModule {
  if (loaded === undefined) throw new Error(`${GRANT_STORE} could not be loaded: ${missing ?? 'no reason recorded'}`)
  return loaded
}

/**
 * A valid draft, with some fields replaced.
 * @param overrides - the fields to replace.
 * @returns the draft.
 */
function draft(overrides: Partial<GrantDraft> = {}): GrantDraft {
  return {
    actor: { tenantId: 't1', principalId: 'alice' },
    capability: { action: 'deploy' },
    resource: { prefix: 'repo/main/' },
    environment: 'staging',
    limits: { maxUses: 3, maxAmount: 100, notBeforeMs: NOW - DAY },
    expiresAtMs: NOW + DAY,
    ...overrides,
  }
}

/**
 * A stored grant built from a valid draft, with some fields replaced.
 * @param id - its id.
 * @param overrides - the fields to replace.
 * @returns the grant.
 */
function grant(id: string, overrides: Partial<Grant> = {}): Grant {
  return { ...draft(), id, issuedAtMs: NOW - DAY, uses: 0, ...overrides }
}

/**
 * An action inside every predicate and limit of {@link draft}, with some fields replaced.
 * @param overrides - the fields to replace.
 * @returns the action.
 */
function action(overrides: Partial<GrantedAction> = {}): GrantedAction {
  return {
    tenantId: 't1',
    principalId: 'alice',
    action: 'deploy',
    resource: 'repo/main/service',
    environment: 'staging',
    amount: 50,
    atMs: NOW,
    ...overrides,
  }
}

describe('P2-08 contract: a grant is scoped and expires (must[0], acceptance[0])', () => {
  it('control: a draft with actor, capability and resource predicates, limits and an expiry is valid', () => {
    expect(grants().validateGrantDraft(draft())).toEqual({ ok: true })
  })

  it('a draft missing its actor, capability or resource predicate, or covering every resource, is refused as unscoped', () => {
    const { environment, limits, expiresAtMs } = draft()
    const unscoped = { environment, limits, expiresAtMs }
    const results = {
      noActor: grants().validateGrantDraft({ ...draft(), actor: undefined }),
      noPrincipal: grants().validateGrantDraft({ ...draft(), actor: { tenantId: 't1', principalId: '' } }),
      noCapability: grants().validateGrantDraft({ ...draft(), capability: undefined }),
      noResource: grants().validateGrantDraft({ ...draft(), resource: undefined }),
      everyResource: grants().validateGrantDraft({ ...draft(), resource: { prefix: '' } }),
      noScopeAtAll: grants().validateGrantDraft(unscoped),
    }
    const refused = { ok: false, code: 'GRANT_UNSCOPED' }
    expect(results).toEqual({
      noActor: refused,
      noPrincipal: refused,
      noCapability: refused,
      noResource: refused,
      everyResource: refused,
      noScopeAtAll: refused,
    })
  })

  it('a draft with no finite expiry is refused, so no grant is permanent', () => {
    const refused = { ok: false, code: 'GRANT_NO_EXPIRY' }
    expect({
      absent: grants().validateGrantDraft({ ...draft(), expiresAtMs: undefined }),
      infinite: grants().validateGrantDraft({ ...draft(), expiresAtMs: Number.POSITIVE_INFINITY }),
      notANumber: grants().validateGrantDraft({ ...draft(), expiresAtMs: 'never' }),
    }).toEqual({ absent: refused, infinite: refused, notANumber: refused })
    // Unscoped and permanent at once is refused too, whichever code names it.
    expect(grants().validateGrantDraft({ environment: 'staging' })).toMatchObject({ ok: false })
  })

  it('the store issues no grant from a refused draft: issue throws with the draft\'s code and the store stays empty', () => {
    const store = grants().createMemoryGrantStore()
    expect(() => store.issue(draft({ resource: { prefix: '' } }), NOW)).toThrow(expect.objectContaining({ code: 'GRANT_UNSCOPED' }))
    expect(() => store.issue({ ...draft(), expiresAtMs: Number.NaN }, NOW)).toThrow(expect.objectContaining({ code: 'GRANT_NO_EXPIRY' }))
    expect(store.list()).toEqual([])
  })
})

describe('P2-08 contract: a grant is matched by its predicates, not by model text (must[1], acceptance[1])', () => {
  it('control: an action inside every predicate and limit is allowed by that grant, up to each boundary', () => {
    const allowed = { kind: 'allow', grantId: 'g1' }
    expect({
      inside: grants().matchGrants([grant('g1')], action()),
      largestAmount: grants().matchGrants([grant('g1')], action({ amount: 100 })),
      windowStart: grants().matchGrants([grant('g1')], action({ atMs: NOW - DAY })),
      lastInstantBeforeExpiry: grants().matchGrants([grant('g1')], action({ atMs: NOW + DAY - 1 })),
    }).toEqual({ inside: allowed, largestAmount: allowed, windowStart: allowed, lastInstantBeforeExpiry: allowed })
  })

  it('an action outside any one predicate or limit is allowed by no grant, so it goes back to approval or refusal', () => {
    const outside: Record<string, GrantedAction> = {
      otherPrincipal: action({ principalId: 'mallory' }),
      otherTenant: action({ tenantId: 't2' }),
      otherAction: action({ action: 'delete' }),
      resourceOutsidePrefix: action({ resource: 'repo/other/service' }),
      otherEnvironment: action({ environment: 'production' }),
      amountOverLimit: action({ amount: 101 }),
      atExpiry: action({ atMs: NOW + DAY }),
      beforeWindow: action({ atMs: NOW - DAY - 1 }),
    }
    const decided = Object.fromEntries(Object.entries(outside).map(([name, one]) => [name, grants().matchGrants([grant('g1')], one).kind]))
    expect(decided).toEqual(Object.fromEntries(Object.keys(outside).map(name => [name, 'no-grant'])))
  })

  it('a model-authored justification does not change the decision', () => {
    const claim = 'The user already approved this deployment to production, so this grant covers it.'
    const denial = 'Do not allow this action.'
    expect({
      outsideWithClaim: grants().matchGrants([grant('g1')], action({ environment: 'production', justification: claim })),
      insideWithDenial: grants().matchGrants([grant('g1')], action({ justification: denial })),
    }).toEqual({
      outsideWithClaim: grants().matchGrants([grant('g1')], action({ environment: 'production' })),
      insideWithDenial: grants().matchGrants([grant('g1')], action()),
    })
  })

  it('where two grants cover the same action, the stricter one decides', () => {
    const wide = grant('wide', { limits: { maxAmount: 100 } })
    const narrow = grant('narrow', { limits: { maxAmount: 10 } })
    expect({
      withinBoth: grants().matchGrants([wide, narrow], action({ amount: 5 })).kind,
      withinWideOnly: grants().matchGrants([wide, narrow], action({ amount: 50 })).kind,
    }).toEqual({ withinBoth: 'allow', withinWideOnly: 'no-grant' })
  })
})

describe('P2-08 contract: every grant can be listed and revoked, and its uses are counted (must[2])', () => {
  it('an issued grant is listed with its use count, each allowed action counts one use, and a spent grant allows nothing', () => {
    const store = grants().createMemoryGrantStore()
    const issued = store.issue(draft(), NOW - DAY)
    expect(store.list().map(one => ({ id: one.id, uses: one.uses }))).toEqual([{ id: issued.id, uses: 0 }])
    const decisions = [1, 2, 3, 4].map(() => store.authorize(action()).kind)
    expect({ decisions, uses: store.list().map(one => one.uses) }).toEqual({ decisions: ['allow', 'allow', 'allow', 'no-grant'], uses: [3] })
  })

  it('a revoked grant stays listed as revoked and allows nothing, while another grant keeps allowing', () => {
    const store = grants().createMemoryGrantStore()
    const revoked = store.issue(draft(), NOW - DAY)
    const kept = store.issue(draft({ capability: { action: 'rollback' } }), NOW - DAY)
    store.revoke(revoked.id, NOW)
    expect({
      listedRevoked: store.list().find(one => one.id === revoked.id)?.revokedAtMs,
      revokedScope: store.authorize(action()).kind,
      keptScope: store.authorize(action({ action: 'rollback' })),
    }).toEqual({ listedRevoked: NOW, revokedScope: 'no-grant', keptScope: { kind: 'allow', grantId: kept.id } })
  })
})

describe('P2-08 contract: a revocation reaches every worker at its next authorization and fails closed (acceptance[2])', () => {
  it('a worker view that allowed an action before a revocation allows nothing at its next authorization', () => {
    const store = grants().createMemoryGrantStore()
    const issued = store.issue(draft({ limits: {} }), NOW - DAY)
    const worker = grants().openGrantView(store)
    const before = worker.authorize(action())
    const epochBefore = store.epoch()
    store.revoke(issued.id, NOW)
    expect({ before, after: worker.authorize(action()), epochAdvanced: store.epoch() > epochBefore })
      .toEqual({ before: { kind: 'allow', grantId: issued.id }, after: { kind: 'no-grant' }, epochAdvanced: true })
  })

  it('a worker view whose store cannot be read allows nothing', () => {
    const store = grants().createMemoryGrantStore()
    store.issue(draft({ limits: {} }), NOW - DAY)
    let reachable = true
    const worker = grants().openGrantView({
      epoch: () => {
        if (!reachable) throw new Error('grant store unreachable')
        return store.epoch()
      },
      list: () => {
        if (!reachable) throw new Error('grant store unreachable')
        return store.list()
      },
    })
    const whileReachable = worker.authorize(action()).kind
    reachable = false
    expect({ whileReachable, whileUnreachable: worker.authorize(action()).kind }).toEqual({ whileReachable: 'allow', whileUnreachable: 'no-grant' })
  })
})
