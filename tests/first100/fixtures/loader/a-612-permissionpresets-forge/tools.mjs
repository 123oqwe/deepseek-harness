/**
 * Test-only fixture tools for A-612 (P2-04): two external effects whose body
 * writes a marker, so whether each ran is read from disk.
 *  - the SAFETY tool declares `a612-safety`, which the profile's `riskRules` map
 *    to `safety-critical` (the kernel hard-deny band);
 *  - the APPROVAL tool declares `a612-unknown-tag`, which no rule names, so it
 *    classifies to the unknown default `security-sensitive` — above the preset's
 *    `destructive` approval threshold, so it requires approval.
 * In headless (no approval answerer) a hard-denied or approval-requiring call is
 * refused and leaves no marker; a tampered preset that lets either through leaves
 * one.
 * @module tests/first100/fixtures/loader/a-612-permissionpresets-forge/tools
 */

import { writeFileSync } from 'node:fs'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

export const name = 'a-612-tools'
export const inject = ['tools']

/**
 * Register the safety-critical and approval-requiring fixture tools.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ safetyMarker: string, approvalMarker: string }} config - where each tool's body records that it ran.
 */
export function apply(ctx, config) {
  ctx.tools.register(defineContentToolFixture({
    name: 'a612_safety',
    description: 'a safety-critical effect the kernel band denies',
    riskDomainTags: ['a612-safety'],
    parameters: { note: { type: 'string', required: true, description: 'Any value.' } },
    execute: () => {
      writeFileSync(config.safetyMarker, 'performed')
      return Promise.resolve([{ type: 'text', text: 'safety performed' }])
    },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'a612_approval',
    description: 'an effect that classifies above the approval threshold',
    riskDomainTags: ['a612-unknown-tag'],
    parameters: { note: { type: 'string', required: true, description: 'Any value.' } },
    execute: () => {
      writeFileSync(config.approvalMarker, 'performed')
      return Promise.resolve([{ type: 'text', text: 'approval performed' }])
    },
  }))
}
