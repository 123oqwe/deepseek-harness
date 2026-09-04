#!/usr/bin/env node
/**
 * Test driver: boots the shipped headless profile with the memory rows
 * enabled, seeds one durable memory record through the composed `ctx.memory`
 * service, drives one turn so `memory-context` recalls it, then reloads the
 * session from disk through the real persistence read path.
 *
 * That reload is the load-bearing half of the round trip: it is the path that
 * refuses a log carrying an event type this build does not know and has not
 * marked ignorable, so it proves `memory/access` survives replay rather than
 * only that it was written.
 */

import { writeFile } from 'node:fs/promises'
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
  const [agent] = ctx.get('agents')?.roots() ?? []
  if (agent === undefined) throw new Error('memory-context driver found no configured agent')
  await runFixtureTurn(ctx, { task: 'deploy passphrase' })

  // Replay: reload the just-written log through the persistence read path,
  // which refuses any event type unknown to this build. Report what came back
  // so the spec asserts on the REPLAYED events, not the written ones.
  const reloaded = await ctx.sessionPersistence.load(agent.session.id)
  await writeFile(
    'replay.json',
    JSON.stringify({ types: reloaded.events.map(event => event.type) }),
    'utf8',
  )
} finally {
  await ctx.fiber.dispose()
}
