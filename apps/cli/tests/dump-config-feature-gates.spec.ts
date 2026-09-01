/**
 * U-stage proof of Epic P0-05 must[3]: `--dump-config` must show the final
 * resolved gate's source and full override chain. `renderFeatureGateDump`
 * (apps/cli/src/dump-config.ts) is the pure rendering half `runDumpConfig`
 * calls; this file proves its exact output against real
 * `resolveProfileFeatureGates` resolutions (apps/cli/src/profile-boot.ts),
 * not a hand-built fixture disconnected from the resolver.
 */
import { describe, expect, it } from 'vitest'
import type { FeatureGateDeclaration, FeatureGateId } from '@deepseek-ai/dsh-feature-gates'
import { resolveProfileFeatureGates } from '../src/profile-boot.ts'
import { renderFeatureGateDump } from '../src/dump-config.ts'

const declaration: FeatureGateDeclaration = {
  id: 'permission-gate' as FeatureGateId,
  owner: 'team-harness',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'off', headless: 'shadow' },
  removalVersion: '0.2.0',
}

const second: FeatureGateDeclaration = {
  id: 'run-journal-gate' as FeatureGateId,
  owner: 'team-runtime',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'enforce' },
  removalVersion: '0.3.0',
}

describe('renderFeatureGateDump', () => {
  it('prints nothing when no gate is declared -- this repository\'s real state today', () => {
    expect(renderFeatureGateDump([])).toBe('')
  })

  it('prints one comment-prefixed block naming the resolved source/value and the full override chain', () => {
    const resolutions = resolveProfileFeatureGates('headless', [declaration], {
      DSH_FEATURE_GATE_PERMISSION_GATE: 'enforce',
    })
    expect(renderFeatureGateDump(resolutions)).toBe([
      '# == feature-gates',
      '# permission-gate: enforce (source: env)',
      '#   default: off',
      '#   profile: shadow',
      '#   env: enforce',
      '',
    ].join('\n'))
  })

  it('stays a loadable YAML document: every printed line is a comment', () => {
    const resolutions = resolveProfileFeatureGates('headless', [declaration], {})
    const rendered = renderFeatureGateDump(resolutions)
    for (const line of rendered.split('\n')) {
      if (line === '') continue
      expect(line.startsWith('#')).toBe(true)
    }
  })

  it('renders multiple declared gates in resolution order', () => {
    const resolutions = resolveProfileFeatureGates('default', [declaration, second], {})
    expect(renderFeatureGateDump(resolutions)).toBe([
      '# == feature-gates',
      '# permission-gate: off (source: default)',
      '#   default: off',
      '# run-journal-gate: enforce (source: default)',
      '#   default: enforce',
      '',
    ].join('\n'))
  })
})
