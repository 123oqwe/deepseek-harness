/**
 * Driver for A-391's measurement: whether what plugins write through
 * `ctx.logger` on the shipped headless profile reaches anything an operator
 * can read.
 *
 * It boots the SHIPPED headless profile through `bootProductionProfile` with
 * `./base.patch.yml` under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it, registers a read-only probe tool,
 * and creates the root agent after boot. It then:
 *
 * - writes one warn and one error carrying {@link MARKER} through the root
 *   context's logger;
 * - makes the capability-token store's directory read-only, so the session's
 *   first token cannot be recorded and `capability-token-file` logs
 *   "got no token", and runs one turn whose model calls the probe;
 * - restores the directory's permissions, so the run's working directory can
 *   be removed.
 *
 * It prints one `A391-LOGGER <json>` line: how many logger exporters were
 * installed at boot and at the end, the turn's tool results, and the messages
 * in the logger's in-memory buffer that carry the marker or "got no token".
 * @module tests/first100/fixtures/loader/logger-visibility/driver
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlay = fileURLToPath(new URL('./base.patch.yml', import.meta.url))

/** The route the scripted model registers. */
const PROVIDER = 'logger-visibility-mock'
/** The probe tool the model calls. */
const PROBE_TOOL = 'a391_probe'
/** The text the driver's own log lines carry. */
const MARKER = 'A391-LOGGER-MARKER'
/** The first argument of `capability-token-file`'s log line for a failed issuance. */
const NO_TOKEN = 'got no token'

const home = process.env.DSH_HOME
if (home === undefined) throw new Error('logger-visibility driver: DSH_HOME is not set')
// The shipped `capability-tokens` row stores under `dshHomePath('capability-tokens')`.
const tokenDirectory = join(home, 'capability-tokens')

process.env.DSH_PERMISSION_MODE = 'workspace-write'

const ctx = await bootProductionProfile({
  binName: 'logger-visibility',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: () => undefined,
    }))
  },
})
try {
  ctx.tools.register(defineContentToolFixture({
    name: PROBE_TOOL,
    description: 'a read-only probe',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text' as const, text: 'probe ran' }]),
  }))
  // The shipped headless profile asks once whether to trust the workspace; the
  // operator declines, which grants nothing.
  ctx.on('approval/request', () => Promise.resolve('rejected' as const))

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
  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error('logger-visibility driver: no root agent after creation')

  const exportersAtBoot = ctx.logger.exporters.size
  ctx.logger.warn(`${MARKER}: a warn through the root context's logger`)
  ctx.logger.error(`${MARKER}: an error through the root context's logger`)

  await mkdir(tokenDirectory, { recursive: true })
  const files = await readdir(tokenDirectory)
  for (const file of files) await chmod(join(tokenDirectory, file), 0o400)
  await chmod(tokenDirectory, 0o500)
  try {
    await runFixtureTurn(ctx, { task: 'A-391: call the probe once.' })
  } finally {
    await chmod(tokenDirectory, 0o700)
    for (const file of files) await chmod(join(tokenDirectory, file), 0o600)
  }

  const toolResults = agent.session.snapshotEvents().flatMap(event => event.type !== 'tool/result' ? [] : [
    event.data.message.content.flatMap(block =>
      block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
  ])
  const buffered = ctx.logger.buffer
    .map(message => ({ type: message.type, name: message.name, first: String(message.args[0]) }))
    .filter(message => message.first.includes(MARKER) || message.first.includes(NO_TOKEN))
  process.stdout.write(`A391-LOGGER ${JSON.stringify({
    exporters: { atBoot: exportersAtBoot, atEnd: ctx.logger.exporters.size },
    toolResults,
    buffered,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
