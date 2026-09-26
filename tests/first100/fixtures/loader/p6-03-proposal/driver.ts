/**
 * Driver for P6-03's first slice on the shipped composition (must[1],
 * must[2], acceptance[0]).
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * the base layer's `memory` row enabled, and submits three proposals through
 * the composed `ctx.memory.propose`, the one write entry the seam has:
 * 1. `normal`: evidence, intended use, TTL and sensitivity all stated, the
 *    sensitivity `normal` (the control);
 * 2. `sensitive`: the same, marked `sensitive`;
 * 3. `no-evidence`: an origin that names nobody.
 *
 * After each it asks the default search for the proposal's own marker. It
 * prints one `P6-03-PROPOSAL <json>` line: per proposal, the code (or message)
 * `propose` threw when it threw, and whether the default search returned it.
 * @module tests/first100/fixtures/loader/p6-03-proposal/driver
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { MemoryProposeRequest } from '@deepseek-ai/dsh-memory'
import { createUserPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** What one proposal came to. */
interface Outcome {
  readonly name: string
  readonly thrown?: string
  readonly active: boolean
}

const [configPath] = process.argv.slice(2)
if (configPath === undefined) throw new Error('p6-03 proposal driver requires the overlay path')

const tenantId = TenantId('local')
const principal = createUserPrincipal(PrincipalId('p6-03-writer'), tenantId)
const scope = { tenantId, workspace: { canonicalPath: '/projects/p6-03', identity: 'p6-03-volume:1:1' } }
const stated = {
  principal,
  scope,
  purpose: 'answer questions about this project',
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
}

/** The three proposals, each content carrying a marker only it holds. */
const proposals: readonly { readonly name: string; readonly marker: string; readonly request: MemoryProposeRequest }[] = [
  {
    name: 'normal',
    marker: 'p6-03-normal-marker',
    request: { ...stated, sensitivity: 'normal', origin: { kind: 'user-asserted', assertedBy: 'p6-03-writer' }, content: { note: 'p6-03-normal-marker' } },
  },
  {
    name: 'sensitive',
    marker: 'p6-03-sensitive-marker',
    request: { ...stated, sensitivity: 'sensitive', origin: { kind: 'user-asserted', assertedBy: 'p6-03-writer' }, content: { note: 'p6-03-sensitive-marker' } },
  },
  {
    name: 'no-evidence',
    marker: 'p6-03-no-evidence-marker',
    request: { ...stated, sensitivity: 'normal', origin: { kind: 'user-asserted', assertedBy: '' }, content: { note: 'p6-03-no-evidence-marker' } },
  },
]

const ctx = await bootProductionProfile({
  binName: 'p6-03-proposal',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const outcomes: Outcome[] = []
  for (const proposal of proposals) {
    let thrown: string | undefined
    try {
      await ctx.memory.propose(proposal.request)
    } catch (error: unknown) {
      thrown = error instanceof Error && 'code' in error ? String(error.code) : String(error)
    }
    const found = await ctx.memory.query({
      accessContext: { principal, purpose: 'p6-03 red first', scope, contextBudget: { maxRecords: 10 } },
      query: proposal.marker,
    })
    outcomes.push({ name: proposal.name, ...thrown === undefined ? {} : { thrown }, active: found.records.length > 0 })
  }
  process.stdout.write(`P6-03-PROPOSAL ${JSON.stringify({ outcomes })}\n`)
} finally {
  await ctx.fiber.dispose()
}
