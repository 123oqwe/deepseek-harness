/**
 * `dsh audit approval` (Epic P2-06 validation[2], BLOCKED-280): the host user
 * finds, in a stored session's log, the approval a dispatched action was
 * decided by.
 *
 * A dispatch's action id is its tool call id; the `approval/bound` record of
 * the ask about it carries that id as `actionId`, and the record's `id` names
 * the approval, which pairs it with the `approval/asked` and
 * `approval/decided` events of the same ask. The log is read through
 * `ctx.sessionQuery.readSession`, which replay-validates it and never makes
 * the session live, so the lookup changes nothing. The lookup reports what the
 * log records; it does not re-decide which record a dispatch would have used.
 * @module @deepseek-ai/dsh/audit
 */

import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-user-approval'
import { runProfile } from './profile-boot.ts'

const NAME = 'dsh'

/** Exit code when the log records exactly one approval for the action. */
export const AUDIT_FOUND = 0
/** Exit code when the log records no approval for the action. */
export const AUDIT_NOT_FOUND = 3
/** Exit code when the log records more than one approval for the action; every one is printed. */
export const AUDIT_AMBIGUOUS = 4

/** One approval an action was decided by, as `dsh audit approval` prints it. */
export interface AuditedApproval {
  /** The approval's id, shared by its `approval/asked`, `approval/bound` and `approval/decided` events. */
  readonly approvalId: string
  /** The action the decision is about: the tool name. */
  readonly action: string
  /** The dispatch the decision is about: its tool call id. */
  readonly actionId: string
  /** Digest over everything the approval is bound to; the arguments are present only through it. */
  readonly digest: string
  /** Who was acting, or `unattached`. */
  readonly principal: string
  /** The manifest's declared preconditions, in order. */
  readonly preconditions: readonly string[]
  /** Digest of the capability token presented, when one was. */
  readonly capabilityToken?: string
  /** The policy set version, when a policy engine was mounted. */
  readonly policyVersion?: string
  /** When the approval stops being usable, in epoch milliseconds. */
  readonly expiresAtMs: number
  /** Seq of the `approval/bound` event. */
  readonly boundSeq: number
  /** The `approval/asked` event of the same approval, or `null` when the log has none. */
  readonly asked: { readonly seq: number; readonly toolName: string } | null
  /** The `approval/decided` event of the same approval, or `null` when the log has none. */
  readonly decided: { readonly seq: number; readonly outcome: string } | null
}

/**
 * Every approval a session log records for one action, in log order.
 * @param events - the session's complete event log.
 * @param actionId - the dispatch's action id (its tool call id).
 * @returns each approval whose `approval/bound` names `actionId`, joined with its ask and decision.
 */
export function approvalsForAction(events: readonly SessionEvent[], actionId: string): AuditedApproval[] {
  const asked = new Map<string, { seq: number; toolName: string }>()
  const decided = new Map<string, { seq: number; outcome: string }>()
  const bound: Extract<SessionEvent, { type: 'approval/bound' }>[] = []
  for (const event of events) {
    switch (event.type) {
      case 'approval/asked':
        asked.set(event.data.id, { seq: event.seq, toolName: event.data.toolName })
        break
      case 'approval/decided':
        decided.set(event.data.id, { seq: event.seq, outcome: event.data.outcome })
        break
      case 'approval/bound':
        if (event.data.actionId === actionId) bound.push(event)
        break
      default:
        // Every other event type, including ones a later build adds, says nothing about approvals.
        break
    }
  }
  return bound.map(({ seq, data }) => ({
    approvalId: data.id,
    action: data.action,
    actionId,
    digest: data.digest,
    principal: data.principal,
    preconditions: data.preconditions,
    ...data.capabilityToken === undefined ? {} : { capabilityToken: data.capabilityToken },
    ...data.policyVersion === undefined ? {} : { policyVersion: data.policyVersion },
    expiresAtMs: data.expiresAtMs,
    boundSeq: seq,
    asked: asked.get(data.id) ?? null,
    decided: decided.get(data.id) ?? null,
  }))
}

/**
 * Run one `audit` lookup on a booted context, printing to stdout/stderr.
 * @param ctx - the booted profile's root context, with `ctx.sessionQuery` mounted.
 * @param args - `approval <session-id> <action-id>`.
 * @returns the process exit code.
 */
async function audit(ctx: Context, args: readonly string[]): Promise<number> {
  const [subject, sessionId, actionId, ...rest] = args
  if (subject !== 'approval' || sessionId === undefined || actionId === undefined || rest.length > 0) {
    process.stderr.write(`${NAME}: audit takes: approval <session-id> <action-id>\n`)
    return 2
  }
  const { events } = await ctx.sessionQuery.readSession(SessionId(sessionId))
  const approvals = approvalsForAction(events, actionId)
  process.stdout.write(`${JSON.stringify({ sessionId, actionId, approvals })}\n`)
  return approvals.length === 1 ? AUDIT_FOUND : approvals.length === 0 ? AUDIT_NOT_FOUND : AUDIT_AMBIGUOUS
}

/**
 * Boot the profile for a `dsh audit` lookup, run it, and dispose.
 *
 * The lookup is one-shot: it reads the log, prints, and hands the exit code to
 * the shutdown controller, which disposes the tree before the process exits.
 * A log that cannot be read (an unknown session, or one this build cannot
 * replay) exits 1 with the reason on stderr.
 * @param profile - the profile to boot.
 * @param patchFiles - extra `--patch` overlays applied after the profile layer.
 * @param args - `approval <session-id> <action-id>`.
 * @returns a promise that settles once shutdown is under way.
 */
export async function runAudit(profile: string, patchFiles: string[], args: string[]): Promise<void> {
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv(NAME),
    profile,
    fromDefaultProfile: undefined,
    patchFiles,
    args: [],
  })
  let code = 1
  try {
    code = await audit(ctx, args)
  } catch (error) {
    process.stderr.write(`${NAME}: audit failed: ${error instanceof Error ? error.message : String(error)}\n`)
    code = 1
  }
  await shutdown.shutdown(code)
}
