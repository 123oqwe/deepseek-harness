/**
 * Deriving one child's Capability Token from its parent's (Epic P2-02 must[2],
 * acceptance[0]).
 *
 * **One derivation, several kinds of child.** This module was lifted out of
 * `@deepseek-ai/dsh-subagent`'s `child-agent.ts`, where it could only mint a
 * token for a child AGENT. A nested or detached workflow run needs exactly the
 * same narrowing, and a second copy of it would be a second answer to "may
 * this child hold this authority" — the question least able to afford two
 * answers. The child subject is therefore whatever principal the caller names,
 * agent or workflow run, and nothing here knows which.
 *
 * Every narrowing decision stays inside `./attenuate.ts`'s `attenuateToken`:
 * this module computes a REQUEST and never a grant, so the two ways a child
 * could widen — naming a resource the parent lacks, or asking for more budget
 * or a later expiry — are refused by the one checked path rather than by a
 * rule restated here.
 *
 * @module @deepseek-ai/dsh-capability-token/delegate
 */
import type { CapabilityTokenNonce, PrincipalId, SignedCapabilityToken, TokenConstraints } from './types.ts'
import type { TokenAttenuationDenialReason } from './types.ts'
import { attenuateToken } from './attenuate.ts'
import type { TrustKernelSignatureRoots } from '@deepseek-ai/dsh-trust-kernel'

/**
 * A child's resource restriction, declared structurally.
 *
 * Deliberately NOT `ToolRestriction` imported from `@deepseek-ai/dsh-tools`.
 * That type lives in the `core` group, which is `orchestration-runtime`, and
 * this package is `capability-definitions`: importing it would be an upward
 * layer edge, the same one `dsh-tools`' own `external-effect.ts` avoids by
 * declaring its policy and approval ports structurally. The shape is the
 * contract; a caller holding a real `ToolRestriction` satisfies it as-is.
 */
export interface ChildResourceFilter {
  /** Resources to keep, INTERSECTED with the parent's; absent keeps all of them. */
  readonly allow?: readonly string[]
  /** Resources to remove after the intersection. */
  readonly deny?: readonly string[]
}

/** Raised when a requested child authority would widen its parent's. */
export class DelegatedCapabilityError extends Error {
  constructor(public readonly reason: TokenAttenuationDenialReason) {
    super(`delegated capability token refused: ${reason}`)
    this.name = 'DelegatedCapabilityError'
  }
}

/**
 * The per-delegation values a child's token needs that its parent's cannot
 * supply: who the child is, a fresh anti-replay nonce, and the child's own
 * requested ceilings. Every one is still checked against the parent by
 * {@link attenuateDelegatedToken} — supplying them is a request, not a grant.
 */
export interface DelegatedTokenRequest {
  /** The child's own principal, which becomes the child token's `subject`. */
  readonly subject: PrincipalId
  /** A fresh, caller-generated nonce for the child token. */
  readonly nonce: CapabilityTokenNonce
  /** The child's requested expiry; never accepted beyond the parent's. */
  readonly expiresAt: number
  /** The child's requested constraints; never accepted above the parent's budget. */
  readonly constraints: TokenConstraints
}

/**
 * Project a parent token's authorized resources through one child's filter —
 * the intersection a restriction already means for visibility, applied to
 * AUTHORITY so the two cannot disagree.
 *
 * Fail-closed in both directions: `allow` INTERSECTS with the parent's set
 * rather than replacing it, so a child allowed a resource its parent never
 * held gains nothing; `deny` then removes. A child with no filter inherits the
 * parent's resources verbatim — equal, never wider.
 * @param parentResources - the parent token's authorized resource names.
 * @param filter - the child's declared restriction, or `undefined` for none.
 * @returns the child's resources, always a subset of `parentResources`.
 */
export function delegatedChildResources(
  parentResources: readonly string[],
  filter: ChildResourceFilter | undefined,
): readonly string[] {
  if (filter === undefined) return [...parentResources]
  const allow = filter.allow === undefined ? undefined : new Set(filter.allow)
  const deny = filter.deny === undefined ? undefined : new Set(filter.deny)
  return parentResources.filter(name => (allow === undefined || allow.has(name)) && deny?.has(name) !== true)
}

/**
 * Mint the Capability Token one child runs under, by attenuating its parent's
 * (acceptance[0]: a child is never wider than its parent on any dimension).
 *
 * The child's resources are the parent's projected through `filter`; its verbs
 * are the parent's verbatim, because this seam narrows WHICH resources and
 * never which operations on them; its expiry and budget are the caller's
 * request, which `attenuateToken` accepts only when it does not exceed the
 * parent's.
 * @param trustRoot - the signature roots the child token is minted under.
 * @param parent - the parent's already-held token.
 * @param filter - the child's resource restriction, or `undefined` for none.
 * @param request - the child's subject, nonce, and requested ceilings.
 * @returns the freshly minted child token, never wider than `parent`.
 * @throws {DelegatedCapabilityError} when the requested authority would widen the parent's.
 */
export function attenuateDelegatedToken(
  trustRoot: TrustKernelSignatureRoots,
  parent: SignedCapabilityToken,
  filter: ChildResourceFilter | undefined,
  request: DelegatedTokenRequest,
): SignedCapabilityToken {
  const decision = attenuateToken(trustRoot, parent, {
    subject: request.subject,
    verbs: [...parent.token.verbs],
    resources: delegatedChildResources(parent.token.resources, filter),
    constraints: request.constraints,
    expiresAt: request.expiresAt,
    nonce: request.nonce,
  })
  if (!decision.accepted) throw new DelegatedCapabilityError(decision.reason)
  return decision.child
}
