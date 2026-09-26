/**
 * Opt-in durable memory recall context: the Consumer role of the
 * provider-neutral Memory capability seam (first100 registry P6-01, Usage
 * stage). On each eligible step it reads the open turn's user text, asks
 * `ctx.memory` — the Service Definition, never an imported provider or
 * runtime class (`must[2]`) — for the records that text recalls, appends them
 * to the request as a durable, source-attributed user message, and records
 * one `memory/access` event for that read.
 *
 * Model-visible and logged are one act here, never two: the injection and its
 * `memory/access` event are produced from the same read result on the same
 * path, so a memory record the model saw is always reconstructable from the
 * session log alone (registry P6-01 validation[3]).
 *
 * @module @deepseek-ai/dsh-memory-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createAnonymousDevPrincipal, currentPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import type { MemoryAccessContext, MemoryRecordView, WorkspaceMemoryScope } from '@deepseek-ai/dsh-memory'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'

/** Cordis plugin name used by loader diagnostics and as this plugin's `user/message` source attribution. */
export const name = 'memory-context'

/** The Memory Service Definition and the agent registry that owns pre-step processing. */
export const inject = ['agents', 'memory']

/**
 * Read scoping this consumer applies to every memory read it performs. Every
 * field is required: `must[3]` puts `principal`, `purpose`, `scope`, and
 * `contextBudget` on every read, so a composition that omits one is a
 * misconfiguration and fails loud at load rather than silently reading
 * unscoped.
 */
export interface Config {
  /** Tenant this consumer reads within; becomes `MemoryScope.tenantId`. */
  tenantId: string
  /** Principal id used when the agent carries no attached `IdentityContext`; see {@link resolveMemoryAccessContext}. */
  principalId: string
  /** Why this consumer reads, recorded on every `memory/access` event. */
  purpose: string
  /** Upper bound on recalled records; becomes `MemoryContextBudget.maxRecords`. */
  maxRecords: number
}

/** Schemastery validation for {@link Config}. Every field is required. */
export const Config: z<Config> = z.object({
  tenantId: z.string().required(),
  principalId: z.string().required(),
  purpose: z.string().required(),
  maxRecords: z.number().required(),
})

/**
 * Build the complete {@link MemoryAccessContext} this consumer reads under.
 *
 * The principal is the agent's own when a prior run durably attached an
 * `IdentityContext` to the session (first100 registry P2-01); otherwise it is
 * an `anonymous-dev` principal built from `config.principalId` and
 * `config.tenantId`. That fallback is an explicit resolve step over declared
 * config, never a hidden default: nothing in a shipped profile attaches an
 * `IdentityContext` today, so a consumer that simply required one could never
 * read at all.
 *
 * An attached principal from a tenant other than the configured one is
 * refused rather than silently widening or narrowing the read boundary —
 * `must[3]` makes the scope part of the read's meaning, so disagreement about
 * it is a misconfiguration, not something to settle by preference.
 * @param agent - the agent whose step is being prepared; supplies the attached identity when it has one.
 * @param config - this plugin's validated configuration.
 * @throws when the agent's attached identity names a tenant other than `config.tenantId`.
 * @returns the access context every read this consumer performs is scoped by.
 */
export async function resolveMemoryAccessContext(agent: Agent, config: Config): Promise<MemoryAccessContext> {
  const tenantId = TenantId(config.tenantId)
  const attached = agent.identity === undefined ? undefined : currentPrincipal(agent.identity.chain)
  if (attached !== undefined && attached.tenantId !== tenantId) {
    throw new Error(
      `memory-context: the agent's attached principal belongs to tenant "${attached.tenantId}", `
      + `but this plugin is configured to read within tenant "${config.tenantId}"`,
    )
  }
  const workspace = await observeWorkspaceMemoryScope(agent)
  return {
    principal: attached ?? createAnonymousDevPrincipal(PrincipalId(config.principalId), tenantId),
    purpose: config.purpose,
    scope: { tenantId, ...workspace === undefined ? {} : { workspace } },
    contextBudget: { maxRecords: config.maxRecords },
  }
}

/**
 * The workspace this agent's session is working in, as memory scopes it.
 *
 * Records match on the directory's FILESYSTEM IDENTITY rather than its path, so
 * a directory replaced in place does not inherit what the one it displaced
 * wrote. The identity is flattened to a string here because
 * `@deepseek-ai/dsh-memory` holds it opaquely and stays free of the workspace
 * package; this consumer is the one that can observe it.
 *
 * Absent when the session has no `cwd`, or when the directory cannot be
 * observed at all. A reader with no workspace sees only records written without
 * one, so an unobservable directory reads a small, well-defined pool rather
 * than another workspace's — the same direction `@deepseek-ai/dsh-workspace`
 * takes when it treats an unobservable directory as untrusted rather than
 * unchanged.
 * @param agent - the agent whose session names the working directory.
 * @returns the workspace scope, or `undefined` when none can be observed.
 */
async function observeWorkspaceMemoryScope(agent: Agent): Promise<WorkspaceMemoryScope | undefined> {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) return undefined
  try {
    const observed = await observeWorkspaceIdentity(cwd)
    return {
      canonicalPath: observed.canonicalPath,
      identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
    }
  } catch {
    // `observeWorkspaceIdentity` rejects with the underlying realpath/stat
    // failure when the directory does not resolve — deleted, or never created.
    // Nothing else can reach here: the only call is the one above, and a
    // directory that cannot be observed has no identity to scope by.
    return undefined
  }
}

/**
 * Render recalled records as the exact text the model reads.
 * @param records - the records the memory read returned, already capped to the caller's budget.
 * @param truncated - whether the seam cut the result down to `contextBudget.maxRecords`.
 * @returns the model-visible snapshot text, or `undefined` when there is nothing to recall.
 */
export function renderMemoryContext(records: readonly MemoryRecordView[], truncated: boolean): string | undefined {
  if (records.length === 0) return undefined
  const lines = records.map(record => `- (${record.updatedAt}) ${JSON.stringify(record.content)}`)
  const header = `Recalled ${String(records.length)} durable memory record(s):`
  const footer = truncated
    ? '\nThis recall was truncated to the configured record budget; more records may exist.'
    : ''
  return `${header}\n${lines.join('\n')}${footer}`
}

/**
 * The text that supersedes an earlier recall snapshot when a later step recalls
 * nothing (P6-03 acceptance[1]).
 *
 * A recall is a durable, `snapshot`-form message, so the request keeps only the
 * latest one this plugin produced (`ContextForm` 'snapshot' in
 * `@deepseek-ai/dsh-llm`: a later snapshot from the same producer supersedes the
 * earlier). Once a record a step recalled is forgotten, a later step that
 * recalls nothing must still
 * emit a snapshot — this one — so the forgotten content does not ride the
 * earlier snapshot into the session's later model requests. Its content is a
 * fixed marker, so it holds none of what was recalled.
 */
const CLEARED_RECALL = 'No durable memory was recalled for this step; earlier memory-recall snapshots no longer apply.'

/**
 * The recall snapshot this consumer appends: a `snapshot`-form user message
 * whose producer is this plugin, so the request retains only its latest one.
 * @param text - the rendered recall, or {@link CLEARED_RECALL} to supersede an earlier recall with nothing.
 * @returns the message to append.
 */
function recallSnapshot(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
  })
}

/**
 * Whether this consumer left an outstanding recall snapshot on `agent`'s
 * session that a later step must supersede — judged from the DURABLE session
 * log, not per-instance memory, so it survives a resume (P6-03 acceptance[1]).
 *
 * The latest memory-context `snapshot`-form message in the log is outstanding
 * unless it is already the {@link CLEARED_RECALL} marker; a session this
 * consumer never recalled on has none. The scan stops at the first
 * memory-context snapshot from the newest end, so a session that recalls
 * regularly answers in a few steps.
 * @param agent - the agent whose session log to scan.
 * @returns whether an un-cleared recall snapshot is the latest this consumer left.
 */
function hasOutstandingRecall(agent: Agent): boolean {
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type !== 'user/message') continue
    // Every message this consumer emits is a memory-recall snapshot, so its
    // plugin source identifies one without inspecting the form.
    const source = event.data.source
    if (source.kind !== 'plugin' || source.plugin !== name) continue
    const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    return text !== CLEARED_RECALL
  }
  return false
}

/**
 * Collect the text of the open turn's user-authored messages — the query this
 * consumer recalls against.
 *
 * Plugin-sourced messages are excluded. The request history at pre-step time
 * also holds other context plugins' injected snapshots (runtime context,
 * sandbox and approval policy prose, this plugin's own prior recall); folding
 * those into the query would make what memory recalls depend on unrelated
 * policy text, and would let one recall's output become the next recall's
 * input.
 * @param agent - the agent whose open turn is being prepared.
 * @param turn - the open turn number.
 * @param proposed - user messages this step has proposed but not yet entered.
 * @returns the concatenated user-authored text of the open turn, empty when the turn has none.
 */
export function openTurnQuery(agent: Agent, turn: number, proposed: readonly UserMessage[]): string {
  const entered: UserMessage[] = []
  for (let seq = agent.session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(seq))
    if (event?.type === 'turn/start' && event.data.turn === turn) break
    if (event?.type === 'user/message') entered.push(event.data)
  }
  return [...entered.reverse(), ...proposed]
    .filter(message => message.source.kind !== 'plugin')
    .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
    .join('\n')
}

/**
 * Register the prepended pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param config - the read scoping this consumer applies to every memory read.
 * @returns Nothing.
 */
/**
 * Tell a session, once, that its workspace path holds memory an earlier
 * occupant of that path wrote.
 *
 * Emitted on the first recall that actually happens rather than at session
 * start: the notice is only meaningful once this consumer has read memory and
 * found the session's own workspace empty, and a session-start event would
 * describe storage before anything had consulted it.
 *
 * Silent when the count is zero, because "your workspace was rebuilt" is false
 * of a workspace that never was — an unconditional notice would make every
 * session claim it.
 * @param ctx - the plugin context holding the memory seam.
 * @param agent - the agent whose session is told.
 * @param accessContext - the context this consumer just read under.
 * @param announced - sessions already told, so the notice is not repeated.
 * @returns Nothing.
 */
export async function announceRebuiltWorkspace(
  ctx: Context,
  agent: Agent,
  accessContext: MemoryAccessContext,
  announced: Set<string>,
): Promise<void> {
  const workspace = accessContext.scope.workspace
  if (workspace === undefined || announced.has(agent.session.id)) return
  announced.add(agent.session.id)
  const count = await ctx.memory.countRebuiltAt({
    accessContext,
    canonicalPath: workspace.canonicalPath,
    currentIdentity: workspace.identity,
  })
  if (count === 0) return
  agent.session.append('memory/workspace-rebuilt', { canonicalPath: workspace.canonicalPath, count })
}

export function apply(ctx: Context, config: Config): void {
  // Sessions that have already been told their workspace looks rebuilt. The
  // notice is a fact about storage, so it is worth saying once and noise on
  // every step after that; the set is per-plugin-instance and disposes with it.
  const announced = new Set<string>()
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const query = openTurnQuery(agent, turn, decision.messages)
    let text: string | undefined
    if (query.trim() !== '') {
      const accessContext = await resolveMemoryAccessContext(agent, config)
      const { records, truncated } = await ctx.memory.query({ accessContext, query })
      // Recorded whether or not anything was recalled: a read that returned
      // nothing is still a read of durable memory, and a log that omitted it
      // would misrepresent what this consumer did.
      agent.session.append('memory/access', {
        operation: 'query',
        accessContext,
        resultCount: records.length,
        truncated,
      })
      await announceRebuiltWorkspace(ctx, agent, accessContext, announced)
      text = renderMemoryContext(records, truncated)
    }
    if (text !== undefined) {
      return { ...decision, messages: [...decision.messages, recallSnapshot(text)] }
    }
    // Nothing recalled this step — an empty open-turn query, or a query that
    // matched nothing. If an earlier step left a recall snapshot on this
    // session, supersede it with a cleared marker so a record forgotten since
    // is not carried into the session's later requests, whether or not this
    // step queried and across a resume (`hasOutstandingRecall` reads the durable
    // log). A session this consumer never recalled on adds nothing, so a boot
    // with recall enabled but nothing to recall hands the model the same bytes
    // as one with the rows disabled.
    if (hasOutstandingRecall(agent)) {
      return { ...decision, messages: [...decision.messages, recallSnapshot(CLEARED_RECALL)] }
    }
    return decision
  }, { prepend: true })
}
