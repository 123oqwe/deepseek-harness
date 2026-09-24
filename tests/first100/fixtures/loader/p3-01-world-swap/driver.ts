/**
 * Driver for P3-01 acceptance[0]'s shipped-composition cases: one tool call,
 * with the call's world bound by the local provider or by the fenced one.
 *
 * It writes one file into its working directory, then boots the SHIPPED
 * headless profile through `bootProductionProfile` with `./base.patch.yml`
 * under `workspace-write`, the Trust Kernel pinned the way
 * `apps/cli/src/profile-boot.ts` pins it. In `fenced` mode it also layers
 * `./fenced-only.patch.yml`, which removes the local world provider's row, so
 * the fenced provider builds the world. It creates the root agent after boot,
 * as a shipped launcher does, and the scripted model calls the shipped `read`
 * tool on the file once.
 *
 * It prints one `P3-01-SWAP <json>` line: the world binding the session
 * recorded, the manifests it appended, the policy records the kernel audited,
 * the risk gate's records and the tool results. The spec beside it compares
 * the two modes.
 * @module tests/first100/fixtures/loader/p3-01-world-swap/driver
 */

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { PROVIDER, READ_FILE, READ_LINE } from './shared.ts'

const fencedOnly = fileURLToPath(new URL('./fenced-only.patch.yml', import.meta.url))

/** What the driver prints. */
interface Report {
  readonly mode: 'shipped' | 'fenced'
  readonly worldBound: readonly { readonly provider: string; readonly spec: string }[]
  readonly manifests: readonly Record<string, unknown>[]
  readonly policyRecords: readonly Record<string, unknown>[]
  readonly riskGated: readonly Record<string, unknown>[]
  readonly toolResults: readonly string[]
}

const [configPath, mode] = process.argv.slice(2)
if (configPath === undefined || (mode !== 'shipped' && mode !== 'fenced')) {
  throw new Error('p3-01 world-swap driver requires the overlay path and `shipped` or `fenced`')
}

process.env.DSH_PERMISSION_MODE = 'workspace-write'

/** Every audit payload the kernel was handed, in order: the policy records are read here. */
const auditEntries: unknown[] = []

await writeFile(READ_FILE, `${READ_LINE}\n`, 'utf8')
const ctx = await bootProductionProfile({
  binName: 'p3-01-world-swap',
  profile: 'headless',
  overlayPaths: [
    resolveConfigPath(configPath, undefined),
    ...mode === 'fenced' ? [resolveConfigPath(fencedOnly, undefined)] : [],
  ],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({
      policyDecider: endorseComposedDecision,
      auditSink: (entry) => { auditEntries.push(entry.payload) },
    }))
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
    manifests: events.flatMap(event => event.type === 'action/manifest-appended' ? [{ ...event.data }] : []),
    policyRecords: auditEntries.flatMap(payload =>
      (payload as { readonly decision?: unknown }).decision === undefined ? [] : [payload as Record<string, unknown>]),
    riskGated: events.flatMap(event => event.type === 'action/risk-gated' ? [{ ...event.data }] : []),
    toolResults: events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ]),
  }
  process.stdout.write(`P3-01-SWAP ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
