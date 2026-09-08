/**
 * Service Definition for the subagent capability seam (`ctx.subagents`): a named-provider registry plus a
 * capability-validating asynchronous start API. Providers establish a
 * child before returning its run, so fulfillment is the single publication and
 * ownership-transfer boundary.
 *
 * Multiple providers coexist: each registers under a unique name and callers
 * select one by name.
 *
 * This package owns the Service Definition role of the capability seam. Service Providers
 * (`@deepseek-ai/dsh-subagent-spawn-in-process`, `-fork`, `-acp`) and the model-facing
 * consumer (`@deepseek-ai/dsh-tool-subagent`) are separate packages.
 *
 * Public operations express caller intent: `start` returns one published owned
 * one-shot run, `startContinuable` establishes a durable continuable child, and
 * `sendMessage` steers between adjacent Agents without exposing whether a child
 * is resident. Continuable children never become a {@link SubagentRun}: the
 * continuation manager holds their `AgentHandle` directly and orders every turn
 * through the child's own inbox, so providers contribute only the detached
 * creation spec and see no handle, turn, or teardown. Child and descendant
 * discovery read the live session store and optional session persistence
 * directly and do not require that continuation runtime.
 *
 * Same-process providers are trusted typed collaborators. Requests, provider
 * descriptors, results, and lifecycle payloads are borrowed immutable values;
 * serialization and hostile-input validation belong at real process, worker,
 * persistence, and model boundaries.
 *
 * @module @deepseek-ai/dsh-subagent
 */

import { Context } from '@deepseek-ai/cordis'
import { admitPromptContent } from '@deepseek-ai/dsh-attachment'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, MessageId, MessageSource } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { openControlLedger } from './control-ledger.ts'
import { ChildControlRouter } from './control-router.ts'
import {
  catalogView, rejectCatalogRead, rejectPrompt, validateControlRequest,
} from './control.ts'
import type {
  SubagentCatalog,
  SubagentInterruptReceipt,
  SubagentPromptReceipt,
  SubagentPromptRequest,
  SubagentPromptRequestId,
} from './control-types.ts'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
  SubagentRunEndInfo,
  SubagentRunInfo,
  SubagentStartRequest,
} from './types.ts'
import { SubagentError } from './error.ts'
import { assertSubagentMaxDepth } from './depth.ts'
import { createActivationObserver, createLifecycleEmitter, observeRun } from './lifecycle.ts'
import type { ActivationObserver, LifecycleEmitter } from './lifecycle.ts'
import SubagentContinuationManager from './continuation.ts'
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentInterruptAuthority,
  SubagentSendMessageOptions,
} from './continuation.ts'
import { listChildren as listSubagentChildren, listDescendants as listSubagentDescendants } from './list-children.ts'
import type { SubagentDescendantListEntry, SubagentListEntry } from './list-children.ts'
import { snapshotSubagentDescriptor } from './descriptor.ts'
import { subagentIdentityProjectionDefinition, subagentTimingProjectionDefinition } from './projection.ts'
import { queueSubagentPrompt } from './internal.ts'

export * from './out-of-process.ts'
export { AssistantOutputFold, finalAssistantOutput } from './assistant-output.ts'
export { SubagentRunId } from './types.ts'
export type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
  SubagentStopReason,
  SubagentStopReasonMap,
} from './types.ts'
export {
  foldSubagentDescriptor,
  snapshotSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
} from './descriptor.ts'
export type {
  ContinuableSubagentDescriptorData,
  ContinuableSubagentDescriptorInput,
  OneShotSubagentDescriptorData,
  OneShotSubagentDescriptorInput,
  SubagentDescriptorData,
  SubagentDescriptorInput,
} from './descriptor.ts'
export { seedDescriptorTurn } from './descriptor-seed.ts'
export { SubagentError } from './error.ts'
export { settleRun } from './run-settlement.ts'
export { assertSubagentMaxDepth, delegationDepthOf } from './depth.ts'
export {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  parentAgentOptionsForDelegation,
  resolveChildAgentOptions,
  resolveChildDepth,
  SubagentDepthError,
} from './child-agent.ts'
export type { ChildComposition, DelegatedPolicyOverrides } from './child-agent.ts'
export type {
  AgentMessageSource,
  ContinuableStart,
  ContinuableStartSpec,
  SubagentInterruptAuthority,
  SubagentSendMessageOptions,
  SubagentSettledMessageSource,
} from './continuation.ts'
export type * from './control-types.ts'
export type { SubagentDescendantListEntry } from './list-children.ts'
export type { SubagentRunEndInfo, SubagentRunInfo } from './types.ts'
export type { SubagentIdentityProjection, SubagentTimingProjection } from './projection-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagents: SubagentRuntime
  }

  interface Events {
    /**
     * A provider became resolvable in the registry.
     * @param provider - the registered provider.
     * @mode emit
     */
    'subagent/provider-added'(provider: SubagentProvider): void
    /**
     * A provider left the registry. Accepted runs remain holder-owned.
     * @param name - the provider name that no longer resolves.
     * @mode emit
     */
    'subagent/provider-removed'(name: string): void
    /**
     * A provider established a published child. For in-process providers,
     * `ctx.agents.get(info.id)` resolves during this notification.
     * Scope-filtered dispatch keys the carrier by the delegating parent, so a
     * parent-scoped listener observes only its own delegations. Paired with
     * `subagent/end`.
     * @param info - the provider and published child identity.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
    /**
     * A published child settled. Scope-filtered dispatch uses the same delegating
     * parent carrier as `subagent/start`, so the lifecycle pair reaches the
     * same scoped audience.
     * @param info - the run identity and terminal outcome.
     * @dshScopeScan unsupported
     * @mode emit
     */
    'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
  }
}

/**
 * Durable attribution of one browser-authored follow-up. The Session
 * Controller declares this `user-rpc` message source and depends on this
 * package, so the fields are spelled here: `MessageSource`'s `user` member
 * accepts the record and the correlation id rides the durable message the
 * Client reconciles its optimistic prompt against.
 */
interface BrowserPromptSource {
  readonly kind: 'user'
  readonly rpcId: SubagentPromptRequestId
  readonly clientTimeZone?: string
}

/**
 * A stable number for one prompt request id (Epic P5-10 acceptance[2]).
 *
 * The id is an opaque branded string while the idempotency ledger is numeric,
 * so this hashes rather than parses: two deliveries of one request must
 * collide, and two distinct requests must not. FNV-1a over the id's characters,
 * which is enough for a per-child set holding one session's requests.
 * @param requestId - the browser's own request id.
 * @returns a stable non-negative integer for that id.
 */
function promptEpoch(requestId: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < requestId.length; index++) {
    hash ^= requestId.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

/** Named provider registry with one-shot runs, durable discovery, and continuable-child operations. */
export class SubagentRuntime extends TypertRemoteService {
  private providers = new Map<string, SubagentProvider>()
  /**
   * Per-child control state for Epic P5-10's browser-facing surface: which
   * phase each child is in, and which prompt request ids have already been
   * applied to it.
   *
   * Held here rather than derived per call because both facts are about the
   * SEQUENCE of control messages, which no single request can see. A child
   * that was interrupted looks exactly like an idle one to the next prompt
   * unless something remembers the interrupt happened.
   */
  /**
   * One control router per child (§12.25-2, BLOCKED-153).
   *
   * Replaces a hand-rolled `{ phase, appliedEpochs }` that duplicated what
   * `ChildControlRouter` already owned — one rule with two implementations,
   * and the copy carrying must[1]'s priority ordering was the one nothing
   * reached. The router holds the phase; the ledger it decides against is the
   * manager's and outlives the child.
   */
  private readonly routers = new Map<SessionId, ChildControlRouter>()
  private continuations: SubagentContinuationManager | undefined
  /**
   * The contained lifecycle-edge publisher. Built here because scoped dispatch
   * keys its carrier by this exact service instance, whose own context filter
   * composes into the carrier.
   */
  private readonly emitLifecycle: LifecycleEmitter

  constructor(ctx: Context) {
    super(ctx, 'subagents')
    this.emitLifecycle = createLifecycleEmitter(this.ctx, parent => scopeTarget(this, parent))
    ctx.inject(['agents'], (childCtx: Context) => {
      const manager = new SubagentContinuationManager(childCtx, {
        prepareContinuable: (name, request) => this.prepareContinuable(name, request),
        observeActivation: (provider, childId, parent) => this.observeActivation(provider, childId, parent),
      })
      this.continuations = manager
      childCtx.effect(() => () => {
        /* v8 ignore else -- one injected binding owns the slot until its fiber disposes. */
        if (this.continuations === manager) this.continuations = undefined
      }, 'subagents.continuationBinding()')
    })
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(subagentTimingProjectionDefinition)
      projectionCtx.sessionProjections.register(subagentIdentityProjectionDefinition)
    })
  }

  /**
   * Establish one durable continuable child and deliver its initial prompt.
   * Resolves when the child's inbox accepts that prompt, without waiting for the
   * turn to start or for the message to reach the Session log; any earlier
   * failure rejects with no ids and rolls back the child entirely.
   * @param spec - provider, delegation request, and caller cancellation.
   * @returns the durable child id and the accepted prompt's message id.
   * @throws when continuation services are unavailable or materialization fails.
   */
  async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart> {
    return this.requireContinuations().startContinuable(spec)
  }

  /**
   * Steer one model-authored message to the sender's direct parent or direct
   * continuable child. A running target admits it at the nearest step boundary;
   * an idle target starts a turn, and an absent direct child cold-resumes from
   * persistence. The service derives durable sender attribution from the exact
   * live sender. Caller cancellation stops only pre-acceptance work.
   * @param sender - exact live Agent authorizing and originating the message.
   * @param targetId - durable direct-parent or direct-child session id.
   * @param content - model-authored content to deliver.
   * @param options - caller cancellation before inbox acceptance.
   * @returns the accepted message's inbox id.
   * @throws when continuation services are unavailable, adjacency is rejected,
   *   or the message was not admitted.
   */
  async sendMessage(
    sender: Agent,
    targetId: SessionId,
    content: ContentBlock[],
    options: SubagentSendMessageOptions,
  ): Promise<MessageId> {
    return this.requireContinuations().sendMessage(sender, targetId, content, options)
  }

  /**
   * Queue one host-protocol message as a distinct direct-child turn.
   * Symbol-keyed so host adapters can preserve their own provenance without
   * widening the public Service Definition or impersonating an Agent sender.
   * @param parent - exact live direct parent authorizing delivery.
   * @param childId - durable direct-child session id.
   * @param content - host-authored content to deliver.
   * @param source - durable host-protocol provenance.
   * @param signal - caller cancellation before inbox acceptance.
   * @returns the accepted message's inbox id.
   */
  private [queueSubagentPrompt](
    parent: Agent,
    childId: SessionId,
    content: ContentBlock[],
    source: MessageSource,
    signal: AbortSignal,
  ): Promise<MessageId> {
    return this.requireContinuations().queuePrompt(parent, childId, content, source, signal)
  }

  /**
   * Interrupt one live continuable child's current turn under a human parent
   * address or an exact live ancestor Agent. Fire-and-return: the cancel
   * signal is issued before this returns, but the target may keep running
   * until it observes the signal. Unclaimed pending inbox work, the Activation,
   * and published descendants are preserved; claimed work is not requeued.
   * Once the interrupted driver is idle, a waking send resumes the parked FIFO
   * queue. An absent target — including a one-shot or unknown id —
   * is an accepted no-op, as is a manager-less composition, which cannot own a
   * live Activation.
   * @param targetSessionId - the durable child session id to interrupt.
   * @param authority - the human parent address or exact live ancestor Agent.
   * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
   *   live target.
   */
  interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void {
    this.continuations?.interrupt(targetSessionId, authority)
  }

  /**
   * Close continuable admission below exact live parent Agents, stop only their
   * visible descendant Activations synchronously, then await admitted scoped
   * materializations and release those forests child-first. The scoped cutoff
   * lasts until each exact parent leaves the registry; unrelated parent trees
   * remain live.
   * @param parents - exact host-owned parent Agents entering teardown.
   * @returns once every retained descendant Activation released its `AgentHandle`.
   * @throws an aggregate error after all branches settle when any failed.
   */
  async drainContinuableDescendants(parents: readonly Agent[]): Promise<void> {
    const manager = this.continuations
    // Absent continuation services means nothing was ever materialized.
    if (manager === undefined) return
    await manager.drainDescendants(parents)
  }

  /**
   * Release selected resident continuable direct children of one exact live
   * parent. Other children of the same parent remain admitted and resident.
   * Absent targets and a manager-less composition are accepted no-ops.
   * @param parent - exact live direct parent authorizing the selected release.
   * @param childIds - durable direct-child ids to release when resident.
   * @returns once every selected Activation released its `AgentHandle`.
   * @throws {SubagentError} `UNAUTHORIZED` when a resident target belongs to a
   *   different parent or the supplied parent identity is stale.
   */
  async drainContinuableChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void> {
    const manager = this.continuations
    if (manager === undefined) return
    await manager.drainChildren(parent, childIds)
  }

  /**
   * Enumerate the parent's direct session-backed subagents without loading or
   * resuming an Agent. The Session query service supplies one live-preferred
   * corpus and shared point observations; the projection cache supplies
   * immutable descriptor hits without opening cold logs. The registered
   * `subagent` projection remains the sole mode/label classifier.
   *
   * Every query receives `signal`, and the listing rechecks cancellation
   * around each await. Read rejections that settle
   * after an abort become a stable `SubagentError` with code `CANCELLED`.
   * @param parentSessionId - parent session whose direct children are listed.
   * @param signal - caller-owned cancellation forwarded to Session queries
   *   and observed around every read await.
   * @returns children and per-child diagnostics ordered by `createdAt`, then id.
   * @throws {@link SubagentError} when the projection registry or the session
   *   store is not mounted, or the caller cancels the listing.
   */
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]> {
    return listSubagentChildren(this.ctx, parentSessionId, signal)
  }

  /**
   * Enumerate the root's complete session-backed subagent tree in stable
   * pre-order from one live-preferred corpus, without loading or resuming an
   * Agent. Ordinary sessions and one-shot children remain traversal nodes so
   * continuable descendants below them are discovered; each returned entry
   * adds its durable `parentId` and root-relative `depth`. Identity resolution,
   * diagnostics, optional persistence, and cancellation follow the same
   * projection-backed contract as {@link listChildren}.
   * @param rootSessionId - session whose complete descendant tree is listed.
   * @param signal - caller-owned cancellation forwarded to persistence reads
   *   and observed around every read await.
   * @returns children and per-candidate diagnostics with tree position, in
   *   stable pre-order.
   * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
   */
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]> {
    return listSubagentDescendants(this.ctx, rootSessionId, signal)
  }

  /**
   * Remote face of {@link listChildren} for one browser: the durable listing
   * plus live Agent activity and the delivery-time parent availability hint.
   * Parent availability is a hint; {@link prompt} performs the authoritative
   * check. Named apart from the provider-name {@link list}, which owns the
   * member.
   * @param parentSessionId - parent session whose direct children are listed.
   * @param signal - carrier cancellation forwarded to Session queries.
   * @returns the catalog view for that parent.
   * @throws {RemoteError} `gateway/bad-request` for an empty parent id,
   *   `gateway/cancelled` for an aborted read, `subagent/projections-unavailable` when
   *   the deployment has no projection registry, otherwise `gateway/internal`.
   */
  @Remote('list')
  async remoteExportList(parentSessionId: SessionId, signal: AbortSignal): Promise<SubagentCatalog> {
    validateControlRequest('subagent.list', { parentSessionId })
    try {
      return catalogView(this.ctx, parentSessionId, await this.listChildren(parentSessionId, signal))
    } catch (error: unknown) {
      return rejectCatalogRead(error, signal)
    }
  }

  /**
   * Deliver one browser-authored message to a continuable child through the
   * exact live direct parent, retaining the caller-minted request identity and
   * validated browser zone on the accepted message. Success identifies the
   * message the child's FIFO inbox accepted; later execution is independent of
   * this call.
   * Image parts are admitted and persisted through the attachment store
   * before delivery, and the child's model must accept image input.
   * @param request - durable address, minted identity, content, and optional browser zone.
   * @param signal - carrier cancellation, owning the call until inbox acceptance.
   * @returns the accepted message's inbox identity.
   * @throws {RemoteError} `gateway/bad-request`, `subagent/attachment-invalid`,
   *   `subagent/invalid-time-zone`, `subagent/parent-unavailable`,
   *   `subagent/not-resumable`, `subagent/unauthorized`,
   *   `subagent/delivery-unavailable`, `gateway/cancelled`, or `gateway/internal`.
   */
  @Remote('prompt')
  async prompt(request: SubagentPromptRequest, signal: AbortSignal): Promise<SubagentPromptReceipt> {
    const { parentSessionId, childSessionId, clientTimeZone } = request
    validateControlRequest('subagent.prompt', request)
    const canonicalTimeZone = clientTimeZone === undefined
      ? undefined
      : canonicalClientTimeZone(clientTimeZone)
    if (clientTimeZone !== undefined && canonicalTimeZone === undefined) {
      throw new RemoteError(
        'subagent/invalid-time-zone',
        'clientTimeZone must be UTC or a valid IANA Area/Location name',
        { value: clientTimeZone },
      )
    }
    const parent = this.ctx.get('agents')?.get(parentSessionId)
    if (parent === undefined) {
      throw new RemoteError(
        'subagent/parent-unavailable',
        `parent session "${parentSessionId}" is not live`,
        { parentSessionId },
      )
    }
    // P5-10 acceptance[0] and acceptance[2] on the real surface: a prompt that
    // races an interrupt must not wake the child, and the same request id
    // delivered twice must not open a second turn. Both are decided from the
    // child's own control sequence before any content is admitted, so a refusal
    // costs no attachment work.
    const control = this.controlFor(childSessionId)
    // `admit`, not `submit`: the delivery below is the manager's own — content
    // admission, attachments, then the child's inbox — and routing it through
    // the router's dispatch would demand a live child for a delivery that
    // today works without one (it may cold-resume).
    const decision = control.decide({ kind: 'continue', controlEpoch: promptEpoch(request.requestId) })
    if (!decision.applied) {
      throw new RemoteError(
        decision.denial.reason === 'already-applied' ? 'subagent/duplicate-request' : 'subagent/not-resumable',
        decision.denial.reason === 'already-applied'
          ? 'this prompt request was already delivered'
          : `subagent "${childSessionId}" cannot take a prompt: ${decision.denial.reason}`,
        { childSessionId, reason: decision.denial.reason },
      )
    }
    const source: BrowserPromptSource = {
      kind: 'user',
      rpcId: request.requestId,
      ...(canonicalTimeZone === undefined ? {} : { clientTimeZone: canonicalTimeZone }),
    }
    try {
      // Admission precedes delivery: image parts become durable references
      // here, so the child inbox only ever accepts Host-persisted attachments.
      let content: ContentBlock[]
      if (request.content.every((part): part is { readonly type: 'text'; readonly text: string } => part.type === 'text')) {
        content = request.content.map(part => ({ type: 'text', text: part.text }))
      } else {
        const attachments = this.ctx.get('attachments')
        if (attachments === undefined) throw new Error('subagent image prompt requires an attachment store')
        content = await admitPromptContent(attachments, request.content)
      }
      const messageId = await this[queueSubagentPrompt](parent, childSessionId, content, source, signal)
      control.recordApplied(promptEpoch(request.requestId))
      // Recorded only after DELIVERY succeeds. Recording it at admission would
      // spend the id on an attempt that never reached the child: an existing
      // case drives five different delivery failures through one request id,
      // and every retry after the first would have been refused as a duplicate
      // of something that never happened. Idempotency protects against a
      // repeated EFFECT, and a refused delivery had none.
      return { messageId }
    } catch (error: unknown) {
      return rejectPrompt(error, childSessionId, signal)
    }
  }

  /**
   * Remote face of {@link interrupt} under one durable parent address. No
   * catalog, history, persistence, or parent Agent lookup runs: the core
   * primitive alone authorizes the address against the live Activation, which
   * is what keeps a live child interruptible while its parent Agent is offline.
   * Absent, idle, and already-completed targets are accepted no-ops there.
   * @param childSessionId - durable child session id to interrupt.
   * @param parentSessionId - durable direct parent whose authority is claimed.
   * @param mode - required continuable-address discriminator.
   * @returns acknowledgement that the cancel signal was admitted, not that the target is quiescent.
   * @throws {RemoteError} `gateway/bad-request` for an empty id,
   *   `subagent/unauthorized` when the address does not own the live target,
   *   otherwise `gateway/internal`.
   */
  @Remote('interruptByParent')
  interruptByParent(
    childSessionId: SessionId,
    parentSessionId: SessionId,
    mode: 'continuable',
  ): SubagentInterruptReceipt {
    validateControlRequest('subagent.interrupt', { childSessionId, parentSessionId, mode })
    try {
      this.interrupt(childSessionId, { kind: 'user', parentSessionId })
      // The interrupt is what makes the NEXT prompt refusable. Recorded after
      // the primitive accepts it, so a refused interrupt leaves the child
      // promptable.
      this.controlFor(childSessionId).observeCancelled()
    } catch (error: unknown) {
      if (error instanceof SubagentError && error.code === 'UNAUTHORIZED') {
        throw new RemoteError(
          'subagent/unauthorized',
          'subagent does not belong to this parent',
          { childSessionId },
          { cause: error },
        )
      }
      throw new RemoteError('gateway/internal', 'subagent interrupt failed', {}, { cause: error })
    }
    return { accepted: true }
  }

  /**
   * Register a provider under its name. Registration is effect-scoped and HMR
   * safe; removing a provider blocks new starts but does not revoke runs that
   * were already returned to their holders.
   * @param provider - the trusted provider implementation.
   * @returns the exact Cordis effect disposer.
   */
  registerProvider(provider: SubagentProvider): () => void {
    const name = provider.name
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous disposer
    return this.ctx.effect(function* (this: SubagentRuntime) {
      if (this.providers.has(name)) {
        throw new SubagentError(`a subagent provider named "${name}" is already registered`, 'DUPLICATE_PROVIDER')
      }
      this.providers.set(name, provider)
      yield () => {
        this.providers.delete(name)
        this.emitLifecycle('subagent/provider-removed', name)
      }
      // A throwing added-listener unwinds the yielded rollback, matching the
      // repository's fail-loud registration semantics.
      this.ctx.emit('subagent/provider-added', provider)
    }.bind(this), 'subagents.registerProvider()')
  }

  /**
   * Look up a provider by name.
   * @param name - the provider name.
   * @returns the provider, or undefined when absent.
   */
  getProvider(name: string): SubagentProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * List registered provider names in insertion order.
   * @returns the registered names.
   */
  list(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Establish a published child on the named provider. Capability and semantic
   * checks run before delegation. Provider ownership lasts until its promise
   * fulfills; a rejection therefore has no run for the caller to dispose and
   * emits no run lifecycle events. Post-publication turn and infrastructure
   * failures settle through the returned run.
   * @param name - the provider to use.
   * @param request - child label, prompt, parent, signal, and optional capabilities.
   * @returns the published holder-owned run.
   */
  async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
    const provider = this.expectProvider(name)
    this.assertCapabilities(provider, request)
    assertSubagentMaxDepth(request.maxDepth)
    if (request.outputSchema !== undefined) assertObjectJsonSchema(request.outputSchema)
    const descriptor = snapshotSubagentDescriptor({
      mode: 'one-shot',
      provider: name,
      ...request.label !== undefined ? { label: request.label } : {},
    })
    const resolved: ResolvedSubagentStartRequest = { ...request, descriptor }
    return observeRun(this.emitLifecycle, name, request.parent, await provider.start(resolved))
  }

  /**
   * Resolve one provider's detached continuable-creation contribution. Method
   * presence on the provider IS the capability, so a provider without it is
   * rejected before the manager reserves any child resources.
   */
  /**
   * This child's control state, created on first use.
   * @param childSessionId - the child to read.
   * @returns its mutable control state.
   */
  private controlFor(childSessionId: SessionId): ChildControlRouter {
    let router = this.routers.get(childSessionId)
    if (router === undefined) {
      // The ledger reads the CHILD's durable session, so a redelivery is
      // refused across a restart and not only within one process (must[2]).
      // The live Agent is resolved ONCE here and may be absent: a router
      // without one decides and records but dispatches nothing, which is what
      // separates "your message already arrived" from "there is nothing to
      // send it to".
      router = new ChildControlRouter(
        openControlLedger(() => this.ctx.get('sessions')?.get(childSessionId), promptEpoch),
        this.ctx.get('agents')?.get(childSessionId),
      )
      this.routers.set(childSessionId, router)
    }
    return router
  }

  private async prepareContinuable(
    name: string,
    request: ContinuableCreateRequest,
  ): Promise<ContinuableCreateSpec> {
    const provider = this.expectProvider(name)
    if (provider.prepareContinuable === undefined) {
      throw new SubagentError(
        `subagent provider "${provider.name}" does not support continuable children `
        + '(no prepareContinuable capability)',
        'UNSUPPORTED_CAPABILITY',
      )
    }
    return provider.prepareContinuable(request)
  }

  /** Look up a provider for dispatch or fail loud. */
  private expectProvider(name: string): SubagentProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) {
      throw new SubagentError(`no subagent provider registered for "${name}"`, 'NO_PROVIDER')
    }
    return provider
  }

  /** Resolve the optional continuable-subagent manager or fail loud. */
  private requireContinuations(): SubagentContinuationManager {
    if (this.continuations === undefined) {
      throw new SubagentError(
        'continuable subagents require the agents service',
        'CONTINUATION_UNAVAILABLE',
      )
    }
    return this.continuations
  }

  /**
   * Build the lifecycle observer for one continuable Activation's residency
   * epoch, so the manager publishes its edges without owning event dispatch.
   */
  private observeActivation(
    provider: string,
    childId: SessionId,
    parent: Agent,
  ): ActivationObserver {
    return createActivationObserver(this.emitLifecycle, provider, childId, parent)
  }

  /** Reject the first requested capability that the provider lacks. */
  private assertCapabilities(provider: SubagentProvider, request: SubagentStartRequest): void {
    const needs: { when: boolean; cap: keyof SubagentCapabilities }[] = [
      { when: request.agentOptions !== undefined, cap: 'agentOptions' },
      { when: request.outputSchema !== undefined, cap: 'outputSchema' },
      { when: request.maxDepth !== undefined, cap: 'depthLimit' },
      { when: request.toolFilter !== undefined, cap: 'toolFilter' },
      { when: request.persona !== undefined, cap: 'persona' },
    ]
    for (const { when, cap } of needs) {
      if (when && !provider.capabilities[cap]) {
        throw new SubagentError(
          `subagent provider "${provider.name}" does not support the "${cap}" capability`,
          'UNSUPPORTED_CAPABILITY',
        )
      }
    }
  }
}

export default SubagentRuntime
