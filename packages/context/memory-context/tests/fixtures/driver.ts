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
import { observeWorkspaceIdentity } from '@deepseek-ai/dsh-workspace'
import { createAnonymousDevPrincipal, PrincipalId, TenantId } from '@deepseek-ai/dsh-principal'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

/** The workspace scope a session in this cwd reads under, observed the same way the consumer observes it. */
async function workspaceScope(): Promise<{ canonicalPath: string; identity: string }> {
  const observed = await observeWorkspaceIdentity(process.cwd())
  return {
    canonicalPath: observed.canonicalPath,
    identity: `${String(observed.volume.device)}:${String(observed.volume.inode)}:${String(observed.volume.createdAtMs)}`,
  }
}

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('memory-context driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'memory-context-smoke',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await ctx.memory.propose({
    origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: createAnonymousDevPrincipal(PrincipalId('p-fixture'), TenantId('t-fixture')),
    scope: { tenantId: TenantId('t-fixture'), workspace: await workspaceScope() },
    content: { note: 'the deploy passphrase is oxidized-kingfisher' },
  })
  // A record the SAME TENANT wrote from a different checkout. It matches the
  // turn's query as well as the one above does, so if it stays out of the
  // recall it is the workspace boundary keeping it out and not the search.
  await ctx.memory.propose({
    origin: { kind: 'user-asserted', assertedBy: 'test' }, principal: createAnonymousDevPrincipal(PrincipalId('p-fixture'), TenantId('t-fixture')),
    scope: {
      tenantId: TenantId('t-fixture'),
      workspace: { canonicalPath: '/projects/another-checkout', identity: 'dev-9:ino-9999:1600000000000' },
    },
    content: { note: 'the deploy passphrase is tarnished-marmoset' },
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
