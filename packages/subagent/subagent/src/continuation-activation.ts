/**
 * Process-local Activation ownership for continuable subagents: admission,
 * parent-child residency, serialized delivery, settlement, and disposal.
 *
 * The continuation manager owns durable request orchestration and delegates
 * every mutable residency decision to this registry, so delivery and teardown
 * share one child lock and one Activation map.
 *
 * @module @deepseek-ai/dsh-subagent/continuation-activation
 */

import { FiberState } from '@deepseek-ai/cordis'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentHandle,
  AgentOptions,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import type {
  SessionEvent,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
} from './child-agent.ts'
import type { ChildComposition, DelegatedPolicyOverrides } from './child-agent.ts'
import { createSettlementMessage, settlementMessageOf, settlementPayload } from './continuation-messages.ts'
import type { SubagentDescriptorData } from './descriptor.ts'
import { SubagentError } from './error.ts'
import { SubagentInbox } from './inbox.ts'
import type { SubagentDelivery } from './inbox.ts'
import type { ActivationObserver, ActivationTerminal } from './lifecycle.ts'
import { commitSettlement, drainSettlements } from './settlement-outbox.ts'

/**
 * One residency epoch for a reconstructed continuable child Agent. It directly
 * owns the published `AgentHandle`; the registry's private activation-owner
 * scope is its structural Cordis owner.
 */
export interface Activation {
  /** The durable child this Activation is an epoch of. */
  readonly childId: SessionId
  /**
   * The durable direct parent, stored because settlement delivery must resolve
   * that parent after the child handle is gone. {@link ancestry} cannot answer
   * it: a `WeakSet` is not enumerable, and the child's own header is only
   * reachable through a handle disposal has already released.
   */
  readonly parentSession: SessionId
  /** The provider name recorded in the durable descriptor. */
  readonly provider: string
  /** The retained live Agent handle, disposed exactly once at settlement. */
  readonly handle: AgentHandle
  /** The Activation-local admission and close wrapper around the handle's Agent inbox. */
  readonly inbox: SubagentInbox
  /**
   * Exact live Agent ancestry observed when this Activation materialized.
   * Weak membership preserves host-scope identity across an intermediate
   * ancestor leaving the registry without retaining that ancestor's runtime.
   */
  readonly ancestry: WeakSet<Agent>
  /**
   * Session ids of the child Activations this one owns. Because one Session has
   * at most one live Activation, the id identifies the live child without
   * another runtime-incarnation reference. Non-empty blocks settlement.
   */
  readonly ownedChildren: Set<SessionId>
  /** The lifecycle observer that emits this epoch's start and terminal edges. */
  readonly observer: ActivationObserver
  /**
   * Whether any delivery to this child was ever accepted. A materialization
   * rolled back before its first acceptance is a child the caller was told does
   * not exist, so its teardown owes the parent no settlement account.
   */
  announced: boolean
  /** Renewed whenever a settlement watcher must re-check residency state. */
  poke: PromiseWithResolvers<void>
}

/** Inputs shared by fresh and resumed Activation materialization. */
export interface MaterializeInputs {
  childId: SessionId
  provider: string
  parent: Agent
  /**
   * Creation inputs; absent for a cold resume, which loads the persisted
   * session — including the delegation policy events a fresh creation seeded,
   * so a resume never re-captures the parent's policy.
   */
  create?: {
    seed: readonly SessionEvent[] | undefined
    meta: NonNullable<CreateAgentOptions['meta']>
    /** Exact parent-log prefix length inside {@link seed}. */
    inheritedEventCount: SessionLogOffsetType
    /** Policy captured at delegation: the parent's sandbox override plus the approval pin. */
    delegatedPolicies: DelegatedPolicyOverrides
    /** Child-owned composition record appended after the inherited marker. */
    descriptor: SubagentDescriptorData
  }
  agentOptions: AgentOptions
  /** Per-child composition; materialization supplies the child's own session id. */
  composition: Omit<ChildComposition, 'childSession'>
  signal: AbortSignal
}

/**
 * One admitted materialization and the exact live ancestry observed at its
 * synchronous admission point. Retaining identities lets a scoped teardown
 * keep waiting even if an intermediate Agent leaves the registry meanwhile.
 */
interface Materialization {
  readonly lineage: readonly Agent[]
  readonly settled: Promise<void>
}

/** Residency state observed by the natural-settlement watcher. */
type SettlementState = 'closed' | 'retry' | 'wait' | 'ready'

/** Result of the final child-lock settlement decision. */
type SettlementAttempt =
  | Exclude<SettlementState, 'ready'>
  | { readonly done: Promise<void> }

/**
 * How many times a drain may hand one settlement to a parent before
 * dead-lettering it.
 *
 * Fixed rather than configurable, because it is not a network retry policy: a
 * settlement is delivered to a LOCAL inbox, and an attempt is only ever spent
 * when a live parent accepted the handoff. A parent that cannot receive —
 * absent, or tearing down — declines without spending one. So the budget
 * bounds a pathological loop rather than expressing a deployment's tolerance
 * for a flaky transport, and a profile has nothing to say about it.
 */
const SETTLEMENT_MAX_ATTEMPTS = 5

/** Serialize each durable child's delivery, release, and disposal. */
export class ChildLock {
  private tails = new Map<SessionId, Promise<unknown>>()

  /**
   * Run `operation` after every previously queued operation for `childId`.
   * @param childId - the durable child whose operations are linearized.
   * @param operation - the critical section to run in order.
   * @returns the operation's own settlement.
   */
  run<T>(childId: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(childId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    // Absorb rejections in the chaining tail so one failed critical section
    // cannot reject an unrelated later caller.
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(childId, tail)
    void tail.then(() => {
      if (this.tails.get(childId) === tail) this.tails.delete(childId)
    })
    return result
  }
}

/**
 * Whether a fiber is the given one or one of its ancestors.
 * @param own - the fiber whose lifecycle is asked about.
 * @param candidate - the fiber that changed state.
 * @returns true when `candidate` unloading unloads `own`.
 */
function isLifecycleAncestor(own: Fiber, candidate: Fiber): boolean {
  let fiber = own
  while (true) {
    if (fiber === candidate) return true
    const parent = fiber.parent.fiber
    if (parent === fiber) return false
    fiber = parent
  }
}

/** Own the complete process-local lifetime of continuable child Activations. */
export class ContinuableActivationRegistry {
  /** Child session id → its live Activation. Process-local, never durable. */
  private readonly resident = new Map<SessionId, Activation>()
  /** Materializations admitted before drain, tracked through publication or rollback. */
  private readonly materializations = new Set<Materialization>()
  /** Per-child serializer shared by delivery, release, and disposal. */
  readonly locks = new ChildLock()
  /** Structural Cordis owner of every Activation handle. */
  readonly ownerCtx: Context
  /**
   * Exact roots whose host teardown has begun, with the live lineage members
   * observed under each root. Entries remain until that exact root leaves the
   * Agent registry, closing admission throughout its host's teardown without
   * poisoning a later same-id replacement.
   */
  private readonly closingScopes = new Map<Agent, Set<Agent>>()
  private draining = false
  /**
   * The bus service, captured at construction (§12.42).
   *
   * Held rather than re-read with `ctx.get` at settlement time, and the reason
   * is teardown: measured three ways — with `SubagentRuntime` injecting the
   * service, in the synchronous drain prologue, and with the mount order
   * reversed — the service registry no longer answers for `messageBus` by the
   * time a disposer runs. `ctx.get` is correct and simply has nothing to
   * return there.
   *
   * What is held is the SERVICE value `inject` already delivered at activation,
   * not the store behind it: the boundary is the service, and reaching past it
   * for the store would be the thing §12.40 refused. Fiber order does not keep
   * the service's database open for the drain (BLOCKED-333); the shutdown
   * commit's timing does, as the constructor records.
   */
  private readonly bus: MessageBusPlugin | undefined

  /**
   * Build one registry inside the service's Agent-injected context.
   * @param ctx - context providing Agents, Sessions, and teardown ownership.
   * @param observeActivation - build the lifecycle observer for one residency epoch.
   */
  constructor(
    private readonly ctx: Context,
    private readonly observeActivation: (
      provider: string,
      childId: SessionId,
      parent: Agent,
    ) => ActivationObserver,
  ) {
    this.bus = ctx.get('messageBus')
    // The bus clears its store handle in its own teardown, and a fiber unload
    // starts all of its disposers at once, so on the shipped headless profile
    // the drain began after that clear and committed nothing (BLOCKED-333).
    // Cordis announces an unload before any of its disposers runs: the
    // shutdown settlements are committed then, while the bus is still open.
    ctx.on('internal/status', (fiber) => {
      if (fiber.state === FiberState.UNLOADING && isLifecycleAncestor(ctx.fiber, fiber)) this.closeForShutdown()
    })
    // Ordinary Cordis owner effects unwind in reverse registration order, which
    // cannot express the dynamic child graph. Register the private scope's
    // structural disposer FIRST and the drain SECOND, so reverse unwind invokes
    // the drain before releasing the scope; a cleanup effect on the same scope
    // as the Agent handles would let structural handle disposal bypass
    // child-first ordering.
    const scope = ctx.plugin(function activationOwner() {})
    this.ownerCtx = scope.ctx
    ctx.on('agent/disposed', ({ agent }) => {
      this.closingScopes.delete(agent)
    })
    // Trigger (2): a parent that starts drains what it is owed. This is
    // acceptance[1]'s recovery — a settlement committed while the parent was
    // gone reaches it on the next start rather than being lost with the
    // process that could not deliver it.
    ctx.on('agent/session-start', ({ agent }) => { this.drainSettlementOutbox(agent) })
    // Trigger (3): the fallback. A signal can be missed — the target had no
    // live driver at commit time, or a drain raced a disposal — and a parent
    // that is about to take a step is a parent that can receive.
    ctx.on('agent/pre-step', async (proposal, next) => {
      this.drainSettlementOutbox(proposal.agent)
      return next()
    })
    ctx.effect(function* (this: ContinuableActivationRegistry) {
      yield scope.dispose
      yield () => this.drain()
    }.bind(this), 'subagents.continuations()')
  }

  /**
   * Return the live Activation for a durable child id, if resident.
   * @param childId - durable child session id to look up.
   * @returns the process-local Activation, or `undefined` when it is not resident.
   */
  get(childId: SessionId): Activation | undefined {
    return this.resident.get(childId)
  }

  /**
   * Reject one child identity already owned by a live Agent or Session.
   * @param childId - proposed durable child session id.
   */
  assertChildIdAvailable(childId: SessionId): void {
    if (this.ctx.agents.get(childId) !== undefined || this.ctx.get('sessions')?.get(childId) !== undefined) {
      throw new SubagentError(`subagent "${childId}" already exists`, 'DUPLICATE_CHILD')
    }
  }

  /**
   * Pre-register `childId` in a continuation-managed parent's owned set so the
   * parent cannot settle while a caller is still establishing or resuming that
   * child. Returns a releaser for the failure path; it removes only a hold
   * this call added, and leaves ownership in place once a live Activation for
   * the child exists.
   * @param parent - the live direct parent the operation is admitted under.
   * @param childId - the durable child the operation addresses.
   * @returns the failure-path releaser; a no-op when nothing was added.
   */
  holdOwnership(parent: Agent, childId: SessionId): () => void {
    const parentActivation = this.resident.get(parent.id)
    if (parentActivation === undefined || parentActivation.handle.agent !== parent) return () => {}
    if (parentActivation.inbox.closing !== undefined) {
      throw new SubagentError(
        `subagent parent "${parent.id}" is being disposed; the child was not established`,
        'ACTIVATION_CLOSING',
      )
    }
    if (parentActivation.ownedChildren.has(childId)) return () => {}
    parentActivation.ownedChildren.add(childId)
    return () => {
      const live = this.resident.get(childId)
      /* v8 ignore next 4 -- reaching this arm needs another delivery to establish the child
       * between this operation's failure and its releaser running, which no test can schedule
       * deterministically: the ownership edge then belongs to that live Activation, so the
       * conservative keep leaves it for finishDisposal's releaseOwnership. */
      if (live !== undefined && live.inbox.closing === undefined) return
      if (parentActivation.ownedChildren.delete(childId)) this.wake(parentActivation)
    }
  }

  /**
   * Interrupt one live continuable child's current turn under the supplied authority.
   * @param targetSessionId - the durable child session id to interrupt.
   * @param authority - the human parent address or exact live ancestor Agent.
   */
  interrupt(
    targetSessionId: SessionId,
    authority:
      | { readonly kind: 'user'; readonly parentSessionId: SessionId }
      | { readonly kind: 'ancestor'; readonly agent: Agent },
  ): void {
    if (authority.kind === 'ancestor') {
      const caller = authority.agent
      if (this.ctx.agents.get(caller.id) !== caller) {
        throw new SubagentError(
          `interrupting "${targetSessionId}" requires the exact live ancestor agent`,
          'UNAUTHORIZED',
        )
      }
      if (caller.id === targetSessionId) {
        throw new SubagentError(
          `agent "${caller.id}" cannot interrupt itself`,
          'UNAUTHORIZED',
        )
      }
    }
    const activation = this.resident.get(targetSessionId)
    if (activation === undefined) return
    if (authority.kind === 'user') {
      if (activation.handle.agent.session.header.parentSession !== authority.parentSessionId) {
        throw new SubagentError(
          `subagent "${targetSessionId}" belongs to another parent session`,
          'UNAUTHORIZED',
        )
      }
    } else if (!activation.ancestry.has(authority.agent)) {
      throw new SubagentError(
        `subagent "${targetSessionId}" is not a live descendant of agent "${authority.agent.id}"`,
        'UNAUTHORIZED',
      )
    }
    // Disposal already stopped the target with a whole-Activation teardown;
    // a second cancel would be a redundant signal on a closing handle.
    if (activation.inbox.closing !== undefined) return
    activation.handle.agent.cancel(
      authority.kind === 'user' ? { kind: 'user' } : { kind: 'parent' },
      { keepInbox: true },
    )
  }

  /**
   * Send through a receiving parent's Activation inbox when it has one.
   * @param parent - exact live Agent receiving the message.
   * @param message - durable user message to deliver.
   * @param delivery - receiving inbox destination.
   */
  sendWaking(parent: Agent, message: UserMessage, delivery: SubagentDelivery): void {
    const parentActivation = this.resident.get(parent.id)
    if (parentActivation !== undefined && parentActivation.handle.agent === parent) {
      try {
        parentActivation.inbox.deliver(message, delivery)
      } finally {
        this.wake(parentActivation)
      }
      return
    }
    if (delivery === 'steer') parent.steer(message)
    else parent.followup(message)
  }

  /**
   * Close admission, await every already-admitted materialization through
   * publication or rollback, then dispose the stable live Activation graph
   * child-first.
   */
  async drain(): Promise<void> {
    // Already done when the unload was announced; here for a direct call.
    // Delivery stays in the async section below: a tearing-down tree receives
    // nothing, and the rows it leaves pending are what the next start drains.
    this.closeForShutdown()
    await Promise.all([...this.materializations].map(materialization => materialization.settled))
    const owned = new Set<SessionId>()
    for (const activation of this.resident.values()) {
      for (const child of activation.ownedChildren) owned.add(child)
    }
    const roots = [...this.resident.values()].filter(activation => !owned.has(activation.childId))
    await this.disposeRoots(roots, 'activation(s)')
  }

  /**
   * Stop only the continuable descendants of exact live host-owned parents.
   * @param parents - exact live roots whose continuable descendants must stop.
   */
  async drainDescendants(parents: readonly Agent[]): Promise<void> {
    const roots = new Set(parents.filter(parent => this.ctx.agents.get(parent.id) === parent))
    if (roots.size === 0) return

    for (const root of roots) {
      this.closingMembers(root).add(root)
    }

    const targets: Activation[] = []
    for (const activation of this.resident.values()) {
      const lineage = this.liveLineage(activation.handle.agent)
      const owners = [...roots].filter(root => activation.handle.agent !== root
        && activation.ancestry.has(root))
      if (owners.length === 0) continue
      targets.push(activation)
      for (const owner of owners) {
        const members = this.closingMembers(owner)
        members.add(activation.handle.agent)
        for (const agent of lineage) members.add(agent)
      }
    }
    const materializations = [...this.materializations].filter((materialization) => {
      const owners = [...roots].filter(root => materialization.lineage.includes(root))
      for (const owner of owners) {
        const members = this.closingMembers(owner)
        for (const agent of materialization.lineage) members.add(agent)
      }
      return owners.length > 0
    })

    const ownedTargets = new Set<SessionId>()
    for (const activation of targets) {
      for (const child of activation.ownedChildren) ownedTargets.add(child)
    }
    const targetRoots = targets.filter(activation => !ownedTargets.has(activation.childId))

    for (const activation of targets) {
      const disposal = this.dispose(activation)
      void disposal.catch(() => undefined)
    }

    await Promise.all(materializations.map(materialization => materialization.settled))
    await this.disposeRoots(targetRoots, 'scoped activation(s)')
  }

  /**
   * Release selected resident direct children of one exact live parent.
   * @param parent - exact live direct parent authorizing the selected release.
   * @param childIds - durable direct-child ids to release when resident.
   */
  async drainChildren(parent: Agent, childIds: readonly SessionId[]): Promise<void> {
    if (this.ctx.agents.get(parent.id) !== parent) {
      throw new SubagentError('selected child teardown requires the exact live parent agent', 'UNAUTHORIZED')
    }
    const targets: Activation[] = []
    for (const childId of new Set(childIds)) {
      const activation = this.resident.get(childId)
      if (activation === undefined) continue
      if (activation.parentSession !== parent.id || !activation.ancestry.has(parent)) {
        throw new SubagentError(
          `subagent "${childId}" is not a direct child of agent "${parent.id}"`,
          'UNAUTHORIZED',
        )
      }
      targets.push(activation)
    }

    for (const activation of targets) {
      const disposal = this.dispose(activation)
      void disposal.catch(() => undefined)
    }
    await this.disposeRoots(targets, 'selected activation(s)')
  }

  /**
   * Reject new admission once the registry or this exact parent tree began draining.
   * @param agent - exact live Agent whose lineage determines admission.
   */
  assertAdmitting(agent: Agent): void {
    const closing = this.closingTeardownFor(agent)
    if (closing === undefined) return
    throw new SubagentError(
      closing === 'manager'
        ? 'continuable subagents are draining; the operation was not admitted'
        : `continuable subagents below parent "${closing.id}" are draining; the operation was not admitted`,
      'DRAINING',
    )
  }

  /**
   * Authorize one operation against the durable direct-parent lineage.
   * @param parent - exact live Agent claiming direct-parent authority.
   * @param childId - durable child session id addressed by the operation.
   * @param parentSession - durable direct-parent id recorded by the child.
   */
  authorizeLineage(
    parent: Agent,
    childId: SessionId,
    parentSession: SessionId | undefined,
  ): void {
    if (this.ctx.agents.get(parent.id) !== parent) {
      throw new SubagentError(
        `subagent "${childId}" delivery requires the exact live parent agent`,
        'UNAUTHORIZED',
      )
    }
    if (parentSession !== parent.id) {
      throw new SubagentError(`subagent "${childId}" belongs to another parent session`, 'UNAUTHORIZED')
    }
  }

  /**
   * Create or resume one child Agent and publish its Activation.
   * @param inputs - reconstruction and admission inputs for the residency epoch.
   * @returns the published process-local Activation.
   */
  materialize(inputs: MaterializeInputs): Promise<Activation> {
    this.assertAdmitting(inputs.parent)
    const settled = Promise.withResolvers<void>()
    const lineage = this.liveLineage(inputs.parent)
    const materialization: Materialization = {
      lineage,
      settled: settled.promise,
    }
    this.materializations.add(materialization)
    return this.materializeTracked(inputs, lineage).finally(() => {
      this.materializations.delete(materialization)
      settled.resolve()
    })
  }

  /**
   * Cross the final admission cutoff and submit without yielding.
   * @param activation - the exact resident child receiving the message.
   * @param message - the already-built durable user message.
   * @param delivery - the Agent inbox destination.
   * @param parent - exact live direct parent authorizing admission.
   * @param signal - caller cancellation before inbox acceptance.
   * @returns the accepted durable message id.
   */
  submitAdmitted(
    activation: Activation,
    message: UserMessage,
    delivery: SubagentDelivery,
    parent: Agent,
    signal: AbortSignal,
  ): MessageId {
    signal.throwIfAborted()
    this.assertAdmitting(parent)
    this.authorizeLineage(
      parent,
      activation.childId,
      activation.handle.agent.session.header.parentSession,
    )
    this.acquireOwnership(parent, activation.childId)
    try {
      activation.inbox.deliver(message, delivery)
    } finally {
      this.wake(activation)
    }
    return message.id
  }

  /**
   * Stop and release one Activation through its memoized close transaction.
   * @param activation - exact residency epoch to close.
   * @param finalStateFlushed - whether natural settlement already flushed final state.
   * @returns the shared close transaction.
   */
  dispose(activation: Activation, finalStateFlushed = false): Promise<void> {
    return activation.inbox.close(() => this.finishDisposal(activation, finalStateFlushed))
  }

  /** Dispose independent roots and report every branch failure after all settle. */
  private async disposeRoots(
    roots: readonly Activation[],
    failureSubject: 'activation(s)' | 'scoped activation(s)' | 'selected activation(s)',
  ): Promise<void> {
    const failures = await Promise.all(roots.map(async (activation) => {
      try {
        await this.dispose(activation)
        return undefined
      } catch (error: unknown) {
        return error
      }
    }))
    const reasons = failures.filter(failure => failure !== undefined)
    if (reasons.length > 0) {
      throw new SubagentError(
        `continuable subagent teardown failed for ${reasons.length} ${failureSubject}: `
        + reasons.map(reason => errorChain(reason)).join('; '),
        'ACTIVATION_TEARDOWN_FAILED',
      )
    }
  }

  /** Return the retained member set for one exact scoped-teardown root. */
  private closingMembers(root: Agent): Set<Agent> {
    const existing = this.closingScopes.get(root)
    if (existing !== undefined) return existing
    const members = new Set<Agent>()
    this.closingScopes.set(root, members)
    return members
  }

  /** Return the exact currently resolvable ancestry from `agent` upward. */
  private liveLineage(agent: Agent): Agent[] {
    const lineage = [agent]
    const seen = new Set<SessionId>([agent.id])
    let parentSession = agent.session.header.parentSession
    while (parentSession !== undefined) {
      const parent = this.ctx.agents.get(parentSession)
      if (parent === undefined || seen.has(parent.id)) break
      lineage.push(parent)
      seen.add(parent.id)
      parentSession = parent.session.header.parentSession
    }
    return lineage
  }

  /** Return the teardown that closed continuable admission for this agent's lineage. */
  private closingTeardownFor(agent: Agent): Agent | 'manager' | undefined {
    if (this.draining) return 'manager'
    const lineage = this.liveLineage(agent)
    for (const [root, members] of this.closingScopes) {
      if (members.has(agent) || lineage.includes(root)) return root
    }
    return undefined
  }

  /** Perform one tracked materialization through publication or rollback. */
  private async materializeTracked(
    inputs: MaterializeInputs,
    parentLineage: readonly Agent[],
  ): Promise<Activation> {
    const { childId, provider, parent, create } = inputs
    inputs.signal.throwIfAborted()
    const setup = (childCtx: Context, child: Agent): void => {
      // Only fresh creation appends the descriptor and delegated policy after
      // the inherited marker; a cold resume replays those persisted events.
      if (create !== undefined) {
        child.session.append('subagent/descriptor', create.descriptor)
        appendDelegatedPolicyOverrides(child.session, create.delegatedPolicies)
      }
      // P2-02: the child's own id is what lets composition derive its capability token.
      applyChildComposition(childCtx, parent, { ...inputs.composition, childSession: childId })
    }
    const observer = this.observeActivation(provider, childId, parent)
    const handle: AgentHandle = create === undefined
      ? await this.ownerCtx.agents.resume({
        resumeSessionId: childId,
        parentAgent: parent,
        agentOptions: inputs.agentOptions,
        signal: inputs.signal,
        setup,
      })
      : await this.ownerCtx.agents.create({
        sessionId: childId,
        parentAgent: parent,
        meta: create.meta,
        ...(create.seed === undefined ? {} : { seed: create.seed }),
        inheritedEventCount: create.inheritedEventCount,
        agentOptions: inputs.agentOptions,
        signal: inputs.signal,
        setup,
      })

    const activation: Activation = {
      childId,
      parentSession: parent.id,
      provider,
      handle,
      inbox: new SubagentInbox(handle.agent),
      ancestry: new WeakSet([handle.agent, ...parentLineage]),
      ownedChildren: new Set(),
      observer,
      announced: false,
      poke: Promise.withResolvers<void>(),
    }
    this.resident.set(childId, activation)
    try {
      inputs.signal.throwIfAborted()
      this.assertAdmitting(parent)
      this.acquireOwnership(parent, childId)
      const wakeOnInboxRemoval = (): void => { this.wake(activation) }
      handle.agent.ctx.on('agent/inbox/claimed', wakeOnInboxRemoval)
      handle.agent.ctx.on('agent/inbox/discarded', wakeOnInboxRemoval)
      observer.start(handle.agent)
    } catch (error: unknown) {
      /* v8 ignore next -- rollback failure must not mask the admission failure
       * that prevented this operation from returning an accepted message id. */
      await this.rollbackUnpublished(activation).catch(() => undefined)
      throw error
    }
    this.watchSettlement(activation)
    return activation
  }

  /** Release an Activation whose start edge was not published. */
  private rollbackUnpublished(activation: Activation): Promise<void> {
    return activation.inbox.close(async () => {
      try {
        await activation.handle.dispose()
      } finally {
        this.resident.delete(activation.childId)
        this.releaseOwnership(activation.childId)
      }
    })
  }

  /** Register the child in a continuation-managed parent's owned set. */
  private acquireOwnership(parent: Agent, childId: SessionId): void {
    const parentActivation = this.resident.get(parent.id)
    if (parentActivation === undefined) return
    if (parentActivation.inbox.closing !== undefined) {
      throw new SubagentError(
        `subagent parent "${parent.id}" is being disposed; the child was not established`,
        'ACTIVATION_CLOSING',
      )
    }
    parentActivation.ownedChildren.add(childId)
  }

  /** Remove one child from its live owner's set and let that owner re-check settlement. */
  private releaseOwnership(childId: SessionId): void {
    for (const candidate of this.resident.values()) {
      if (candidate.ownedChildren.delete(childId)) this.wake(candidate)
    }
  }

  /** Let a settlement watcher re-check residency after relevant state changes. */
  private wake(activation: Activation): void {
    activation.poke.resolve()
    activation.poke = Promise.withResolvers<void>()
  }

  /** Follow one Activation to natural settlement. */
  private watchSettlement(activation: Activation): void {
    void (async () => {
      while (true) {
        const idleObservation = activation.poke
        await activation.handle.agent.whenIdle()
        if (activation.inbox.closing !== undefined) return
        const readiness = await this.locks.run(activation.childId, () => Promise.resolve(
          this.settlementState(activation, idleObservation),
        ))
        if (readiness === 'closed') return
        if (readiness === 'retry') continue
        if (readiness === 'wait') {
          await idleObservation.promise
          continue
        }

        const finalSeq = activation.handle.agent.session.seq
        await this.flushFinalState(activation)
        const attempt = await this.locks.run<SettlementAttempt>(activation.childId, () => {
          const state = this.settlementState(activation, idleObservation)
          if (state !== 'ready') return Promise.resolve(state)
          if (activation.handle.agent.session.seq !== finalSeq) {
            return Promise.resolve('retry')
          }
          // The task starts synchronously, so idle ownership and Inbox closure share one turn.
          let done!: Promise<void>
          try {
            void activation.handle.agent.runMaintenance(() => {
              done = this.dispose(activation, true)
              return Promise.resolve()
            })
          } catch {
            // Another activity won the idle phase after the preceding observation.
            return Promise.resolve('retry')
          }
          return Promise.resolve({ done })
        })

        if (attempt === 'closed') return
        if (attempt === 'retry') continue
        if (attempt === 'wait') {
          await idleObservation.promise
          continue
        }
        try {
          await attempt.done
        } catch (error: unknown) {
          this.ctx.logger.warn(
            `subagent "${activation.childId}" activation teardown failed: ${errorChain(error)}`,
          )
        }
        return
      }
    })()
  }

  /** Classify one Inbox and owned-child observation without reading Agent execution state. */
  private settlementState(
    activation: Activation,
    observation: PromiseWithResolvers<void>,
  ): SettlementState {
    if (activation.inbox.closing !== undefined) return 'closed'
    if (activation.poke !== observation) return 'retry'
    if (activation.inbox.hasPending || activation.ownedChildren.size > 0) return 'wait'
    return 'ready'
  }

  /** Propagate stop synchronously, then finish the child-first release. */
  private async finishDisposal(activation: Activation, finalStateFlushed: boolean): Promise<void> {
    this.wake(activation)
    const { childId } = activation
    const failures: SubagentError[] = []
    if (finalStateFlushed) {
      try {
        activation.observer.capture(activation.handle.agent)
      } catch (error: unknown) {
        failures.push(new SubagentError(
          `subagent "${childId}" activation teardown failed: ${errorChain(error)}`,
          'ACTIVATION_TEARDOWN_FAILED',
          { cause: error },
        ))
      }
    } else {
      activation.handle.agent.cancel({ kind: 'parent' })
      const idle = activation.handle.agent.whenIdle()
      const children = [...activation.ownedChildren]
        .map(child => this.resident.get(child))
        .filter((child): child is Activation => child !== undefined)
      const childDisposals = children.map(child => this.dispose(child))
      try {
        const childFailures = await Promise.all(childDisposals.map(async (disposal) => {
          try {
            await disposal
            return undefined
          } catch (error: unknown) {
            return error
          }
        }))
        const reasons = childFailures.filter(reason => reason !== undefined)
        if (reasons.length > 0) {
          failures.push(new SubagentError(
            `subagent "${childId}" child teardown failed: ${reasons.map(reason => errorChain(reason)).join('; ')}`,
            'ACTIVATION_TEARDOWN_FAILED',
          ))
        }
        await idle
        await this.flushFinalState(activation)
        activation.observer.capture(activation.handle.agent)
      } catch (error: unknown) {
        failures.push(new SubagentError(
          `subagent "${childId}" activation teardown failed: ${errorChain(error)}`,
          'ACTIVATION_TEARDOWN_FAILED',
          { cause: error },
        ))
      }
    }
    try {
      await activation.handle.dispose()
    } catch (error: unknown) {
      failures.push(new SubagentError(
        `subagent "${childId}" activation handle disposal failed: ${errorChain(error)}`,
        'ACTIVATION_TEARDOWN_FAILED',
        { cause: error },
      ))
    }

    let failure: SubagentError | undefined
    if (failures.length === 1) {
      failure = failures[0]
    } else if (failures.length > 1) {
      failure = new SubagentError(
        `subagent "${childId}" activation teardown failed at ${failures.length} boundaries: `
        + failures.map(item => errorChain(item)).join('; '),
        'ACTIVATION_TEARDOWN_FAILED',
        { cause: new AggregateError(failures) },
      )
    }
    this.resident.delete(childId)
    this.notifySettlement(activation, activation.observer.terminal(failure))
    this.releaseOwnership(childId)
    activation.observer.settle(failure)
    if (failure !== undefined) throw failure
  }

  /**
   * Close admission and commit every live child's shutdown settlement, once.
   *
   * Runs when an unload of this registry's fiber or an ancestor is announced;
   * the call at the top of {@link ContinuableActivationRegistry.drain} then
   * does nothing.
   */
  private closeForShutdown(): void {
    if (this.draining) return
    this.draining = true
    this.commitSettlementsForShutdown()
  }

  /**
   * Commit a settlement row for every live child, synchronously (§12.41).
   *
   * Called once per teardown, from `closeForShutdown`. `commitIntake` is
   * synchronous (`BEGIN IMMEDIATE` on a `DatabaseSync`), so the whole write
   * lands before the bus's teardown can run. The stop reason is the one this
   * teardown is about to produce — the harness is going away, and that is what
   * happened to these children — rather than a terminal nobody has captured
   * yet: the capture happens later, in the drain, past the await where the bus
   * is no longer reachable.
   *
   * Idempotent against the normal path: when a child then settles inside this
   * same drain, `commitSettlement` finds the row already owed and does not add
   * a second. Nothing is delivered here; a tearing-down parent receives
   * nothing, which is what leaves the rows for the next start.
   */
  private commitSettlementsForShutdown(): void {
    const bus = this.bus
    if (bus === undefined) return
    for (const activation of this.resident.values()) {
      const epoch = activation.handle.agent.lifecycle?.epoch
      if (epoch === undefined || !activation.announced) continue
      try {
        commitSettlement(bus, {
          childId: activation.childId,
          parentSessionId: activation.parentSession,
          epoch,
          payload: settlementPayload(activation.childId, { stopReason: 'aborted' }, epoch),
          tenant: activation.parentSession,
          deadlineMs: Number.MAX_SAFE_INTEGER,
        })
      } catch (error: unknown) {
        // Logged, never thrown: a bus that cannot take this write must not stop
        // a teardown. The child's own session log remains the durable record.
        this.ctx.logger.warn(`subagent "${activation.childId}" settlement was not committed at shutdown: ${errorChain(error)}`)
      }
    }
  }

  /**
   * Deliver every settlement the durable bus owes one parent (§12.39).
   *
   * The single implementation behind all three triggers: a commit signalling
   * the target's driver, a parent starting, and a pre-step falling back. Each
   * can run when another already has, and the drain is idempotent — the
   * dispatch decision skips an acked record, and the parent's inbox refuses a
   * repeated `(source, id, epoch)`.
   *
   * Delivery uses the SAME insertion rules as a live settlement: an idle parent
   * gets one ordinary turn, a busy one is steered into its next batch, and a
   * parent whose lineage is tearing down declines — leaving the row pending for
   * whoever starts next rather than spending a retry on a moment nobody could
   * receive in. A composition with no bus mounted drains nothing.
   * @param parent - the live parent to deliver to.
   */
  private drainSettlementOutbox(parent: Agent): void {
    const bus = this.bus
    if (bus === undefined) return
    try {
      drainSettlements(bus, parent.id, Date.now(), SETTLEMENT_MAX_ATTEMPTS, (settlement) => {
        const message = settlementMessageOf(settlement)
        if (message === undefined) return false
        // Delivering into a tearing-down parent would wake an Agent its host is
        // about to dispose, and the row is better left owed (§12.39).
        if (this.closingTeardownFor(parent) !== undefined) return false
        this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
        return true
      })
    } catch (error: unknown) {
      // Logged, never thrown into a lifecycle edge: a bus that cannot be read
      // must not stop an agent from starting or stepping. The rows stay
      // pending, which is the recoverable direction.
      this.ctx.logger.warn(`subagent settlement drain for "${parent.id}" failed: ${errorChain(error)}`)
    }
  }

  /** Tell the durable direct parent how this Activation ended. */
  private notifySettlement(activation: Activation, terminal: ActivationTerminal): void {
    if (!activation.announced) return
    try {
      const epoch = activation.handle.agent.lifecycle?.epoch
      // Committed BEFORE any delivery attempt, and before the live-parent check
      // below. The cases that most need this notice — a token ceiling, a model
      // failure, a cancellation, a teardown — are the ones where the parent may
      // already be gone (acceptance[1]).
      const bus = this.bus
      if (bus !== undefined && epoch !== undefined) {
        commitSettlement(bus, {
          childId: activation.childId,
          parentSessionId: activation.parentSession,
          epoch,
          payload: settlementPayload(activation.childId, terminal, epoch),
          tenant: activation.parentSession,
          // A settlement does not expire: the parent's account of how its child
          // ended is as true a year later.
          deadlineMs: Number.MAX_SAFE_INTEGER,
        })
      }
      const parent = this.ctx.agents.get(activation.parentSession)
      // Trigger (1): the commit signals the target's driver. A live parent
      // takes it now, through the drain rather than beside it, so one delivery
      // path serves all three triggers.
      if (parent !== undefined && bus !== undefined && epoch !== undefined) {
        this.drainSettlementOutbox(parent)
        return
      }
      if (parent === undefined) return
      const message = createSettlementMessage(activation.childId, terminal, epoch)
      if (this.closingTeardownFor(parent) !== undefined) {
        parent.inject(message)
        return
      }
      this.sendWaking(parent, message, parent.status === 'idle' ? 'queue' : 'steer')
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `subagent "${activation.childId}" settlement notice was not delivered to its parent: `
        + errorChain(error),
      )
    }
  }

  /** Request a best-effort final session flush before closing natural-settlement admission. */
  private async flushFinalState(activation: Activation): Promise<void> {
    const child = activation.handle.agent
    try {
      await child.ctx.sessions.flush(child.session)
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `subagent "${activation.childId}" best-effort final session flush failed; `
        + `the persisted state may be unavailable or stale on resume: ${errorChain(error)}`,
      )
    }
  }
}
