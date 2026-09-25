/**
 * Driver for P3-01's world-identity cases (acceptance[2]) and silent-degradation
 * case (acceptance[1]): one tool call on the SHIPPED headless profile, with the
 * call's world bound by a chosen provider or by none.
 *
 * It changes into the working directory the spec shares between every mode,
 * where the spec wrote one file, then boots the shipped headless profile
 * through `bootProductionProfile` with the world-swap cases' base overlay under
 * `workspace-write`, the Trust Kernel pinned the way `apps/cli/src/profile-boot.ts`
 * pins it, and one more overlay per mode:
 * - `shipped`: none;
 * - `honest`: `./honest.patch.yml`, a test provider in place of the shipped two
 *   that reports its own id and the digest of the spec it was given;
 * - `forging`: `./forging.patch.yml`, the same provider claiming to be `local`
 *   with a digest it did not compute;
 * - `network-none`: `./network-none.patch.yml`, a request no shipped provider
 *   can hold.
 * The scripted model calls the shipped `read` tool on the file once.
 *
 * It prints one `P3-01-IDENTITY <json>` line: the world bindings the session
 * recorded, every `action/world-*` event type it holds, and the tool results.
 * @module tests/first100/fixtures/loader/p3-01-world-identity/driver
 */

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { PROVIDER } from '../p3-01-world-swap/shared.ts'

/** The modes this driver boots, and the overlay each adds to the base one. */
const MODE_OVERLAYS = {
  shipped: undefined,
  honest: './honest.patch.yml',
  forging: './forging.patch.yml',
  'network-none': './network-none.patch.yml',
} as const

/** One boot mode. */
type Mode = keyof typeof MODE_OVERLAYS

/** What the driver prints. */
interface Report {
  readonly mode: Mode
  readonly worldBound: readonly { readonly provider: string; readonly spec: string }[]
  readonly worldEventTypes: readonly string[]
  readonly toolResults: readonly string[]
}

/**
 * Whether a command-line word names a mode.
 * @param value - the word.
 * @returns true for a key of {@link MODE_OVERLAYS}.
 */
function isMode(value: string | undefined): value is Mode {
  return value !== undefined && Object.hasOwn(MODE_OVERLAYS, value)
}

const [configPath, mode, workspace] = process.argv.slice(2)
if (configPath === undefined || !isMode(mode) || workspace === undefined) {
  throw new Error('p3-01 world-identity driver requires the base overlay path, a mode, and the shared working directory')
}
const modeOverlay = MODE_OVERLAYS[mode]

// Every mode runs in one directory: under `workspace-write` the world spec
// names the workspace root, which the base layer takes from `process.cwd()`.
process.chdir(workspace)

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'p3-01-world-identity',
  profile: 'headless',
  overlayPaths: [
    resolveConfigPath(configPath, undefined),
    ...modeOverlay === undefined ? [] : [resolveConfigPath(fileURLToPath(new URL(modeOverlay, import.meta.url)), undefined)],
  ],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})
try {
  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'P3-01: read the file once.' })
  const events = ctx.sessions.list().flatMap(session => session.snapshotEvents())
  const report: Report = {
    mode,
    worldBound: events.flatMap(event => event.type === 'action/world-bound' ? [{ provider: event.data.provider, spec: event.data.spec }] : []),
    worldEventTypes: events.flatMap(event => event.type.startsWith('action/world-') ? [event.type] : []),
    toolResults: events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ]),
  }
  process.stdout.write(`P3-01-IDENTITY ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
