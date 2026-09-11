/**
 * Workspace instruction loader for AGENTS.md-compatible files.
 *
 * Baseline instructions enter durable context before the first request; successful fs
 * tool touches project nested, changed, and removed instructions into the inbox.
 * Plugin lifecycle reads use the optional `ctx.fs` provider, so providerless products
 * mount it as a no-op.
 *
 * @module @deepseek-ai/dsh-agent-instructions
 */

import type { Context } from '@deepseek-ai/cordis'
import { isDeepStrictEqual } from 'node:util'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: the `approval` Context augmentation this file reads through
// `ctx.get('approval')` lives in that package, and an augmentation not imported
// is an augmentation the compiler resolves by luck.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ToolExecution, ToolExecutionResult, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { Config, resolveConfig, workspaceBaselineIdentity, type ResolvedConfig } from './config.ts'
import { authorizeProjectLoad } from '@deepseek-ai/dsh-workspace-trust'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'
import { attachedIdentity } from '@deepseek-ai/dsh-session'
import { findProjectRoot, loadBaselineInstructionSet } from './files.ts'
import {
  applyInstructionVersionUpdates,
  baselineInstructionState,
  name,
  reconcileInstructionContext,
  workspaceContextMessage,
  type InstructionVersionCache,
  type AgentInstructionSource,
} from './state.ts'
import type { AgentInstructionChange } from './render.ts'

export { Config, name }

/**
 * Resolve the workspace's trust, putting must[2]'s question to the host user
 * the first time this session would load an untrusted workspace's own
 * instruction files.
 *
 * Asked HERE rather than at boot because launching `dsh` in a directory is not
 * the user's act of trusting it — the directory an attacker hands you is
 * exactly the one you were launched in — and because `approval.request()` is
 * turn-bound: a question asked between turns cannot produce the
 * `approval/asked` + `approval/decided` pair that makes it auditable.
 *
 * Only `'trusted-read'` is asked for. Executing what a project supplied is a
 * separate answer with a different consequence, and granting it on the same
 * yes would be the kind of default this epic exists to refuse.
 *
 * Every failure direction leaves the workspace untrusted: no provider, no
 * approval service, no answerer (`'unavailable'`), a refusal, a non-host
 * principal, or an abort. That is the same direction the gate already had, so
 * a composition that cannot ask behaves exactly as it did before this
 * question existed.
 * @param ctx - the plugin context, for the optional trust and approval services.
 * @param agent - the agent whose session asks and whose principal authorizes.
 * @param projectRoot - the resolved project root whose trust is in question.
 * @param asked - sessions already asked, so a decline is not re-put every step.
 * @param signal - the step's cancellation lifetime.
 * @returns the trust state to gate on, or undefined when no provider is mounted.
 */
async function askForReadTrustOnce(
  ctx: Context,
  agent: Agent,
  projectRoot: string,
  asked: WeakSet<Session>,
  signal: AbortSignal,
): Promise<TrustState | undefined> {
  const trust = ctx.get('workspaceTrust')
  if (trust === undefined) return undefined
  const state = await trust.stateFor(projectRoot)
  if (state !== 'untrusted' || asked.has(agent.session)) return state
  const approval = ctx.get('approval')
  if (approval === undefined) return state
  const principal = attachedIdentity(agent.session)?.principal
  // Marked asked only once there is someone to ask ON BEHALF OF. Marking it
  // before this check spent the session's one question on a step that could
  // never put it, so a session that later gained an identity would never be
  // asked (BLOCKED-200 found the absence; this was the bug it exposed here).
  if (principal === undefined) return state
  asked.add(agent.session)
  const outcome = await approval.request({
    agent,
    // The name of what is being decided. Not a callable tool, and the field
    // does not require one: what it must not be is empty.
    toolName: 'workspace-trust',
    subject: `${projectRoot}: trusted-read`,
    reason: 'Load this project\'s own instruction files? They are supplied by the directory you opened, '
      + 'and have not been trusted before.',
    signal,
  })
  if (outcome !== 'allowed-once') return state
  const result = await trust.grantTrust(projectRoot, 'trusted-read', principal)
  return result.upgraded ? result.record.state : state
}

/** Services required by workspace instruction projection. */
export const inject = ['sessionProjections']
export {
  discoverBaselineInstructionFiles,
  loadBaselineInstructions,
} from './files.ts'
export type {
  InstructionFile,
  LoadedInstructionFile,
} from './files.ts'
export { renderWorkspaceContext } from './render.ts'
export type { RenderedWorkspaceContext, TruncatedInstruction } from './render.ts'

function visibleBaselineSource(
  agent: Agent,
  authorityMessages: readonly UserMessage[],
): AgentInstructionSource | undefined {
  for (const message of authorityMessages.toReversed()) {
    if (message.source.kind === 'agent-instructions' && message.source.baseline === true) {
      return message.source
    }
  }
  for (const seq of agent.session.surface.nodes.toReversed()) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'user/message'
      && event.data.source.kind === 'agent-instructions'
      && event.data.source.baseline === true) return event.data.source
  }
  return undefined
}

function isWorkspaceContext(message: UserMessage): boolean {
  return message.source.kind === 'agent-instructions'
}

function sameContextPayload(left: UserMessage, right: UserMessage): boolean {
  return isDeepStrictEqual(left.content, right.content)
    && isDeepStrictEqual(left.source, right.source)
}

const FILE_TOUCH_TOOL_NAMES = new Set(['read', 'write', 'edit'])

function filePathFromExecution(exec: ToolExecution): string | undefined {
  if (!FILE_TOUCH_TOOL_NAMES.has(exec.name)) return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  if (!('file_path' in exec.arguments) || typeof exec.arguments.file_path !== 'string') return undefined
  const filePath = exec.arguments.file_path.trim()
  return filePath.length > 0 ? filePath : undefined
}

export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = resolveConfig(config)
  const instructionVersions: InstructionVersionCache = new WeakMap()
  const baselinePreparations = new WeakMap<Session, {
    identity: string
    excludedScopes: ReadonlySet<string>
  }>()
  const projectionLifecycle = new AbortController()
  type ProjectionTouch = { agent: Agent; path: string }
  const executionTouches = new Map<ToolExecutionToken, ProjectionTouch[]>()
  ctx.effect(
    () => () => {
      projectionLifecycle.abort(new Error('agent-instructions disposed'))
      executionTouches.clear()
    },
    'agent-instructions.projectionLifecycle',
  )
  // Emit listeners are not awaited, so each projection must compose against the
  // inbox produced by earlier file results for the same agent.
  const projectionTails = new WeakMap<Agent, Promise<void>>()
  // Sessions this plugin has already put the trust question to. A host user
  // who declined is not asked again on the next step: a prompt that returns
  // every step is one a user learns to dismiss, which is worse than not
  // asking. A user who accepted is not asked again either, because the grant
  // is durable and `stateFor` no longer answers `'untrusted'`.
  const trustAsked = new WeakSet<Session>()
  // Execution ancestry and the enclosing durable step are the two commit
  // boundaries before an asynchronous projection may mutate the agent inbox.
  const stepTouches = new WeakMap<Session, ProjectionTouch[]>()

  const compose = async (
    agent: Agent,
    signal: AbortSignal,
    claimed: readonly UserMessage[],
    pending: readonly UserMessage[],
    touchedPaths: readonly string[] = [],
  ): Promise<UserMessage | undefined> => {
    signal.throwIfAborted()
    if (resolved.maxBytes <= 0 || !Number.isFinite(resolved.maxBytes)) {
      return undefined
    }
    const fileSystem = ctx.get('fs')
    if (fileSystem === undefined) return undefined
    if (touchedPaths.length === 0 && pending.length > 0) return pending[0]
    const content: UserMessage['content'][number][] = []
    const changes: AgentInstructionChange[] = []
    let desiredBaseline = false
    const authorityMessages = [...claimed]
    /* v8 ignore next -- normal agents carry an absolute session cwd. */
    const cwd = agent.session.header.cwd ?? process.cwd()
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers, fileSystem, signal)
    // Epic P1-07 must[1]: the workspace's own instruction files are content the
    // project supplied. With no `workspaceTrust` provider mounted nothing is
    // gated and every candidate loads as it did before this boundary existed.
    const trustState = await askForReadTrustOnce(ctx, agent, projectRoot, trustAsked, signal)
    const projectInstructionsPermitted = trustState === undefined
      || authorizeProjectLoad(trustState, 'project-instructions').permitted
    // The trust state participates in the baseline identity, so a downgrade
    // invalidates the visible baseline and forces it to be recomposed without the
    // project's instructions instead of leaving already-injected ones in place
    // (acceptance[2]: a downgrade revokes immediately, not at the next session).
    const identity = `${workspaceBaselineIdentity(resolved, cwd, projectRoot)}\0${trustState ?? 'ungated'}`
    const visibleBaseline = visibleBaselineSource(agent, authorityMessages)
    const baselinePresent = visibleBaseline !== undefined
    const keepVisibleBaseline = visibleBaseline?.baselineIdentity === identity
    const prepared = baselinePreparations.get(agent.session)
    let excludedBaselineScopes = keepVisibleBaseline && prepared?.identity === identity
      ? prepared.excludedScopes
      : undefined
    let nextPreparation: { identity: string; excludedScopes: ReadonlySet<string> } | undefined
    if (!baselinePresent || !keepVisibleBaseline || excludedBaselineScopes === undefined) {
      const replacePreviousBaseline = baselinePresent && !keepVisibleBaseline
      const instructions = await loadBaselineInstructionSet({
        cwd,
        dshHome: resolved.dshHome,
        projectRootMarkers: resolved.projectRootMarkers,
        maxBytes: resolved.maxBytes,
        maxSourceBytes: resolved.maxSourceBytes,
        instructionFileCandidates: resolved.instructionFileCandidates,
        localInstructionFileCandidates: resolved.localInstructionFileCandidates,
        projectRoot,
        replacePreviousBaseline,
        signal,
        ...trustState === undefined ? {} : { trustState },
      }, fileSystem)
      const baseline = baselineInstructionState(instructions?.included ?? [])
      const observedBaseline = baselineInstructionState(instructions?.observed ?? [])
      const excludedScopes = new Set(observedBaseline.changes.keys())
      for (const scope of baseline.changes.keys()) excludedScopes.delete(scope)
      excludedBaselineScopes = excludedScopes
      nextPreparation = { identity, excludedScopes }
      let versionStates = instructionVersions.get(agent.session)
      if (versionStates === undefined && baseline.versions.size > 0) {
        versionStates = new Map()
        instructionVersions.set(agent.session, versionStates)
      }
      for (const [scope, state] of baseline.versions) versionStates?.set(scope, state)
      if (!keepVisibleBaseline && instructions !== undefined && instructions.rendered.text.length > 0) {
        const baselineContent = workspaceContextMessage(instructions.rendered.text).content
        content.push(...baselineContent)
        const replacementScopes = new Set(baseline.changes.keys())
        const replacementRemovals = replacePreviousBaseline
          ? visibleBaseline.changes.flatMap(change => (
            change.action === 'remove' || replacementScopes.has(change.scope)
              ? []
              : [{ action: 'remove' as const, scope: change.scope, path: change.path }]
          ))
          : []
        const baselineChanges = [...replacementRemovals, ...baseline.changes.values()]
        changes.push(...baselineChanges)
        authorityMessages.push(createUserMessage({
          content: baselineContent,
          source: {
            kind: 'agent-instructions',
            form: 'instructions',
            baseline: true,
            baselineIdentity: identity,
            changes: baselineChanges,
          },
        }))
        desiredBaseline = true
      }
    }
    const update = await reconcileInstructionContext(
      agent,
      resolved,
      instructionVersions,
      fileSystem,
      {
        authorityMessages,
        scopeMessages: pending,
        includeBaselineScopes: keepVisibleBaseline,
        ...keepVisibleBaseline ? { excludedBaselineScopes } : {},
        // A workspace whose instructions are not permitted contributes no
        // touched-path scopes either: nested project instruction files reached
        // through a tool touch are the same project-supplied content the
        // baseline gate above refuses.
        touchedPaths: projectInstructionsPermitted ? touchedPaths : [],
        projectRoot,
        signal,
      },
    )
    if (update !== undefined) {
      content.push(...update.context.content)
      /* v8 ignore next -- reconciliation constructs only agent-instructions contexts. */
      if (update.context.source.kind === 'agent-instructions') {
        changes.push(...update.context.source.changes)
      }
      applyInstructionVersionUpdates(agent.session, update.versionUpdates, instructionVersions)
    }
    if (nextPreparation !== undefined) baselinePreparations.set(agent.session, nextPreparation)
    if (content.length === 0) return undefined
    return createUserMessage({
      content,
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        ...desiredBaseline ? { baseline: true } : {},
        ...desiredBaseline ? { baselineIdentity: identity } : {},
        changes,
      },
    })
  }

  const syncInbox = (agent: Agent, claimed: readonly UserMessage[], desired: UserMessage | undefined): void => {
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    const alreadySupplied = desired !== undefined && (
      claimed.some(message => sameContextPayload(message, desired))
      || agent.session.surface.nodes.some((seq) => {
        const event = agent.session.eventAt(seq)
        return event?.type === 'user/message' && sameContextPayload(event.data, desired)
      })
    )
    if (desired === undefined || alreadySupplied) {
      for (const message of pending) agent.inbox.remove(message.id)
      return
    }
    const reusable = pending.find(message => sameContextPayload(message, desired))
    if (reusable !== undefined) {
      for (const message of pending) {
        if (message !== reusable) agent.inbox.remove(message.id)
      }
      return
    }
    const replaced = pending[0]
    if (replaced === undefined) agent.inbox.prepend('next-step', desired)
    else agent.inbox.replace(replaced.id, desired)
    for (const message of pending.slice(1)) agent.inbox.remove(message.id)
  }

  const composeAndSync = async (
    agent: Agent,
    signal: AbortSignal,
    claimed: readonly UserMessage[],
    touchedPaths: readonly string[] = [],
  ): Promise<void> => {
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    const desired = await compose(agent, signal, claimed, pending, touchedPaths)
    signal.throwIfAborted()
    syncInbox(agent, claimed, desired)
  }

  const queueProjection = (
    agent: Agent,
    touchedPath: string,
  ): void => {
    const previous = projectionTails.get(agent) ?? Promise.resolve()
    const current = previous.then(() => composeAndSync(agent, projectionLifecycle.signal, [], [touchedPath]))
      .catch((error: unknown) => {
        if (!projectionLifecycle.signal.aborted) ctx.logger.warn('workspace instruction refresh failed: %o', error)
      })
    projectionTails.set(agent, current)
    void current.then(() => {
      if (projectionTails.get(agent) === current) projectionTails.delete(agent)
    })
  }

  const waitForProjections = async (agent: Agent): Promise<void> => {
    let projection: Promise<void> | undefined
    while ((projection = projectionTails.get(agent)) !== undefined) await projection
  }

  const stepIsOpen = (session: Session): boolean => {
    const boundary = ctx.sessionProjections.stateOf(session, 'turnBoundary')
    if (boundary === undefined) {
      throw new Error('agent-instructions requires the turnBoundary session projection')
    }
    return boundary.openTurnStartSeq !== null
      && boundary.lastStepBoundary?.kind === 'start'
      && boundary.lastStepBoundary.seq > boundary.openTurnStartSeq
  }

  const projectTouch = (touch: ProjectionTouch): void => {
    const session = touch.agent.session
    if (!stepIsOpen(session)) {
      queueProjection(touch.agent, touch.path)
      return
    }
    const pending = stepTouches.get(session)
    if (pending === undefined) stepTouches.set(session, [touch])
    else pending.push(touch)
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'step/end') return
    const pending = stepTouches.get(session)
    if (pending === undefined) return
    stepTouches.delete(session)
    for (const touch of pending) queueProjection(touch.agent, touch.path)
  })

  ctx.on('agent/pre-step', async (
    { agent, messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    await waitForProjections(agent)
    const pending = agent.inbox.nextStep.filter(isWorkspaceContext)
    const desired = await compose(agent, signal, messages, pending)
    signal.throwIfAborted()
    // An empty first entry owns a no-step turn; keep context pending instead
    // of turning it into a standalone request. Later entries may be tool continuations.
    if (decision.kind === 'reject' || (step === 1 && decision.messages.length === 0)) {
      syncInbox(agent, messages, desired)
      return decision
    }
    // A proceeding step settles the pending context: it either enters below as
    // `desired`, or its payload is already covered by the batch, so nothing stays pending.
    for (const message of pending) agent.inbox.remove(message.id)
    if (desired === undefined || decision.messages.some(message => sameContextPayload(message, desired))) {
      return decision
    }
    // Fold the context right after the claimed batch, so the direct prompt
    // precedes it and the driver-appended runtime context follows it.
    const lastClaimedIndex = decision.messages.findLastIndex(message => messages.includes(message))
    const entered = decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired)
    return { ...decision, messages: entered }
  })

  ctx.on('tools/result', (exec: ToolExecution, result: ToolExecutionResult) => {
    const touches = executionTouches.get(exec.token) ?? []
    executionTouches.delete(exec.token)
    if (!result.isError && exec.agent !== undefined && !exec.signal.aborted) {
      const ownPath = filePathFromExecution(exec)
      if (ownPath !== undefined) touches.push({ agent: exec.agent, path: ownPath })
    }
    if (exec.parent !== undefined) {
      if (touches.length > 0) {
        const parentTouches = executionTouches.get(exec.parent)
        if (parentTouches === undefined) executionTouches.set(exec.parent, touches)
        else parentTouches.push(...touches)
      }
      return
    }
    for (const touch of touches) projectTouch(touch)
  })
}
