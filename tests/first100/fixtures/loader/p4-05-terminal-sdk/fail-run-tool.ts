/**
 * Test-only plugin for BLOCKED-332's condition 3 on the shipped `sdk`
 * profile: one read-only tool, `p4_05_fail_run`, whose body advances the
 * calling agent's Run to `failed` through the shipped `ctx.runs.advance` and
 * answers with what the advance returned. The reason it gives is a text that
 * appears nowhere else, so a client that receives it received it from the
 * transition.
 * @module tests/first100/fixtures/loader/p4-05-terminal-sdk/fail-run-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-run'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

/** The reason the transition is given; the spec asserts a client receives it. */
const FAIL_REASON = 'BLOCKED-332 condition 3: advanced to failed by the test tool'

/** Plugin name. */
export const name = 'p4-05-fail-run-tool'

/** The tool registry the tool is added to. */
export const inject = ['tools']

/**
 * Register `p4_05_fail_run`.
 * @param ctx - plugin context with the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'p4_05_fail_run',
    description: 'ends the calling agent\'s run through the run service',
    riskDomainTags: ['filesystem-read'],
    parameters: {},
    execute: (_args, exec) => {
      const runs = ctx.get('runs')
      const decision = exec.agent === undefined || runs === undefined
        ? 'no-agent-or-run-service'
        : runs.advance(exec.agent, 'failed', FAIL_REASON) ?? 'advanced'
      return Promise.resolve([{ type: 'text' as const, text: `advance: ${decision}` }])
    },
  }))
}
