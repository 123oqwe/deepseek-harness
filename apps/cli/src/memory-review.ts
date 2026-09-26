/**
 * `dsh memory` review runner (P6-03 second slice): the host user lists the
 * memory proposals the policy is holding for review in the current directory's
 * workspace, and approves or rejects one of them.
 *
 * Approval is after-the-fact — a person looks over the held list and decides —
 * not a run stopping mid-turn to ask, so it is a launcher command run as the
 * host user rather than an in-session question. The review runs under the host
 * user's tenant and the working directory's workspace: exactly the scope a
 * proposal written in that directory carries, so the command sees those
 * proposals and no others. A proposal only leaves `pending` through this path,
 * so without it a memory the policy holds would wait forever.
 * @module @deepseek-ai/dsh/memory-review
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { hostUserIdentity } from '@deepseek-ai/dsh-host-user-id'
import { RunId } from '@deepseek-ai/dsh-principal'
import type { Principal } from '@deepseek-ai/dsh-principal'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { MemoryError, MemoryRecordId } from '@deepseek-ai/dsh-memory'
import type { MemoryAccessContext, MemoryScope } from '@deepseek-ai/dsh-memory'
import { runProfile } from './profile-boot.ts'

const NAME = 'dsh'

/** Upper bound on the held proposals one `pending` run lists — enough for a person to look over. */
const REVIEW_MAX_RECORDS = 1000

/**
 * The host user and the scope they review under: their tenant, and the
 * workspace of the current directory. Built exactly as a writer in this
 * directory built the scope its proposals carry, so `dsh memory` sees those.
 * @returns the reviewing principal and its scope.
 */
async function reviewContext(): Promise<{ principal: Principal; scope: MemoryScope }> {
  const { principal } = hostUserIdentity(RunId(randomUUID()))
  const observed = await observeWorkspaceIdentity(process.cwd())
  const scope: MemoryScope = {
    tenantId: principal.tenantId,
    workspace: {
      canonicalPath: observed.canonicalPath,
      identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
    },
  }
  return { principal, scope }
}

/**
 * Run one `memory` verb on a booted context, printing to stdout/stderr.
 * @param ctx - the booted profile's root context, with `ctx.memory` mounted.
 * @param args - the verb and its argument: `pending`, `approve <id>`, or `reject <id>`.
 * @returns the process exit code.
 */
async function review(ctx: Context, args: readonly string[]): Promise<number> {
  const [verb, id] = args
  const { principal, scope } = await reviewContext()
  if (verb === 'pending') {
    const accessContext: MemoryAccessContext = { principal, purpose: 'memory review', scope, contextBudget: { maxRecords: REVIEW_MAX_RECORDS } }
    const { records } = await ctx.memory.listPending({ accessContext })
    // Each line starts with the proposal id, so a caller can name one to approve or reject.
    for (const record of records) process.stdout.write(`${record.id}\t${JSON.stringify(record.content)}\n`)
    return 0
  }
  if (verb === 'approve' || verb === 'reject') {
    if (id === undefined) {
      process.stderr.write(`${NAME}: memory ${verb} needs a proposal id\n`)
      return 2
    }
    try {
      const request = { principal, scope, id: MemoryRecordId(id) }
      if (verb === 'approve') await ctx.memory.approve(request)
      else await ctx.memory.reject(request)
      return 0
    } catch (error) {
      // A held id that is unknown, out of scope, or already decided fails; name it.
      const reason = error instanceof MemoryError ? error.message : String(error)
      process.stderr.write(`${NAME}: memory ${verb} of "${id}" failed: ${reason}\n`)
      return 1
    }
  }
  process.stderr.write(`${NAME}: memory takes a verb: pending | approve <id> | reject <id>\n`)
  return 2
}

/**
 * Boot the profile for a `dsh memory` review, run the verb, and dispose.
 *
 * The composition mounts `memory` but no runner of its own, so this drives the
 * one-shot review and then hands the exit code to the shutdown controller,
 * which disposes the tree before the process exits.
 * @param profile - the profile to boot.
 * @param patchFiles - extra `--patch` overlays applied after the profile layer.
 * @param args - the verb and its argument.
 * @returns a promise that settles once shutdown is under way.
 */
export async function runMemoryReview(profile: string, patchFiles: string[], args: string[]): Promise<void> {
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv(NAME),
    profile,
    fromDefaultProfile: undefined,
    patchFiles,
    args: [],
  })
  let code = 1
  try {
    code = await review(ctx, args)
  } catch (error) {
    process.stderr.write(`${NAME}: memory review failed: ${error instanceof Error ? error.message : String(error)}\n`)
    code = 1
  }
  await shutdown.shutdown(code)
}
