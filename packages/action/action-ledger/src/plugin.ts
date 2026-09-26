/**
 * The Cordis plugin that publishes the idempotency ledger as a service
 * (Epic P4-12 must[4]).
 *
 * Without it the ledger is a library with no caller: the store, the CAS
 * reservation and the five states all existed with, measured, zero production
 * callers, so "an external effect is reserved before it is sent" held over a
 * ledger nothing reserved against.
 *
 * @module @deepseek-ai/dsh-action-ledger/plugin
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import z from '@deepseek-ai/schemastery'
import { openLedgerStore } from './store.ts'
import type { LedgerStore } from './store.ts'
import type { LedgerEntry, LedgerGeneration, LedgerResolution, LedgerScope, ReceiptDigest, ReserveDecision, ReserveRequest } from './types.ts'

// `/resolve-effect` reads the command registry, the approval service and the
// invoking agent through the views below, declared here rather than imported:
// `@deepseek-ai/dsh-commands` and `@deepseek-ai/dsh-user-approval` reach this
// package through the agent, LLM and retry packages, so importing their types
// back would be a dependency cycle (`@deepseek-ai/dsh-memory` declares its
// proposal-policy view for the same reason).

/** The agent a command runs for, as far as `/resolve-effect` reads it. */
interface ResolvingAgent {
  /** The identity the agent acts as; only a host user may resolve. */
  readonly identity?: { readonly principal: { readonly kind: string; readonly id: PrincipalId } }
}

/** One `/resolve-effect` invocation, as the command registry passes it. */
interface ResolveInvocation {
  /** The agent whose command surface received the command. */
  readonly agent: ResolvingAgent
  /** The text after the command name. */
  readonly rawInput: string
  /** Cancellation of the dispatching request. */
  readonly signal: AbortSignal
}

/** The command's result, as the command registry renders it. */
type ResolveResult = { readonly kind: 'success' | 'error'; readonly text: string }

/** The command registry, as far as this plugin registers with it. */
interface CommandRegistryPort {
  /**
   * Register one command for the registering context's lifetime.
   * @param definition - the command's name, description, input hint and handler.
   * @returns the disposer that removes it.
   */
  register(definition: {
    readonly name: string
    readonly description: string
    readonly input: { readonly hint: string }
    readonly handler: (invocation: ResolveInvocation) => Promise<ResolveResult>
  }): () => void
}

/** The approval service, as far as `/resolve-effect` asks it. */
interface ApprovalPort {
  /**
   * Ask the host user through the composed answerers.
   * @param request - the asking agent, what is decided, why, and the cancellation signal.
   * @returns the outcome; `'allowed-once'` is the only grant.
   */
  request(request: {
    readonly agent: ResolvingAgent
    readonly toolName: string
    readonly subject: string
    readonly reason: string
    readonly signal: AbortSignal
  }): Promise<string>
}

/**
 * The receipt digest of an entry the host user resolved as `confirmed`: with
 * no provider receipt, the resolution is the evidence the effect committed.
 * @param resolution - the host user's resolution.
 * @returns the digest of its JSON text.
 */
function receiptOf(resolution: LedgerResolution): ReceiptDigest {
  return createHash('sha256').update(JSON.stringify(resolution)).digest('hex') as ReceiptDigest
}

/** Where this mount keeps its ledger. */
export interface Config {
  /**
   * Directory holding `action-ledger.sqlite`.
   *
   * Deployment-varying, and the choice is the same one the lease store makes:
   * two hosts that must not both perform one external effect have to be
   * pointed at the same ledger, and only the profile knows whether they are
   * two hosts or two unrelated projects.
   */
  directory: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    actionLedger: ActionLedgerPlugin
  }
}

/**
 * The mounted ledger, published as `ctx.actionLedger`.
 *
 * Forwards {@link LedgerStore} rather than exposing the opened store, so a
 * consumer reaches only the operations the contract names and cannot reach
 * past them into this provider's own surface.
 */
export default class ActionLedgerPlugin extends Service {
  /** Runtime configuration schema, validated at mount from the profile's `cordis.yml` row. */
  static Config = z.object({
    directory: z.string().required(),
  }) as z<Config>

  private opened: LedgerStore | undefined

  /**
   * @param ctx - the mounting context; the plugin registers itself as `ctx.actionLedger`.
   * @param config - the validated configuration, naming the directory the ledger lives in.
   */
  constructor(ctx: Context, public readonly config: Config) {
    super(ctx, 'actionLedger')
    // The host user's reconciliation path (P4-12 acceptance[1], BLOCKED-311),
    // registered where a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      const commands = commandCtx.get('commands') as CommandRegistryPort
      commands.register({
        name: 'resolve-effect',
        description: 'Resolve an external effect whose outcome is unknown',
        input: { hint: '[<idempotencyKey> <confirmed|compensated>]' },
        handler: invocation => this.resolveEffect(commandCtx, invocation),
      })
    })
  }

  /**
   * `/resolve-effect`: the host user settles one of their own `ambiguous`
   * entries as `confirmed` or `compensated` (P4-12 acceptance[1], BLOCKED-311).
   * Without arguments it lists the entries waiting. The host user is asked
   * through the approval surface, and anything but an approval changes
   * nothing. The entry never returns to `prepared`: doing the work again is a
   * new action with a new key.
   * @param ctx - the command's context, for the approval service.
   * @param invocation - the invoking agent, the text after the command name, and the cancellation signal.
   * @returns what happened, for the dispatching surface.
   */
  private async resolveEffect(ctx: Context, { agent, rawInput, signal }: ResolveInvocation): Promise<ResolveResult> {
    const principal = agent.identity?.principal
    // A host user is a `user` principal, as `@deepseek-ai/dsh-workspace-trust`'s
    // `isHostUserPrincipal` defines one; a service or agent principal cannot resolve.
    if (principal?.kind !== 'user') return { kind: 'error', text: 'Only the host user can resolve an external effect.' }
    const [key, outcome, ...rest] = rawInput.trim().split(/\s+/u).filter(part => part !== '')
    if (key === undefined) {
      const waiting = this.store.listAmbiguous(principal.id).map(entry => entry.key)
      return {
        kind: 'success',
        text: waiting.length === 0 ? 'No external effect is waiting for reconciliation.' : `Waiting for reconciliation: ${waiting.join(', ')}.`,
      }
    }
    if ((outcome !== 'confirmed' && outcome !== 'compensated') || rest.length > 0) {
      return { kind: 'error', text: 'Usage: /resolve-effect <idempotencyKey> <confirmed|compensated>' }
    }
    const entry = this.store.entry(principal.id, key)
    if (entry?.state !== 'ambiguous') {
      return {
        kind: 'error',
        text: entry === undefined ? `No external effect is recorded under ${key}.` : `${key} is ${entry.state}, not ambiguous, so there is nothing to resolve.`,
      }
    }
    const approval = ctx.get('approval') as ApprovalPort | undefined
    if (approval === undefined) return { kind: 'error', text: `No approval surface is mounted to ask the host user, so ${key} stays ambiguous.` }
    const answer = await approval.request({
      agent,
      toolName: 'resolve-effect',
      subject: `${key}: ${outcome}`,
      reason: `The outcome of this external effect is unknown. Record it as ${outcome}? It is not sent again either way.`,
      signal,
    })
    if (answer !== 'allowed-once') return { kind: 'error', text: `The host user did not approve, so ${key} stays ambiguous.` }
    const resolution: LedgerResolution = { outcome, resolvedBy: principal.id, resolvedAt: Date.now() }
    if (outcome === 'confirmed') this.store.confirm(principal.id, key, entry.epoch, receiptOf(resolution), resolution)
    else this.store.markCompensated(principal.id, key, entry.epoch, resolution)
    return { kind: 'success', text: `${key} is resolved as ${outcome}.` }
  }

  /**
   * Open the database at mount.
   *
   * In `Service.init` rather than the constructor for the reason
   * `dsh-lease-sqlite` records: creating the directory and opening SQLite are
   * the steps that fail on a real deployment, and a constructor that throws
   * during service construction unwinds the tree into a message naming neither
   * the path nor the database.
   * @yields the teardown that releases the store handle.
   */
  * [Service.init](): Generator<() => void, void, void> {
    this.opened = openLedgerStore(this.config.directory)
    yield () => { this.opened = undefined }
  }

  /**
   * The opened store.
   * @returns the store this mount opened.
   *
   * **The reachable failure is at teardown, not at startup.** A consumer cannot
   * read this before the mount finishes — `inject` holds it until the service is
   * available — but the teardown yielded by `Service.init` clears the handle
   * SYNCHRONOUSLY, and a fiber unload runs every disposer concurrently. So a
   * consumer whose own disposer awaits anything before calling in finds the
   * handle already gone. Measured in `@deepseek-ai/dsh-lease-sqlite`, whose
   * identical wording sent a reader looking at startup for a shutdown fault
   * (BLOCKED-197).
   * @throws when the handle is absent: almost always because this mount has
   * already been unloaded, and only in principle because it has not yet opened.
   */
  private get store(): LedgerStore {
    if (this.opened === undefined) {
      throw new Error('ActionLedgerPlugin has no open database: this mount was already unloaded, or has not opened yet')
    }
    return this.opened
  }

  /**
   * Take responsibility for one external effect before it is sent.
   * @param request - the scope, key, arguments hash and epoch to reserve under.
   * @returns whether the caller may send, or why not.
   */
  reserve(request: ReserveRequest): ReserveDecision {
    return this.store.reserve(request)
  }

  /**
   * Record that the request left the harness.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation, or `'unfenced'` when its holder had none.
   */
  markSent(scope: LedgerScope, key: string, epoch: LedgerGeneration): void {
    this.store.markSent(scope, key, epoch)
  }

  /**
   * Record the provider's receipt, the evidence the effect committed.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation, or `'unfenced'` when its holder had none.
   * @param receiptDigest - the digest of what the provider returned.
   */
  confirm(scope: LedgerScope, key: string, epoch: LedgerGeneration, receiptDigest: ReceiptDigest): void {
    this.store.confirm(scope, key, epoch, receiptDigest)
  }

  /**
   * Record that retrying cannot determine the outcome.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @param epoch - the generation that holds the reservation, or `'unfenced'` when its holder had none.
   */
  markAmbiguous(scope: LedgerScope, key: string, epoch: LedgerGeneration): void {
    this.store.markAmbiguous(scope, key, epoch)
  }

  /**
   * The entry for one scoped key.
   * @param scope - the reservation's owning principal.
   * @param key - the idempotency key.
   * @returns the entry, or `undefined` when it was never reserved.
   */
  entry(scope: LedgerScope, key: string): LedgerEntry | undefined {
    return this.store.entry(scope, key)
  }
}
