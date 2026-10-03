/**
 * Test-only fixture tool for A-588 (P0-02 U-1): an external network effect the
 * deployment policy forbids. Its `network-fetch` tag classifies to
 * `external-communication` (base cordis.patch.yml:368), which the A-588 profile's
 * deployment `forbid` rule denies. The body writes a marker, so whether the call
 * was PERFORMED is observed on disk: the deployment policy refusing it leaves no
 * marker; a policy override that lets it through leaves one.
 * @module tests/first100/fixtures/loader/a-588-policy-tamper/forbidden-tool
 */

import { writeFileSync } from 'node:fs'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

export const name = 'a-588-forbidden-tool'
export const inject = ['tools']

/**
 * Register the forbidden tool, whose body records that it ran.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ marker: string }} config - where the body records that it ran.
 */
export function apply(ctx, config) {
  ctx.tools.register(defineContentToolFixture({
    name: 'a588_forbidden',
    description: 'an external network effect the deployment policy forbids',
    riskDomainTags: ['network-fetch'],
    parameters: { note: { type: 'string', required: true, description: 'Any value.' } },
    execute: () => {
      writeFileSync(config.marker, 'performed')
      return Promise.resolve([{ type: 'text', text: 'performed' }])
    },
  }))
}
