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
import type {
  CapabilityName,
  CapabilityTokenNonce,
  PrincipalId,
  SignedCapabilityToken,
  TenantId,
} from '@deepseek-ai/dsh-capability-token'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: make `ctx.tools` and the `agent/*` events resolve through
// declaration merging when this plugin is composed beside them.
import { TOOL_CAPABILITY_VERB } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import { openFileCapabilityTokenStore } from './store.ts'

export { openFileCapabilityTokenStore } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    capabilityTokens: CapabilityTokenFilePlugin
  }
}

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
export default class CapabilityTokenFilePlugin extends Service {
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
  private restored: CapabilityTokenService | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.capabilityTokens`.
   * @param config - validated configuration naming the directory and whether tools are gated.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'capabilityTokens')
  }

  /**
   * Restore the store, arm the tool requirement, and begin issuing.
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
    // must[1]: a session gets its root token at start, so every tool call
    // inside it has one to present without any caller minting authority.
    disposers.push(this.ctx.on('agent/session-start', ({ agent }) => {
      const pending = this.issueSessionToken(agent.id, agent.identity?.principal.id, agent.identity?.principal.tenantId)
      this.issuing.set(agent.id, pending)
      // The rejection is contained here: a session whose token could not be
      // recorded holds none, and every tool call in it is then refused by the
      // armed requirement — which is the fail-closed direction. Leaving it
      // unhandled would take the process down instead.
      void pending.catch((error: unknown) => {
        this.ctx.logger.error('capability-token-file: session %s got no token: %s', agent.id, String(error))
      })
    }))
    disposers.push(this.ctx.on('agent/disposed', ({ agent }) => {
      this.sessionTokens.delete(agent.id)
      this.issuing.delete(agent.id)
    }))

    yield () => {
      for (const dispose of disposers.splice(0).reverse()) dispose()
      this.sessionTokens.clear()
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
    const pending = this.issuing.get(session)
    if (pending !== undefined) {
      // A failed issuance is not an exception to the caller: it means the
      // session holds no token, and the armed requirement refuses its calls.
      await pending.catch(() => undefined)
    }
    return this.sessionTokens.get(session)
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
   * @param session - the session being started.
   * @param principal - the session principal, when identity attached one.
   * @param tenant - the principal's tenant, when identity attached one.
   */
  private async issueSessionToken(session: SessionId, principal?: PrincipalId, tenant?: TenantId): Promise<SignedCapabilityToken> {
    const nonce = brandString<CapabilityTokenNonce>(randomBytes(16).toString('hex'))
    const token = await this.service.issue({
      subject: principal ?? brandString<PrincipalId>(session),
      tenant: tenant ?? brandString<TenantId>('local'),
      capability: brandString<CapabilityName>('tool'),
      verbs: SESSION_ROOT_VERBS,
      resources: this.ctx.tools.schemas().map(schema => schema.name),
      constraints: {},
      expiresAt: Date.now() + this.config.sessionTokenTtlMs,
    }, nonce)
    this.sessionTokens.set(session, token)
    return token
  }
}
