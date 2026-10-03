/**
 * Driver for A-601 (第34题, for B-721): on the shipped headless composition, the
 * host's approval request for a `run_code` call carries the six fields must[0]
 * names, but none of them discloses that the approved code does NOT run in the OS
 * sandbox and can read and write any file the account can, including under
 * `$DSH_HOME` (code-runtime-worker-thread/src/index.ts: "containment, not a
 * security boundary"). This observes that approval request, as the operator would
 * see it, so the spec can assert the disclosure is absent today.
 *
 * It boots the shipped headless profile through `bootProductionProfile` with
 * `DSH_TOOLS_MODE=ptc` (a deployer's opt-in, the only configuration that offers
 * `run_code` to the model), pins the Trust Kernel the way `profile-boot.ts` does,
 * registers the keyless scripted model, and drives one turn whose model calls
 * `run_code` once. `run_code` declares no `riskDomainTags`, so under the default
 * `workspace-write` preset the risk gate asks; the driver records the request's
 * full display and then refuses it, so the code never runs. It prints one
 * `A-601-RUN-CODE-DISCLOSURE <json>` line.
 * @module tests/first100/fixtures/loader/a-601-run-code-disclosure/driver
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOST_USER_IDENTITY_KEY, type HostUserIdentityFactory } from '@deepseek-ai/dsh-agent-loop'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { endorseComposedDecision } from '@deepseek-ai/dsh-policy-enforcement'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import type {} from '@deepseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createFixtureRootAgent } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/fixture-root-agent.ts'
import { bootProductionProfile } from '../../../../../packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'
import { REPORT_PREFIX, RUN_CODE_CALL_ID, type RunCodeDisclosureReport } from './shared.ts'

const PROVIDER = 'a-601-run-code-disclosure-mock'

const [configPath] = process.argv.slice(2)
if (configPath === undefined) {
  throw new Error('a-601 run-code-disclosure driver requires the overlay path')
}
// run_code is only offered to the model in PTC mode (the presentation default is
// native); a deployer opts in with this, which is the configuration under which
// the approval request this observes is produced.
process.env.DSH_TOOLS_MODE = 'ptc'
// The clause is about run_code's approval under workspace-write, where its
// security-sensitive class (no riskDomainTags, A-190) is above the ask threshold.
// Set explicitly so the ask does not depend on the base layer's default preset.
process.env.DSH_PERMISSION_MODE = 'workspace-write'

const cwd = mkdtempSync(join(tmpdir(), 'a-601-run-code-disclosure-'))

let calledRunCode = false

/**
 * One scripted model answer: open the turn with a single `run_code` call, and
 * give text to anything after a tool result or asked for another purpose.
 * @param options - the request the loop sent.
 * @returns the chunks to stream.
 */
const answer = (options: GenerateOptions): StreamChunk[] => {
  if (options.purpose !== undefined) return textResponse('ok')
  const last = options.messages.at(-1)
  const opensTurn = last?.role === 'user' && !last.content.some(block => block.type === 'tool-result')
  if (!opensTurn) return textResponse('done')
  calledRunCode = true
  return toolCallResponse(RUN_CODE_CALL_ID, RUN_CODE_NAME, {
    code: 'return 1',
    description: 'A-601 probe: a trivial program whose approval request is what this observes',
  })
}

const ctx = await bootProductionProfile({
  binName: 'a-601-run-code-disclosure',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
  prepare: (prepared) => {
    pinTrustKernel(prepared, createTrustKernel({ policyDecider: endorseComposedDecision }))
  },
})

try {
  let askedRunCode = false
  let displayJson: string | null = null
  let reason: string | null = null
  ctx.on('approval/request', (request) => {
    if (request.toolName === RUN_CODE_NAME) {
      askedRunCode = true
      reason = request.reason ?? null
      displayJson = request.display === undefined ? null : JSON.stringify(request.display)
    }
    // Refuse everything: the run_code call must not run (its code would escape the
    // workspace), and the headless workspace-trust question is declined as the
    // P2-03 composition cases decline it.
    return Promise.resolve('rejected' as const)
  })

  ctx.llm.registerAdapter([PROVIDER], new MockAdapter(Array.from({ length: 8 }, () => answer)))
  // Created after boot, as a shipped launcher creates its root agent, so its
  // session starts once the capability-token service is listening.
  await createFixtureRootAgent(ctx, {
    provider: PROVIDER,
    model: PROVIDER,
    cwd,
    identity: (ctx.get(HOST_USER_IDENTITY_KEY) as HostUserIdentityFactory | undefined)?.(
      `run-${randomUUID()}` as Parameters<HostUserIdentityFactory>[0],
    ),
  })
  await runFixtureTurn(ctx, { task: 'A-601: call run_code once.' })

  const report: RunCodeDisclosureReport = { calledRunCode, askedRunCode, hasDisplay: displayJson !== null, displayJson, reason }
  process.stdout.write(`${REPORT_PREFIX} ${JSON.stringify(report)}\n`)
} finally {
  await ctx.fiber.dispose()
}
