/**
 * Driver for A-440's census under P2-03 acceptance[2]: what the risk gate
 * decides today, on one shipped template at its shipped default preset, for
 * every tool the root agent can see.
 *
 * It boots the SHIPPED template named on the command line through
 * `bootProductionProfile`, pins the Trust Kernel the way
 * `apps/cli/src/profile-boot.ts:577` does, leaves `DSH_PERMISSION_MODE` unset
 * so the base layer's default preset applies, and creates the root agent after
 * boot. It runs no turn and executes no tool. For each visible tool it asks the
 * mounted `permissionPresets` service the two questions `gateActionRisk` asks
 * (`packages/core/tools/src/external-effect.ts:566` and `:570`), once per
 * preset in the table, and prints one `P2-03-CENSUS <json>` line.
 * @module tests/first100/fixtures/loader/p2-03-approval-census/driver
 */

import { randomUUID } from 'node:crypto'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { MockAdapter, textResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { CENSUS_TEMPLATES, type CensusReport, type CensusTemplate, type CensusTool, type GateDecision } from './shared.ts'

const PROVIDER = 'p2-03-approval-census-mock'

/**
 * Whether a command-line word names a template this census boots.
 * @param value - the word.
 * @returns true for a census template.
 */
function isTemplate(value: string | undefined): value is CensusTemplate {
  return CENSUS_TEMPLATES.some(template => template === value)
}

const [configPath, template] = process.argv.slice(2)
if (configPath === undefined || !isTemplate(template)) {
  throw new Error('p2-03 approval-census driver requires the overlay path and a template')
}

const ctx = await bootProductionProfile({
  binName: 'p2-03-approval-census',
  profile: template,
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  ctx.llm.registerAdapter([PROVIDER], new MockAdapter([textResponse('ok')]))
  // Created after boot, as a shipped launcher creates its root agent.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd: process.cwd(),
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  const root = ctx.agents.list()[0]
  if (root === undefined) throw new Error('p2-03 approval-census driver: no root agent after creation')
  const presets: PermissionPresetService | undefined = ctx.get('permissionPresets')
  const presetNames = presets?.selectFor({ preset: null, sandbox: null, approval: null }).options.map(option => option.value) ?? []
  const tools = ctx.tools.schemas(root).map(({ name }): CensusTool => {
    const declared = ctx.tools.get(name, root)?.riskDomainTags
    if (presets === undefined) return { name, tags: declared ?? null, classification: null, decisions: {} }
    const classification = presets.classifyAction({ actionId: name, domainTags: declared ?? [] })
    // The order `gateActionRisk` decides in: the kernel band first, then the preset's threshold.
    const decide = (preset: string): GateDecision => {
      if (classification.hardDenied) return 'hard-denied'
      return presets.requiresApproval(classification, preset) ? 'asked' : 'allowed-by-preset'
    }
    return {
      name,
      tags: declared ?? null,
      classification: { riskClass: classification.riskClass, ground: classification.ground, hardDenied: classification.hardDenied },
      decisions: Object.fromEntries(presetNames.map((preset): [string, GateDecision] => [preset, decide(preset)])),
    }
  })
  const report: CensusReport = {
    template,
    presetsMounted: presets !== undefined,
    presetNames,
    presetInForce: presets?.current(root.session) ?? null,
    tools,
  }
  process.stdout.write(`P2-03-CENSUS ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
