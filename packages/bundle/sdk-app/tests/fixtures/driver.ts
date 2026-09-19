#!/usr/bin/env node
/**
 * Test driver: boots the shipped `sdk` profile with this fixture's overlay,
 * drives one turn, and lets the recording adapter write the system prompt the
 * model was given.
 *
 * The grant half writes its own overlay here rather than shipping one: the
 * path it grants is the isolated cwd the smoke harness created, which exists
 * only at run time. That is also the real mechanism — an operator's own
 * `cordis.patch.yml` layer setting `config.grants` on the bundle's row.
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { RunId } from '@deepseek-ai/dsh-principal'
import { createFixtureRootAgent } from '../../../../test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./workspace-trust.patch.yml', import.meta.url))

/** Write the operator-style grant overlay for this run's own workspace. */
async function grantOverlay(): Promise<string> {
  const path = join(process.cwd(), 'grant.patch.yml')
  await writeFile(path, [
    '- id: workspace-trust-local',
    '  config:',
    '    grants:',
    `      - path: ${JSON.stringify(process.cwd())}`,
    '        state: trusted-execute',
    '',
  ].join('\n'), 'utf8')
  return path
}

const granted = process.env.DSH_TRUST_FIXTURE_GRANT === '1'
const byLaunchFlag = process.env.DSH_TRUST_FIXTURE_LAUNCH_FLAG === '1'

/**
 * The launcher facts `dsh` itself provides, so the flag reaches the plugin the
 * way it does in a real run.
 *
 * `ready` is committed after boot returns, which is what `apps/cli` does at
 * the end of `profile-boot`: the launch grant registers a listener on it and
 * fails there if nothing was written, so a fixture that omitted the signal
 * would be testing a launcher shape no profile ships.
 */
const readyListeners: (() => void)[] = []
const ctx = await bootProductionProfile({
  binName: 'sdk-app-workspace-trust-smoke',
  profile: 'sdk',
  overlayPaths: [resolveConfigPath(overlay, undefined), ...granted ? [await grantOverlay()] : []],
  prepare: (hostCtx) => {
    provideCmdline(hostCtx, {
      args: byLaunchFlag ? ['--trust-workspace=read'] : [],
      exit: () => {},
      ready: {
        onReady(listener) {
          readyListeners.push(listener)
          return () => { readyListeners.splice(readyListeners.indexOf(listener), 1) }
        },
      },
    })
  },
})
// The launcher's own commit: a grant that never reached a provider throws
// HERE, before any turn runs, which is the report this fixture must not skip.
for (const listener of [...readyListeners]) listener()
try {
  await createFixtureRootAgent(ctx, {
    provider: 'sdk-trust-mock',
    model: 'sdk-trust-mock',
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(RunId(`run-${randomUUID()}`)),
  })
  await runFixtureTurn(ctx, { task: 'say ok' })
} finally {
  await ctx.fiber.dispose()
}
