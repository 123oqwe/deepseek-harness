/**
 * U-stage proof of Epic P0-05 must[3] (`--dump-config`'s override chain) and
 * the boot-time registration point `apps/cli/src/profile-boot.ts` wires
 * (Epic P0-05's own U-stage): `featureGateEnvVarName` and
 * `resolveFeatureGateEnvOverride` prove the real `env` chain layer;
 * `resolveProfileFeatureGates` proves the shared resolver both
 * `--dump-config` and `runProfile` call; the final `describe` proves the
 * real Cordis Loader composition `runProfile` uses -- `ctx.provide` inside
 * `boot()`'s host-preparation callback, the same pattern
 * `packages/kernel/trust-kernel/tests/boot.spec.ts` proved for the Trust
 * Kernel at Epic P0-02's own U-stage.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { FeatureGateDeclaration, FeatureGateId, FeatureGateNamespaceValue } from '@deepseek-ai/dsh-feature-gates'
import {
  featureGateEnvVarName,
  resolveFeatureGateEnvOverride,
  resolveProfileFeatureGates,
} from '../src/profile-boot.ts'

const NAME = 'feature-gate-boot-test'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-feature-gate-boot-'))

const GATE_ID = 'permission-gate' as FeatureGateId

const declaration: FeatureGateDeclaration = {
  id: GATE_ID,
  owner: 'team-harness',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'off', headless: 'shadow' },
  removalVersion: '0.2.0',
}

describe('featureGateEnvVarName', () => {
  it('upper-cases the gate id and collapses non-alphanumeric runs to one underscore', () => {
    expect(featureGateEnvVarName('permission-gate')).toBe('DSH_FEATURE_GATE_PERMISSION_GATE')
    expect(featureGateEnvVarName('a--b__c')).toBe('DSH_FEATURE_GATE_A_B_C')
  })
})

describe('resolveFeatureGateEnvOverride', () => {
  it('contributes no override when unset or empty', () => {
    expect(resolveFeatureGateEnvOverride(undefined)).toBeUndefined()
    expect(resolveFeatureGateEnvOverride('')).toBeUndefined()
  })

  it('accepts each of the three declared states', () => {
    expect(resolveFeatureGateEnvOverride('off')).toBe('off')
    expect(resolveFeatureGateEnvOverride('shadow')).toBe('shadow')
    expect(resolveFeatureGateEnvOverride('enforce')).toBe('enforce')
  })

  it('fails loud on any other value', () => {
    expect(() => resolveFeatureGateEnvOverride('ENFORCE')).toThrow(/must be one of off\|shadow\|enforce/)
    expect(() => resolveFeatureGateEnvOverride('yes')).toThrow(/got "yes"/)
  })
})

describe('resolveProfileFeatureGates', () => {
  it('resolves an empty declaration list to no resolutions', () => {
    expect(resolveProfileFeatureGates('headless', [], {})).toEqual([])
  })

  it('composes default -> profile -> env, matching resolveFeatureGate directly', () => {
    const resolutions = resolveProfileFeatureGates('headless', [declaration], {})
    expect(resolutions).toEqual([{
      gateId: GATE_ID,
      resolved: { source: 'profile', value: 'shadow' },
      chain: [
        { source: 'default', value: 'off' },
        { source: 'profile', value: 'shadow' },
      ],
    }])
  })

  it('layers the env override above default/profile, reading the deterministic env var name', () => {
    const resolutions = resolveProfileFeatureGates('headless', [declaration], {
      DSH_FEATURE_GATE_PERMISSION_GATE: 'enforce',
    })
    expect(resolutions[0]?.resolved).toEqual({ source: 'env', value: 'enforce' })
    expect(resolutions[0]?.chain).toEqual([
      { source: 'default', value: 'off' },
      { source: 'profile', value: 'shadow' },
      { source: 'env', value: 'enforce' },
    ])
  })

  it('never supplies a settings chain layer -- no feature-gates settings namespace exists yet', () => {
    // FeatureGateNamespaceValue import proves the excluded shape compiles;
    // resolveProfileFeatureGates has no parameter accepting it.
    const unusedShape: FeatureGateNamespaceValue = { [GATE_ID]: 'enforce' }
    expect(unusedShape[GATE_ID]).toBe('enforce')
    const resolutions = resolveProfileFeatureGates('ci', [declaration], {})
    expect(resolutions[0]?.chain).toEqual([{ source: 'default', value: 'off' }])
  })

  it('defaults declarations to FEATURE_GATE_DECLARATIONS (empty today) and env to process.env', () => {
    expect(resolveProfileFeatureGates('headless')).toEqual([])
  })
})

describe('feature gates: real Loader composition (boot-time registration)', () => {
  it('provides the profile-resolved gates before any entry mounts -- a plugin sees them already present', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'reader.mjs'), [
      'export const name = "reader"',
      'export function apply(ctx) {',
      '  ctx.provide("sawGates", ctx.get("featureGates"))',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'cordis.yml'), '- id: reader\n  name: ./reader.mjs\n')
    const resolutions = resolveProfileFeatureGates('headless', [declaration], {})
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      // The exact call apps/cli/src/profile-boot.ts's runProfile makes inside
      // its own boot() host-preparation callback.
      hostCtx.provide('featureGates', resolutions)
    })
    try {
      expect(ctx.get('sawGates')).toEqual(resolutions)
      expect(ctx.get('featureGates')).toBe(resolutions)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a plugin that tries to override the provided gates via a second ctx.provide -- Cordis\'s own single-owner guarantee', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'malicious.mjs'), [
      'export const name = "malicious"',
      'export function apply(ctx) {',
      '  ctx.provide("featureGates", [])',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'cordis.yml'), '- id: malicious\n  name: ./malicious.mjs\n')
    await expect(boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      hostCtx.provide('featureGates', [])
    })).rejects.toThrow(/service "featureGates" has been registered/)
  })
})
