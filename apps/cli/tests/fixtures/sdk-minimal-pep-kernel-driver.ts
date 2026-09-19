#!/usr/bin/env node
/**
 * BLOCKED-266's second observation: the same tool call on the same shipped
 * profile, with the Trust Kernel pinned the way the real launcher pins it.
 *
 * **One variable, and everything else shared by PATH rather than by copy.**
 * The overlay, the mock model and the probe tool are the sdk-app driver's own
 * files, imported from where they live, so the two records differ in exactly
 * one thing: this one runs `prepare`, and that hook does what
 * `apps/cli/src/profile-boot.ts:575-577` and `:638` do. A second copy of the
 * fixtures would have made "the kernel changed the answer" and "the fixtures
 * drifted" indistinguishable.
 *
 * **Why here and not beside the first one.** The kernel needs
 * `@deepseek-ai/dsh-trust-kernel` and `@deepseek-ai/dsh-policy-enforcement`,
 * and `packages/bundle/sdk-app` declares neither; `apps/cli` declares both,
 * plus loader-smoke, app-boot, agent-loop, tools and llm. Placing it here
 * costs ZERO new dependency edges and touches no lockfile -- and a
 * hand-written lockfile importer is what reddened `Install (frozen)` on
 * 2026-09-19.
 *
 * It records; it does not judge. Which branch a kernel-pinned composition
 * takes is exactly what nobody has run to find out.
 */

import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { createFixtureRootAgent } from '../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { PEP_PROBE_TOOL } from '../../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep-mock-llm.ts'

const overlay = fileURLToPath(new URL('../../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url))

/** Set by the probe tool's own body, so "did it run" is observed and not inferred. */
let toolBodyRan = false

const ctx = await bootProductionProfile({
  binName: 'sdk-minimal-pep-kernel-observation',
  profile: 'sdk-minimal',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
  // The one difference from the first observation, and it is the real
  // launcher's own two lines. `endorseComposedDecision` is NOT optional: the
  // kernel's placeholder decider overrode an engine `permit` and refused every
  // call (BLOCKED-187), so a kernel pinned without it would be a third thing
  // that no shipped path runs.
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})
try {
  ctx.tools.register(defineContentToolFixture({
    name: PEP_PROBE_TOOL,
    description: 'a harmless probe that records that it ran',
    parameters: {},
    execute: () => {
      toolBodyRan = true
      return Promise.resolve([{ type: 'text' as const, text: 'probe ran' }])
    },
  }))
  await createFixtureRootAgent(ctx, {
    provider: 'sdk-minimal-pep-mock',
    model: 'sdk-minimal-pep-mock',
    cwd: process.cwd(),
    // The run id's brand is taken from the factory's own parameter type rather
    // than imported: `RunId` lives in `@deepseek-ai/dsh-principal`, which this
    // package does not declare, and adding an edge for one string would mean a
    // hand-written lockfile importer. `HostUserIdentityFactory` is exported by
    // `@deepseek-ai/dsh-agent-loop` (`agent-loop/src/index.ts:315`), which this
    // package already depends on, and it names the type exactly.
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'run the probe' })

  const events = ctx.sessions.list().flatMap(session => session.snapshotEvents())
  const manifests = events.flatMap(event => event.type !== 'action/manifest-appended' ? [] : [event.data])
  const decisions = manifests.map((data) => {
    const decision = (data as { decision?: { effect?: string; reason?: string } }).decision
    return decision === undefined ? null : { effect: decision.effect ?? null, reason: decision.reason ?? null }
  })
  await writeFile('observation.json', `${JSON.stringify({
    profile: 'sdk-minimal',
    // The field that makes the two records comparable rather than merely
    // similar: a reader meeting one of them must know which composition it is
    // about without inferring it from the services map.
    bootMethod: 'kernel-pinned',
    toolBodyRan,
    manifestEvents: manifests.length,
    decisions,
    services: {
      policy: ctx.get('policy') !== undefined,
      policySet: ctx.get('policySet') !== undefined,
      trustKernel: ctx.get('trustKernel') !== undefined,
      sandboxPolicy: ctx.get('sandboxPolicy') !== undefined,
      actionLedger: ctx.get('actionLedger') !== undefined,
    },
    toolResultTexts: events.flatMap(event => event.type !== 'tool/result' ? [] : [
      event.data.message.content.flatMap(block =>
        block.type === 'tool-result' ? block.content.flatMap(part => part.type === 'text' ? [part.text] : []) : []).join(''),
    ]),
  }, null, 2)}\n`, 'utf8')
} finally {
  await ctx.fiber.dispose()
}
