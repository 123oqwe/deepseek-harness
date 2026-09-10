/**
 * The mounted Capability Token provider (Epic P2-02 must[1], must[3],
 * acceptance[0], acceptance[1]; §12.69, §12.70).
 *
 * **This package exists because the mechanism had no subject.** P2-02's
 * definition, its attenuation and its `assertTokenPresented` check were all
 * complete and tested, and none of them was reachable on any launched profile:
 * nothing issued a token, nothing armed the requirement, and the definition
 * package is not a plugin at all. Its sign-off was withdrawn for exactly that
 * (§12.69). This provider is what makes those clauses have a subject —
 * mounting it in `bundle/base` is the whole of the third question.
 *
 * The signing key never leaves the Trust Kernel: this plugin holds the
 * `TrustKernelSignatureRoots` HANDLE and passes it through, so no key material
 * reaches a config field, a log line, a session event or this package's own
 * state (§12.70).
 *
 * @module @deepseek-ai/dsh-capability-token-file
 */
import { randomBytes } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { CapabilityTokenService } from '@deepseek-ai/dsh-capability-token'
// The service TYPE is declared by the definition package, not here: a consumer
// reading `ctx.get('capabilityTokens')` cannot import a provider, and declaring
// it provider-side left every such read typed `any`.
import type { CapabilityTokenProviderContract } from '@deepseek-ai/dsh-capability-token'
import { digestToken } from '@deepseek-ai/dsh-capability-token'
import { DelegatedCapabilityError, delegatedChildResources } from '@deepseek-ai/dsh-capability-token/delegate'
import type { ChildResourceFilter } from '@deepseek-ai/dsh-capability-token/delegate'
import type {
  CapabilityName,
  CapabilityTokenDigest,
  CapabilityTokenNonce,
  PrincipalId,
  SignedCapabilityToken,
  TenantId,
} from '@deepseek-ai/dsh-capability-token'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: make `ctx.tools` and the `agent/*` events resolve through
// declaration merging when this plugin is composed beside them.
import { TOOL_CAPABILITY_VERB } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { openFileCapabilityTokenStore } from './store.ts'

export { openFileCapabilityTokenStore } from './store.ts'

/** Where this mount keeps its tokens, and whether it arms the tool requirement. */
export interface Config {
  /**
   * Directory holding `capability-tokens.json`.
   *
   * Deployment-varying, and derived by the profile from its home rather than
   * written literally: a hardcoded `.dsh` would be the tunable this repository
   * forbids, and two hosts sharing a home share a revocation set.
   */
  directory: string
  /**
   * Whether every tool call in this composition must present a token
   * (must[3]).
   *
   * A validated field rather than a constant because a deployment that mounts
   * the store to ISSUE and record tokens without yet enforcing them is a real
   * arrangement — enforcement is the step that can refuse work. `bundle/base`
   * sets it true; a composition that has not attached tokens to its tool path
   * yet can mount with it false and still get issuance and audit.
   */
  requireForTools: boolean
  /** How long an issued session-root token stays valid, in milliseconds. */
  sessionTokenTtlMs: number
}

/**
 * The verbs a session-root token carries; a delegated child narrows from these.
 *
 * `TOOL_CAPABILITY_VERB` rather than a literal: it is the verb
 * `assertTokenPresented` demands for a tool call, and a token issued with any
 * other string would be signed, recorded, and refused at every call — a
 * failure that looks like the gate working.
 */
const SESSION_ROOT_VERBS: readonly string[] = Object.freeze([TOOL_CAPABILITY_VERB])

/**
 * The mounted token provider, published as `ctx.capabilityTokens`.
 *
 * Publishes the service the definition package describes and keeps the
 * per-session root tokens this mount issued, so a consumer asks for a
 * session's token rather than minting a second one.
 */
export default class CapabilityTokenFilePlugin extends Service implements CapabilityTokenProviderContract {
  /**
   * Declared injections.
   *
   * `tools` is a hard dependency: this plugin arms the tool requirement and
   * reads the registered schemas to scope a session token's resources, and
   * `ctx.tools` is only legitimate for a declared injection — the property
   * proxy is topology-sensitive, which is why the repo reserves it for these.
   * The Trust Kernel is read through `ctx.get('trustKernel')` instead, since
   * it is pinned rather than injected.
   */
  static inject = ['tools']

  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
    requireForTools: z.boolean().default(false),
    sessionTokenTtlMs: z.number().min(1).default(24 * 60 * 60 * 1000),
  }) as unknown as z<Config>

  /**
   * Tokens this mount issued, by session. Never persisted here — the store
   * owns durability.
   *
   * TypeScript `private` rather than an ECMAScript `#field`: consumers reach
   * this plugin through Cordis's service PROXY, and a `#field` read through a
   * proxy throws `Cannot read private member … from an object whose class did
   * not declare it`. `dsh-lease-sqlite` holds its handle the same way for the
   * same reason.
   */
  private readonly sessionTokens = new Map<SessionId, SignedCapabilityToken>()
  /**
   * Issuances still writing their durable record, by session.
   *
   * `agent/session-start` is emitted synchronously and does not await its
   * listeners — the Run service records the same constraint — while issuing
   * must persist the token before it can ever be revoked or audited. So the
   * signature is immediate and the RECORD is in flight, and a consumer that
   * needs the token before the record settles awaits {@link whenSessionToken}
   * rather than racing {@link sessionToken}. Without this a tool call landing
   * between session start and the durable write would be refused for holding
   * no token, which is the false refusal §12.70 warns against.
   */
  private readonly issuing = new Map<SessionId, Promise<SignedCapabilityToken>>()
  /**
   * Live sessions, by id, kept as the registry SCOPE KEY for issuance.
   *
   * A token's resources are the registry view as of the read, and that view
   * keeps changing after a session starts, so issuance is neither done in the
   * `agent/session-start` listener nor done only once. It runs on demand from
   * {@link whenSessionToken} and repeats whenever the visible tools have grown
   * past the held token — see {@link needsIssue} for the shipped registrations
   * that arrive late.
   */
  private readonly sessions = new Map<SessionId, Agent>()
  /**
   * Every root digest this mount issued for a session, oldest first.
   *
   * Re-issue on tool growth mints a SECOND root, not a descendant: `issueToken`
   * fixes `parentDigest` to `null` with no parameter to request otherwise, and
   * a wider grant cannot be produced by `attenuate` at all, whose decision is a
   * subset check. So the two roots share no lineage, and revoking the newest
   * would leave a child derived from an earlier one running — acceptance[1]'s
   * "revoking an ancestor invalidates every descendant" silently failing for
   * exactly the sessions that grew. Revocation is therefore per SESSION here:
   * {@link revokeSession} revokes every root recorded for it, so each
   * generation's descendants die with it.
   */
  private readonly sessionRoots = new Map<SessionId, CapabilityTokenDigest[]>()
  /**
   * Why a session holds no token, when issuance was attempted and failed.
   *
   * Read by the presenter so the refusal names the cause instead of reading as
   * "nobody attached one" — see {@link Config.requireForTools} and this
   * package's README. Cleared on a later successful issuance, so a session that
   * recovers does not keep reporting a stale failure.
   */
  private readonly issuanceErrors = new Map<SessionId, string>()
  /**
   * Delegations this mount derived, by CHILD session.
   *
   * Kept so a child that later sees a newly registered tool re-derives against
   * its parent's CURRENT token under the SAME filter, rather than being granted
   * a root of its own. The filter is the parent's declared restriction and
   * never widens: growth can only add names the parent itself now holds and the
   * filter still admits.
   */
  private readonly delegations = new Map<SessionId, { parent: SessionId; filter: ChildResourceFilter | undefined }>()
  private restored: CapabilityTokenService | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.capabilityTokens`.
   * @param config - validated configuration naming the directory and whether tools are gated.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'capabilityTokens')
  }

  /**
   * Restore the store, arm the tool requirement, and start tracking sessions
   * for issuance.
   *
   * In `Service.init` rather than the constructor for the reason the lease
   * store records: restoring from disk is what fails on a real deployment, and
   * a constructor that throws unwinds the tree into `cannot create effect on
   * inactive context`, a message naming neither the path nor the store.
   * @yields the teardown that disarms the requirement and drops the tokens.
   */
  async* [Service.init](): AsyncGenerator<() => void, void, void> {
    const trustKernel = this.ctx.get('trustKernel')
    if (trustKernel === undefined) {
      throw new Error('capability-token-file requires a mounted Trust Kernel to sign tokens')
    }
    this.restored = await CapabilityTokenService.restore(
      openFileCapabilityTokenStore(this.config.directory),
      trustKernel.signatureRoots,
    )

    const disposers: (() => void)[] = []
    // must[3]: arming is what makes the requirement real. `requireCapabilityToken`
    // registered by nobody is the shape the withdrawal was about.
    if (this.config.requireForTools) disposers.push(this.ctx.tools.requireCapabilityToken())
    // must[1]: a session gets its root token, so every tool call inside it has
    // one to present without any caller minting authority. Recorded at start;
    // minted on first demand, for the registry-settling reason on `pending`.
    disposers.push(this.ctx.on('agent/session-start', ({ agent }) => {
      this.sessions.set(agent.id, agent)
    }))
    disposers.push(this.ctx.on('agent/disposed', ({ agent }) => {
      this.sessionTokens.delete(agent.id)
      this.issuing.delete(agent.id)
      this.sessions.delete(agent.id)
      this.sessionRoots.delete(agent.id)
      this.issuanceErrors.delete(agent.id)
      this.delegations.delete(agent.id)
    }))

    yield () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      this.sessionTokens.clear()
      this.sessions.clear()
      this.sessionRoots.clear()
      this.issuanceErrors.clear()
      this.delegations.clear()
      this.restored = undefined
    }
  }

  /**
   * The token issued for one session, when this mount issued one.
   * @param session - the session whose root token is wanted.
   * @returns the session's root token, or `undefined` before it was issued.
   */
  sessionToken(session: SessionId): SignedCapabilityToken | undefined {
    return this.sessionTokens.get(session)
  }

  /**
   * The token issued for one session, waiting for its durable record if the
   * issuance is still in flight.
   *
   * This is what a consumer presenting a token should call. `sessionToken` is
   * the synchronous read for a caller that already knows issuance settled.
   * @param session - the session whose root token is wanted.
   * @returns the session's root token, or `undefined` when none was issued.
   */
  async whenSessionToken(session: SessionId): Promise<SignedCapabilityToken | undefined> {
    const agent = this.sessions.get(session)
    const redelegated = agent === undefined ? undefined : this.redelegateIfGrown(agent)
    if (redelegated !== undefined) {
      this.issuing.set(session, redelegated)
      void redelegated.catch(() => undefined)
    } else if (agent !== undefined && !this.delegations.has(session) && this.needsIssue(agent)) {
      const issue = this.issueSessionToken(agent, agent.identity?.principal.id, agent.identity?.principal.tenantId)
      this.issuing.set(session, issue)
      // The rejection is contained here: a session whose token could not be
      // recorded holds none, and every tool call in it is then refused by the
      // armed requirement — the fail-closed direction. Leaving it unhandled
      // would take the process down instead.
      void issue.catch((error: unknown) => {
        this.issuanceErrors.set(session, error instanceof Error ? error.message : String(error))
        this.ctx.logger.error('capability-token-file: session %s got no token: %s', session, String(error))
      })
    }
    const pending = this.issuing.get(session)
    if (pending !== undefined) {
      // A failed issuance is not an exception to the caller: it means the
      // session holds no token, and the armed requirement refuses its calls.
      await pending.catch(() => undefined)
    }
    return this.sessionTokens.get(session)
  }

  /**
   * Whether this session needs a token minted — it has none, or the tools
   * visible to it have grown past what its token authorizes.
   *
   * Re-issue on growth is required, not defensive: `dsh-tool-subagent` — mounted
   * TWICE in `bundle/base` — registers its tool from a `subagent/provider-added`
   * listener (`src/index.ts:573`), logging "will register when it appears", and
   * re-registers after an HMR provider swap. It also installs per-agent scopes
   * from `agent/created` (`src/index.ts:691`). Any of those can land after the
   * session's first tool call, and a token minted before it would refuse that
   * tool for the rest of the session — a permanent denial of a legitimate tool,
   * which is the withdrawal's failure inverted.
   *
   * Growth only: this never narrows a token, because a tool disappearing is not
   * a revocation and re-minting on removal would cost a signature per HMR swap.
   * Narrowing authority is delegation's job, and a delegated child derives from
   * this root by subset — so widening the ROOT to what the session can actually
   * see does not widen any child.
   * @param agent - the session, which is also the registry scope key.
   * @returns whether {@link issueSessionToken} must run.
   */
  private needsIssue(agent: Agent): boolean {
    // An issuance already in flight will settle on the CURRENT registry, so a
    // concurrent caller waits for it rather than signing a second token.
    if (this.issuing.get(agent.id) !== undefined && this.sessionTokens.get(agent.id) === undefined) return false
    const token = this.sessionTokens.get(agent.id)
    if (token === undefined) return true
    const authorized = new Set(token.token.resources)
    return this.ctx.tools.schemas(agent).some(schema => !authorized.has(schema.name))
  }

  /**
   * Re-derive a delegated child whose visible tools have grown past its token,
   * bounded by what its parent NOW holds and by the parent's original filter.
   *
   * Growth is why this exists: a tool registered into the child's scope after
   * its token was minted would otherwise be refused for the rest of the
   * session. It can never widen past the parent — the filter is re-applied to
   * the parent's current resources, and `attenuate` is a subset check besides.
   * @param agent - the child session, which is also the registry scope key.
   * @returns the re-derivation when one was needed, `undefined` otherwise.
   */
  private redelegateIfGrown(agent: Agent): Promise<SignedCapabilityToken> | undefined {
    const delegation = this.delegations.get(agent.id)
    if (delegation === undefined) return undefined
    const held = this.sessionTokens.get(agent.id)
    if (held === undefined) return undefined
    const parent = this.sessionTokens.get(delegation.parent)
    if (parent === undefined) return undefined
    const authorized = new Set(held.token.resources)
    const visible = this.ctx.tools.schemas(agent).map(schema => schema.name)
    if (!visible.some(name => !authorized.has(name))) return undefined

    // Names the child can see that its parent's ROOT does not carry. They are
    // there because the COMPOSITION put them there — `attachStructuredRuntime`
    // registers `structured_output` into the child's scope, and Ralph's rounds
    // require a structured-output provider — not because the child asked for
    // them. Measured: without this the child is refused `structured_output`
    // with `tool-not-in-scope` and Ralph loses its second round.
    //
    // So the ROOT grows to cover them, and this is not an escalation of the
    // parent: the token bounds AUTHORITY while the registry scope bounds
    // VISIBILITY, and both must hold at dispatch. A name the parent's scope
    // cannot see is a name the parent still cannot call. Growing the root is
    // what lets the child's own filter remain the only narrowing that decides.
    const parentResources = new Set(parent.token.resources)
    const composedForChild = visible.filter(name => !parentResources.has(name))
    const parentAgent = this.sessions.get(delegation.parent)
    const grown = async (): Promise<SignedCapabilityToken> => {
      if (composedForChild.length > 0 && parentAgent !== undefined) {
        await this.issueSessionToken(
          parentAgent,
          parentAgent.identity?.principal.id,
          parentAgent.identity?.principal.tenantId,
          composedForChild,
        )
      }
      return this.deriveFromParent(delegation.parent, agent.id, delegation.filter)
    }
    return grown()
  }

  /**
   * Revoke a session's authority: every root this mount issued for it, and so
   * every token delegated from any of them.
   *
   * Per session rather than per digest because tool growth mints unrelated
   * roots (see {@link sessionRoots}); revoking only the newest would leave
   * children of an earlier one running. A caller holding one digest cannot
   * know how many generations a session accumulated, so it must not be the one
   * to iterate them.
   *
   * No production caller revokes yet — `CapabilityTokenService.revoke` has none
   * anywhere in this repository — so this closes the gap that re-issue opens
   * rather than serving a live revoker. P2-02 must not claim revocation is
   * reached on a launched profile on the strength of this method existing.
   * @param session - the session whose authority is withdrawn.
   */
  isRevoked(token: SignedCapabilityToken): boolean {
    return this.service.isRevoked(digestToken(token.token))
  }

  async revokeSession(session: SessionId): Promise<'revoked' | 'nothing-to-revoke'> {
    // Asked of the DURABLE record, not of `sessionRoots`. That map is dropped
    // for a session at `agent/disposed` and cleared wholesale when the plugin
    // unloads, so revoking a session that has already ended — which for a
    // detached run is the normal case, not an edge — used to iterate an empty
    // list and report success having revoked nothing.
    const digests = this.service.digestsIssuedFor(session)
    for (const digest of digests) await this.service.revoke(digest)
    this.sessionTokens.delete(session)
    this.sessionRoots.delete(session)
    // Reported rather than swallowed: "nothing was recorded for this session"
    // and "this session's authority is now withdrawn" are different answers,
    // and an operator acting on a revocation needs to know which one they got.
    return digests.length === 0 ? 'nothing-to-revoke' : 'revoked'
  }

  /**
   * Derive a child's token from its parent's under the parent's filter
   * (acceptance[0]).
   *
   * Started here and awaited by the child's first {@link whenSessionToken}, so
   * the child-composition path that KNOWS the filter can stay synchronous. The
   * child is recorded as delegated BEFORE the derivation settles, so the
   * session-start listener cannot race it and mint a root instead.
   * @param parentSession - the delegating parent's session.
   * @param childSession - the child session receiving the derived token.
   * @param filter - the parent's declared restriction, or `undefined` for none.
   */
  deriveChild(parentSession: SessionId, childSession: SessionId, filter?: ChildResourceFilter): void {
    this.delegations.set(childSession, { parent: parentSession, filter })
    const derivation = this.deriveFromParent(parentSession, childSession, filter)
    this.issuing.set(childSession, derivation)
    void derivation.catch((error: unknown) => {
      this.issuanceErrors.set(childSession, error instanceof Error ? error.message : String(error))
      this.ctx.logger.error('capability-token-file: child %s got no delegated token: %s', childSession, String(error))
    })
  }

  /**
   * Mint one child token by attenuating the parent's current token.
   *
   * The parent's token is resolved through {@link whenSessionToken}, so a
   * parent whose own issuance has not settled is waited for rather than treated
   * as having no authority. `service.attenuate` makes the decision AND records
   * the child — required, because `lineageOf` walks recorded `parentDigest`
   * hops and an unrecorded child is invisible to `isRevoked`, which is the
   * whole of acceptance[1].
   * @param parentSession - the delegating parent's session.
   * @param childSession - the child session receiving the derived token.
   * @param filter - the parent's declared restriction, or `undefined` for none.
   * @returns the derived child token.
   * @throws when the parent holds no token, or the requested authority would widen it.
   */
  private async deriveFromParent(
    parentSession: SessionId,
    childSession: SessionId,
    filter: ChildResourceFilter | undefined,
  ): Promise<SignedCapabilityToken> {
    const parent = await this.whenSessionToken(parentSession)
    if (parent === undefined) {
      throw new Error(`capability-token-file: parent session ${String(parentSession)} holds no token to delegate from`)
    }
    const decision = await this.service.attenuate(parent, {
      subject: brandString<PrincipalId>(childSession),
      verbs: [...parent.token.verbs],
      resources: delegatedChildResources(parent.token.resources, filter),
      // The CHILD's own session, never the parent's: revocation reaches a
      // child through `parentDigest` lineage, so this member answers "whose
      // session is this token" rather than carrying a shared value down.
      constraints: { issuedFor: childSession },
      expiresAt: parent.token.expiresAt,
      nonce: brandString<CapabilityTokenNonce>(randomBytes(16).toString('hex')),
    })
    // Surfaced, never softened to a root: a refused delegation that fell back to
    // issuing would hand the child MORE authority than it was just denied.
    if (!decision.accepted) throw new DelegatedCapabilityError(decision.reason)
    this.sessionTokens.set(childSession, decision.child)
    this.issuanceErrors.delete(childSession)
    const derived = this.sessionRoots.get(childSession) ?? []
    derived.push(digestToken(decision.child.token))
    this.sessionRoots.set(childSession, derived)
    return decision.child
  }

  /**
   * Why this session holds no token, when issuance ran and failed.
   * @param session - the session whose issuance failure is wanted.
   * @returns the failure message, or `undefined` when issuance did not fail.
   */
  issuanceError(session: SessionId): string | undefined {
    return this.issuanceErrors.get(session)
  }

  /**
   * The restored service, for a consumer that needs verification or delegation.
   * @returns the service this mount restored.
   * @throws when read before the mount finished, which `inject` prevents.
   */
  get service(): CapabilityTokenService {
    if (this.restored === undefined) throw new Error('capability-token-file used before its mount restored the store')
    return this.restored
  }

  /**
   * Mint one session's root token (must[1]).
   *
   * The subject is the session's own principal when an identity service
   * attached one, and the session id otherwise — a local run still gets a
   * token rather than being exempt, because an exemption is indistinguishable
   * from the gap this epic closed.
   * The resources are the registry's view AS THIS AGENT SEES IT, not the
   * unscoped view: a tool contributed into one agent's scope is absent from
   * the global registration map, so an unscoped read issues a token that omits
   * it and then refuses every call to it — a denial indistinguishable from the
   * gate working. `dsh-subagent-dsh-sdk` registers its `subagent` tool exactly
   * that way.
   * @param agent - the session being started; also the registry scope key.
   * @param principal - the session principal, when identity attached one.
   * @param tenant - the principal's tenant, when identity attached one.
   */
  private async issueSessionToken(
    agent: Agent,
    principal?: PrincipalId,
    tenant?: TenantId,
    extraResources: readonly string[] = [],
  ): Promise<SignedCapabilityToken> {
    const session = agent.id
    const nonceOf = (): CapabilityTokenNonce => brandString<CapabilityTokenNonce>(randomBytes(16).toString('hex'))
    // NOT wired: a child session gets its own root here, NOT a token derived
    // from its parent — so `requireForTools` does not yet enforce anything
    // about delegation. Deriving was implemented and MEASURED to break
    // `ralph-loop` (2 persisted sessions where 3 are expected): a child's scope
    // legitimately holds registrations the parent's scope never had —
    // `dsh-tool-subagent` installs per-agent scopes from `agent/created` — while
    // `resources` is an exact set and attenuation is subset-only, so a child
    // that rightfully sees a tool outside its parent's set has NO representable
    // token and every call to that tool returns `tool-not-in-scope`. Resolving
    // that needs a decision about what a delegated child's resources mean when
    // scoping, not the parent, decides what it can see; it is recorded as a
    // readiness entry rather than closed here.
    const nonce = nonceOf()
    const token = await this.service.issue({
      subject: principal ?? brandString<PrincipalId>(session),
      tenant: tenant ?? brandString<TenantId>('local'),
      capability: brandString<CapabilityName>('tool'),
      verbs: SESSION_ROOT_VERBS,
      resources: [...new Set([
        ...this.ctx.tools.schemas(agent).map(schema => schema.name),
        ...this.sessionTokens.get(session)?.token.resources ?? [],
        ...extraResources,
      ])],
      // The session this root belongs to, recorded because `subject` cannot
      // answer it: `subject` is the PRINCIPAL, and one principal holds many
      // sessions. Revoking everything a session authorized has to find its
      // roots in durable data, since a detached run outlives its launcher and
      // the in-memory index is gone exactly when the question is asked.
      constraints: { issuedFor: session },
      expiresAt: Date.now() + this.config.sessionTokenTtlMs,
    }, nonce)
    this.sessionTokens.set(session, token)
    this.issuanceErrors.delete(session)
    const roots = this.sessionRoots.get(session) ?? []
    roots.push(digestToken(token.token))
    this.sessionRoots.set(session, roots)
    return token
  }
}
