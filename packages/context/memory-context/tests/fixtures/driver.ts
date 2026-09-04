#!/usr/bin/env node
/**
 * Test driver: boots the shipped headless profile with the memory rows
 * enabled, seeds one durable memory record through the composed `ctx.memory`
 * service, then sends one turn so `memory-context` recalls it.
 */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { createAnonymousDevPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('memory-context driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'memory-context-smoke',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await ctx.memory.propose({
    principal: createAnonymousDevPrincipal(PrincipalId('p-fixture'), TenantId('t-fixture')),
    scope: { tenantId: TenantId('t-fixture') },
    content: { note: 'the deploy passphrase is oxidized-kingfisher' },
  })
  await runFixtureTurn(ctx, { task: 'what is the deploy passphrase' })
} finally {
  await ctx.fiber.dispose()
}
