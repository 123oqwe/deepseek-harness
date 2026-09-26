#!/usr/bin/env node
/**
 * Test driver: boots the shipped headless profile with the memory rows enabled,
 * seeds one durable record, and runs the SAME turn twice. The second turn
 * recalls the same record as the first, so the recall snapshot is unchanged and
 * `memory-context` appends no second recall and no shadow — the property
 * `../memory-context-idempotent.spec.ts` reads from the durable log.
 */

import { randomUUID } from 'node:crypto'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { createAnonymousDevPrincipal, PrincipalId, RunId, TenantId } from '@deepseek-ai/dsh-principal'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { createFixtureRootAgent } from '../../../../test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'

/** The workspace scope a session in this cwd reads under, observed the same way the consumer observes it. */
async function workspaceScope(): Promise<{ canonicalPath: string; identity: string }> {
  const observed = await observeWorkspaceIdentity(process.cwd())
  return {
    canonicalPath: observed.canonicalPath,
    identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
  }
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('memory-context idempotent driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'memory-context-idempotent-smoke',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await createFixtureRootAgent(ctx, { provider: 'memory-context-mock', model: 'memory-context-mock', cwd: process.cwd(), identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(RunId(`run-${randomUUID()}`)) })
  await ctx.memory.propose({
    origin: { kind: 'user-asserted', assertedBy: 'test' },
    principal: createAnonymousDevPrincipal(PrincipalId('p-fixture'), TenantId('local')),
    scope: { tenantId: TenantId('local'), workspace: await workspaceScope() },
    content: { note: 'the deploy passphrase is oxidized-kingfisher' },
    purpose: 'recall in this workspace',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    sensitivity: 'normal',
  })
  // The same task both turns: the second turn recalls the same record, so the
  // recall snapshot is unchanged and no second recall is appended.
  await runFixtureTurn(ctx, { task: 'deploy passphrase' })
  await runFixtureTurn(ctx, { task: 'deploy passphrase' })
} finally {
  await ctx.fiber.dispose()
}
