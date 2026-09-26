/**
 * Driver for P6-03's second-slice CLI review case: it writes the proposals the
 * operator reviews, and later reads back which of them the default search
 * returns.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled, in the working directory the `dsh
 * memory` commands run in, so both reach the same durable store. Every
 * proposal is scoped to that directory's workspace in the host user's tenant,
 * the proposals `dsh memory` reviews.
 * - `seed` proposes two complete `sensitive` proposals (`to-approve`,
 *   `to-reject`), which the policy holds for review, and one complete `normal`
 *   proposal (`accepted`). It prints `P6-03-CLI-SEED <json>` with each id.
 * - `check` asks the default search for each proposal's marker and prints
 *   `P6-03-CLI-CHECK <json>` with whether it was returned.
 * @module tests/first100/fixtures/loader/p6-03-proposal/cli-review-driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { MemoryAccessContext, MemoryProposeRequest, MemoryScope } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The proposals the operator reviews, by name. */
const CLI_REVIEW_PROPOSALS = ['to-approve', 'to-reject', 'accepted'] as const

const [configPath, mode] = process.argv.slice(2)
if (configPath === undefined || (mode !== 'seed' && mode !== 'check')) throw new Error('usage: cli-review-driver.ts <overlay> seed|check')

const observed = await observeWorkspaceIdentity(process.cwd())
const tenantId = TenantId('local')
const principal = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
const scope: MemoryScope = {
  tenantId,
  workspace: {
    canonicalPath: observed.canonicalPath,
    identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
  },
}

/**
 * The marker only one proposal's content carries.
 * @param name - the proposal's name.
 * @returns the marker.
 */
function marker(name: string): string {
  return `p6-03-cli-${name}-marker`
}

const ctx = await bootProductionProfile({
  binName: 'p6-03-cli-review',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  if (mode === 'seed') {
    const ids: Record<string, string> = {}
    for (const name of CLI_REVIEW_PROPOSALS) {
      const request: MemoryProposeRequest = {
        principal,
        scope,
        origin: { kind: 'user-asserted', assertedBy: 'p6-03-writer' },
        purpose: 'answer questions about this project',
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        sensitivity: name === 'accepted' ? 'normal' : 'sensitive',
        content: { note: marker(name) },
      }
      ids[name] = (await ctx.memory.propose(request)).id
    }
    process.stdout.write(`P6-03-CLI-SEED ${JSON.stringify({ ids })}\n`)
  } else {
    const accessContext: MemoryAccessContext = { principal, purpose: 'p6-03 red first', scope, contextBudget: { maxRecords: 20 } }
    const active: Record<string, boolean> = {}
    for (const name of CLI_REVIEW_PROPOSALS) {
      active[name] = (await ctx.memory.query({ accessContext, query: marker(name) })).records.length > 0
    }
    process.stdout.write(`P6-03-CLI-CHECK ${JSON.stringify({ active })}\n`)
  }
} finally {
  await ctx.fiber.dispose()
}
