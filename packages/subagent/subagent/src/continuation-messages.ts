/**
 * Model-visible messages owned by continuable-subagent orchestration.
 *
 * @module @deepseek-ai/dsh-subagent/continuation-messages
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ActivationTerminal } from './lifecycle.ts'
import type { PendingSettlement } from './settlement-outbox.ts'
import type { SubagentResult } from './types.ts'

/** Durable attribution for one model-authored message between adjacent Agents. */
export interface AgentMessageSource {
  readonly kind: 'agent-message'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the Agent whose tool call produced the message. */
  readonly senderSessionId: SessionId
}

/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link AgentMessageSource}: an Agent message is content the sender chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
export interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
  /**
   * The lease epoch of the child run this settlement reports (P4-06 must[2],
   * P4-07).
   *
   * The sender's GENERATION, which is what separates a redelivered settlement
   * from a real second one: one child session may be activated more than once,
   * and each activation holds its own lease. Without it the parent's inbox
   * cannot tell "this notice again" from "the same child settled again", and
   * must[2]'s triple has only two thirds of its identity.
   *
   * Absent when the child held no lease — a composition with no Run Service
   * mounted. That is recorded rather than defaulted: an invented epoch would
   * make two unrelated activations share a key and silently suppress one.
   */
  readonly senderEpoch?: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-message': AgentMessageSource
    'subagent-settled': SubagentSettledMessageSource
  }
}

/** Build durable attribution for one adjacent-Agent message. */
function agentMessageSource(sender: Agent): AgentMessageSource {
  return {
    kind: 'agent-message',
    form: 'relay',
    senderSessionId: sender.id,
  }
}

/**
 * Build the model-visible and durable representation of one adjacent-Agent message.
 * @param sender - exact live Agent that authored the message.
 * @param content - model-visible message blocks supplied by the sender.
 * @returns the durable user-message representation delivered to the recipient.
 */
export function createAgentMessage(
  sender: Agent,
  content: ContentBlock[],
): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [
      { type: 'text' as const, text: `Agent ${sender.id} sent a message: ` },
      ...content,
    ],
    source: agentMessageSource(sender),
  })
}

/**
 * Append adjacent-Agent return guidance to a continuable child's initial task.
 * @param parentId - durable parent session id named in the guidance.
 * @param prompt - initial model-visible task blocks.
 * @returns task blocks followed by the continuable return guidance.
 */
export function withContinuableReturnGuidance(
  parentId: SessionId,
  prompt: ContentBlock[],
): ContentBlock[] {
  const encodedParentId = JSON.stringify(parentId)
  return [
    ...prompt,
    {
      type: 'text',
      text: `Your parent agent id is ${encodedParentId}. Before you finish, send your result to that agent with `
        + `send_message({ agent_id: ${encodedParentId}, message: "<self-contained result>" }). The parent shares `
        + 'your workspace but does not automatically receive your transcript, tool output, or reasoning. Send '
        + 'earlier messages as well when a finding changes what the parent should do next; sending a message '
        + 'does not end your turn.',
    },
  ]
}

/**
 * One line telling a parent that a background child is finished and why, in
 * the parent's own task vocabulary.
 * @param childId - the durable child the parent knows by id.
 * @param stopReason - how the child's last ordinary turn ended.
 * @returns the model-facing opening line of the settlement notice.
 */
function settlementSummary(childId: SessionId, stopReason: SubagentResult['stopReason']): string {
  const subject = `Background subagent ${childId}`
  switch (stopReason) {
    case 'completed':
      return `${subject} finished and will do no further work unless you send it more.`
    case 'aborted':
      return `${subject} was stopped before it finished.`
    case 'max-tokens':
      return `${subject} ran out of room before it finished.`
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // the child had claimed, so the parent must not treat the task as done.
    case 'refusal':
      return `${subject} declined the task.`
    case 'error':
      return `${subject} failed before it finished.`
    /* v8 ignore next 4 -- `SubagentResult['stopReason']` is merge-extensible, so this arm
     * needs a backend that adds a variant; an unnameable ending is reported as unfinished
     * rather than silently as success. */
    default:
      return `${subject} ended abnormally (${String(stopReason)}) before it finished.`
  }
}

/**
 * The notice content one settlement carries.
 *
 * One definition, used by the committed payload and by the direct delivery:
 * two copies would let the message a parent reads through the bus drift from
 * the one it reads without it, and nothing would notice until a reader
 * compared two transcripts.
 * @param terminal - how the epoch ended.
 * @param summary - the one-line account of that ending.
 * @returns the blocks the parent is shown.
 */
function settlementContent(terminal: ActivationTerminal, summary: string): ContentBlock[] {
  return [
    { type: 'text' as const, text: summary },
    ...terminal.output === undefined
      ? [{ type: 'text' as const, text: 'It left no closing message.' }]
      : [{ type: 'text' as const, text: 'Its closing message:' }, ...terminal.output],
  ]
}

/**
 * Build the runtime-owned settlement notice delivered to a child's parent.
 * @param childId - durable child session id named in the notice.
 * @param terminal - recorded terminal state for the settled Activation.
 * @param epoch - the settled run's lease epoch; absent when the child held no lease.
 * @returns the durable user-message representation delivered to the parent.
 */
export function createSettlementMessage(
  childId: SessionId,
  terminal: ActivationTerminal,
  epoch?: number,
): ReturnType<typeof createUserMessage> {
  const summary = settlementSummary(childId, terminal.stopReason)
  return createUserMessage({
    content: settlementContent(terminal, summary),
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: boundContextSummary(summary),
      senderSessionId: childId,
      ...epoch === undefined ? {} : { senderEpoch: epoch },
    },
  })
}

/**
 * The payload one committed settlement row carries, from which
 * {@link settlementMessageOf} rebuilds the notice {@link createSettlementMessage} builds.
 * @param childId - durable child session id named in the notice.
 * @param terminal - how the epoch ended.
 * @param epoch - the settled run's lease epoch, which keys the row.
 * @returns the summary, content, and epoch committed to the durable bus.
 */
export function settlementPayload(
  childId: SessionId,
  terminal: ActivationTerminal,
  epoch: number,
): { readonly summary: string; readonly content: ContentBlock[]; readonly epoch: number } {
  const summary = settlementSummary(childId, terminal.stopReason)
  return { summary, content: settlementContent(terminal, summary), epoch }
}

/**
 * Rebuild the parent-facing notice from what the bus stored.
 *
 * The message is rebuilt rather than stored whole: a `UserMessage` carries an
 * id minted per delivery, and the inbox deduplicates on the SENDER's identity
 * — `(kind, senderSessionId, senderEpoch)` — not on that id. Storing one would
 * persist a value that must not be reused and that nothing reads.
 * @param settlement - the pending row, as the drain read it.
 * @returns the message to insert, or `undefined` when the payload is not one.
 */
export function settlementMessageOf(settlement: PendingSettlement): ReturnType<typeof createUserMessage> | undefined {
  const payload = settlement.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const { summary, content, epoch } = payload as { summary?: unknown; content?: unknown; epoch?: unknown }
  if (typeof summary !== 'string' || !Array.isArray(content)) return undefined
  return createUserMessage({
    content: content as ContentBlock[],
    source: {
      kind: 'subagent-settled' as const,
      form: 'notice' as const,
      summary: boundContextSummary(summary),
      senderSessionId: settlement.childId,
      ...typeof epoch === 'number' ? { senderEpoch: epoch } : {},
    },
  })
}
