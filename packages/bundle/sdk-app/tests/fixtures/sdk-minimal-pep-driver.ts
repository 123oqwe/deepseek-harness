#!/usr/bin/env node
/**
 * Test driver for BLOCKED-266: boot the shipped `sdk-minimal` profile, let the
 * model ask for one harmless tool call, and write down what actually happened
 * to it.
 *
 * **It lives with the `sdk-app` fixtures and observes a different profile on
 * purpose.** The subject is the PROFILE — `bootProductionProfile` takes it by
 * name — and the harness this needs is already a devDependency of `sdk-app`
 * and of nothing in `packages/bundle/sdk-minimal`, which has one devDependency
 * in total. Seven new dependency edges and their hand-written lockfile
 * importers for one observation is the cost this placement avoids.
 *
 * It records rather than asserts. What P2-05's `acceptance[0]` needs to know
 * about this profile was, until now, a static reading (lane A, A-61): the Cedar
 * policy engine is not among its rows, so every action would be refused — or
 * admitted, depending on which fail direction the missing enforcement point
 * takes. Both are worth knowing and neither should turn a CI run red before the
 * delegate has ruled on it, so the file this writes is evidence and the spec
 * beside it checks that the evidence exists and is well formed.
 */

import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { RunId } from '@deepseek-ai/dsh-principal'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createFixtureRootAgent } from '../../../../test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { PEP_PROBE_TOOL } from './sdk-minimal-pep-mock-llm.ts'

const overlay = fileURLToPath(new URL('./sdk-minimal-pep.patch.yml', import.meta.url))

/** Set by the probe tool's own body, so "did it run" is observed and not inferred. */
let toolBodyRan = false

const ctx = await bootProductionProfile({
  binName: 'sdk-minimal-pep-observation',
  profile: 'sdk-minimal',
  overlayPaths: [resolveConfigPath(overlay, undefined)],
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
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(RunId(`run-${randomUUID()}`)),
  })
  await runFixtureTurn(ctx, { task: 'run the probe' })

  // Read from the session log rather than from a spy: a manifest event is what
  // the enforcement point appends, so its presence or absence IS the answer to
  // "was a policy decision taken at all".
  // The fixture root agent mints its own session id, so the session is found
  // rather than named: this profile holds exactly the one this driver drove.
  const events = ctx.sessions.list().flatMap(session => session.snapshotEvents())
  const manifests = events.flatMap(event => event.type !== 'action/manifest-appended' ? [] : [event.data])
  const decisions = manifests.map((data) => {
    const decision = (data as { decision?: { effect?: string; reason?: string } }).decision
    return decision === undefined ? null : { effect: decision.effect ?? null, reason: decision.reason ?? null }
  })
  await writeFile('observation.json', `${JSON.stringify({
    profile: 'sdk-minimal',
    // Names the composition this record is about, so a reader meeting one of
    // the two records knows which it has without inferring it from the
    // services map. The kernel-pinned twin lives in `apps/cli/tests/`, which
    // is the only package declaring both the loader-smoke harness and the
    // trust-kernel packages.
    bootMethod: 'no-trust-kernel',
    toolBodyRan,
    manifestEvents: manifests.length,
    decisions,
    // Absence is the interesting half here, so each is recorded as a boolean
    // rather than left to be inferred from a missing key.
    // The keys are the ones the packages actually declare, checked against
    // their `declare module '@deepseek-ai/cordis'` blocks rather than guessed
    // from the service's name: the policy engine publishes `policy` and
    // `policySet` (`policy-engine/src/types.ts:312-315`), NOT `policyEngine`.
    // `ctx.get` takes a name, so a wrong one compiles and answers `undefined`
    // forever — which would have recorded "no policy engine" on a profile that
    // has one.
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
