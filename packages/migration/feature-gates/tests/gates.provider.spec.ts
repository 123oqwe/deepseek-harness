/**
 * Provider-stage verification for Epic P0-05 (Shadow/Enforce feature gates).
 * Real, executed proof of the three Provider-stage deliverables:
 *
 * - `resolveFeatureGate` -- must[3]'s `--dump-config` override chain (default
 *   -> profile -> settings -> env), pure over a `FeatureGateDeclaration` and
 *   the `FeatureGateNamespaceValue` shape a real
 *   `packages/settings/settings/src/index.ts`'s
 *   `SettingsProvider.register('feature-gates', schema).get()` would hand a
 *   caller -- see that file's `resolve()` (source of the `deepFreeze` a real
 *   `.get()` return value always carries) and `SettingsScope<T>.get(): T`.
 * - `evaluateFeatureGate` -- must[1] (shadow runs both decisions but applies
 *   only legacy's) and acceptance[0] (off and shadow apply the identical
 *   value for the same request) and acceptance[1] (the diff is recorded
 *   through a real {@link redactDecisionSummary} call, not a bare cast).
 * - `checkFeatureGateExpiry` -- acceptance[2]'s real version comparison.
 *
 * @module @deepseek-ai/dsh-feature-gates/tests/gates.provider
 */

import { describe, expect, it, vi } from 'vitest'
import {
  checkFeatureGateExpiry,
  evaluateFeatureGate,
  redactDecisionSummary,
  resolveFeatureGate,
  type FeatureGateDeclaration,
  type FeatureGateId,
  type FeatureGateNamespaceValue,
} from '../src/index.ts'

const GATE_ID = 'permission-gate' as FeatureGateId

const declaration: FeatureGateDeclaration = {
  id: GATE_ID,
  owner: 'team-harness',
  introducedVersion: '0.1.2-alpha.2',
  defaultByProfile: { default: 'off', headless: 'shadow' },
  removalVersion: '0.2.0',
}

describe('resolveFeatureGate (Epic P0-05 must[3]: --dump-config source + full override chain)', () => {
  it('resolves to the declaration default when no profile/settings/env candidate applies', () => {
    const resolution = resolveFeatureGate(declaration, 'default')
    expect(resolution).toEqual({
      gateId: GATE_ID,
      resolved: { source: 'default', value: 'off' },
      chain: [{ source: 'default', value: 'off' }],
    })
  })

  it('adds a profile entry only when the active profile has its own explicit defaultByProfile key', () => {
    const withProfile = resolveFeatureGate(declaration, 'headless')
    expect(withProfile.chain).toEqual([
      { source: 'default', value: 'off' },
      { source: 'profile', value: 'shadow' },
    ])
    expect(withProfile.resolved).toEqual({ source: 'profile', value: 'shadow' })

    const withoutProfile = resolveFeatureGate(declaration, 'ci')
    expect(withoutProfile.chain).toEqual([{ source: 'default', value: 'off' }])
  })

  it('never adds a duplicate profile entry when the active profile is literally "default"', () => {
    const resolution = resolveFeatureGate(declaration, 'default')
    expect(resolution.chain).toHaveLength(1)
  })

  it('adds a settings entry only when the namespace value carries this gate\'s id', () => {
    const settingsValue: FeatureGateNamespaceValue = { 'some-other-gate': 'enforce' }
    const resolution = resolveFeatureGate(declaration, 'default', { settings: settingsValue })
    expect(resolution.chain).toEqual([{ source: 'default', value: 'off' }])
  })

  it('reads a real, frozen SettingsScope<FeatureGateNamespaceValue>.get() shape -- packages/settings/settings/src/index.ts always deepFreezes the resolved value a scope hands back -- without attempting to mutate it', () => {
    const frozenNamespaceValue: FeatureGateNamespaceValue = Object.freeze({ [GATE_ID]: 'enforce' })
    const resolution = resolveFeatureGate(declaration, 'default', { settings: frozenNamespaceValue })
    expect(resolution.chain).toEqual([
      { source: 'default', value: 'off' },
      { source: 'settings', value: 'enforce' },
    ])
    expect(resolution.resolved).toEqual({ source: 'settings', value: 'enforce' })
  })

  it('env, when provided, always wins as the highest-precedence resolved entry over default/profile/settings', () => {
    const resolution = resolveFeatureGate(declaration, 'headless', {
      settings: { [GATE_ID]: 'shadow' },
      env: 'enforce',
    })
    expect(resolution.chain).toEqual([
      { source: 'default', value: 'off' },
      { source: 'profile', value: 'shadow' },
      { source: 'settings', value: 'shadow' },
      { source: 'env', value: 'enforce' },
    ])
    expect(resolution.resolved).toEqual({ source: 'env', value: 'enforce' })
  })

  it('chain order is always lowest-precedence first regardless of which candidates are present', () => {
    const resolution = resolveFeatureGate(declaration, 'headless', { settings: { [GATE_ID]: 'off' } })
    expect(resolution.chain.map(entry => entry.source)).toEqual(['default', 'profile', 'settings'])
  })
})

describe('evaluateFeatureGate (Epic P0-05 must[1] + acceptance[0]: shadow never changes the applied outcome)', () => {
  function outcomes() {
    const legacy = vi.fn(() => ({ value: 'legacy-value', summary: { outcome: 'deny', apiKey: 'sk-legacy-secret' } }))
    const candidate = vi.fn(() => ({ value: 'candidate-value', summary: { outcome: 'allow', apiKey: 'sk-candidate-secret' } }))
    return { legacy, candidate }
  }

  it('off applies only legacy\'s value and never invokes candidate', () => {
    const { legacy, candidate } = outcomes()
    const evaluation = evaluateFeatureGate(GATE_ID, 'off', legacy, candidate, ['outcome'])
    expect(evaluation).toEqual({ value: 'legacy-value' })
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(candidate).not.toHaveBeenCalled()
  })

  it('enforce applies only candidate\'s value and never invokes legacy', () => {
    const { legacy, candidate } = outcomes()
    const evaluation = evaluateFeatureGate(GATE_ID, 'enforce', legacy, candidate, ['outcome'])
    expect(evaluation).toEqual({ value: 'candidate-value' })
    expect(candidate).toHaveBeenCalledTimes(1)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('shadow invokes BOTH legacy and candidate decision logic (must[1]: shadow executes the decision)', () => {
    const { legacy, candidate } = outcomes()
    evaluateFeatureGate(GATE_ID, 'shadow', legacy, candidate, ['outcome'])
    expect(legacy).toHaveBeenCalledTimes(1)
    expect(candidate).toHaveBeenCalledTimes(1)
  })

  it('acceptance[0]: the same request produces the IDENTICAL applied value under off and under shadow, even though legacy and candidate disagree', () => {
    const off = outcomes()
    const shadow = outcomes()
    const offResult = evaluateFeatureGate(GATE_ID, 'off', off.legacy, off.candidate, ['outcome'])
    const shadowResult = evaluateFeatureGate(GATE_ID, 'shadow', shadow.legacy, shadow.candidate, ['outcome'])
    expect(offResult.value).toBe('legacy-value')
    expect(shadowResult.value).toBe('legacy-value')
    expect(shadowResult.value).toBe(offResult.value)
    // Never the candidate's value -- must[1]'s "does not change the actual outcome".
    expect(shadowResult.value).not.toBe('candidate-value')
  })

  it('shadow never returns a shadowRecord for off or enforce', () => {
    const { legacy, candidate } = outcomes()
    expect(evaluateFeatureGate(GATE_ID, 'off', legacy, candidate, ['outcome']).shadowRecord).toBeUndefined()
    expect(evaluateFeatureGate(GATE_ID, 'enforce', legacy, candidate, ['outcome']).shadowRecord).toBeUndefined()
  })

  describe('acceptance[1]: shadow decision diff is fully recorded without leaking sensitive parameters', () => {
    it('records a shadowRecord with the redacted legacy/candidate summaries and the real gateId', () => {
      const { legacy, candidate } = outcomes()
      const evaluation = evaluateFeatureGate(GATE_ID, 'shadow', legacy, candidate, ['outcome'])
      expect(evaluation.shadowRecord).toEqual({
        gateId: GATE_ID,
        legacySummary: { outcome: 'deny' },
        shadowSummary: { outcome: 'allow' },
        differs: true,
      })
    })

    it('never lets a field outside the allowlist reach legacySummary/shadowSummary -- a real redaction call, not a bare cast', () => {
      const { legacy, candidate } = outcomes()
      const evaluation = evaluateFeatureGate(GATE_ID, 'shadow', legacy, candidate, ['outcome'])
      const serialized = JSON.stringify(evaluation.shadowRecord)
      expect(serialized).not.toContain('sk-legacy-secret')
      expect(serialized).not.toContain('sk-candidate-secret')
      expect(serialized).not.toContain('apiKey')
    })

    it('differs reflects the RAW decision summaries, including a field the allowlist later strips -- shadow mode must not under-report real behavioral drift', () => {
      const legacy = () => ({ value: 'same-value', summary: { outcome: 'allow', apiKey: 'sk-legacy-secret' } })
      const candidate = () => ({ value: 'same-value', summary: { outcome: 'allow', apiKey: 'sk-candidate-secret' } })
      const evaluation = evaluateFeatureGate(GATE_ID, 'shadow', legacy, candidate, ['outcome'])
      // The redacted summaries are identical (apiKey is not allowlisted)...
      expect(evaluation.shadowRecord?.legacySummary).toEqual(evaluation.shadowRecord?.shadowSummary)
      // ...but `differs` still reports true because the RAW summaries actually disagreed.
      expect(evaluation.shadowRecord?.differs).toBe(true)
    })

    it('differs is false when the raw summaries genuinely agree', () => {
      const legacy = () => ({ value: 'v', summary: { outcome: 'allow' } })
      const candidate = () => ({ value: 'v', summary: { outcome: 'allow' } })
      const evaluation = evaluateFeatureGate(GATE_ID, 'shadow', legacy, candidate, ['outcome'])
      expect(evaluation.shadowRecord?.differs).toBe(false)
    })
  })
})

describe('redactDecisionSummary (Epic P0-05 acceptance[1]: real runtime redaction, not a type-level cast)', () => {
  it('keeps only allowlisted fields present in the summary', () => {
    const redacted = redactDecisionSummary({ outcome: 'allow', ruleId: 'r1', apiKey: 'sk-secret' }, ['outcome', 'ruleId'])
    expect(redacted).toEqual({ outcome: 'allow', ruleId: 'r1' })
  })

  it('drops every field not on the allowlist', () => {
    const redacted = redactDecisionSummary({ outcome: 'allow', apiKey: 'sk-secret', rawRequestBody: { token: 'x' } }, ['outcome'])
    expect(Object.hasOwn(redacted, 'apiKey')).toBe(false)
    expect(Object.hasOwn(redacted, 'rawRequestBody')).toBe(false)
  })

  it('omits an allowlisted field the summary does not actually carry, rather than adding it as undefined', () => {
    const redacted = redactDecisionSummary({ outcome: 'allow' }, ['outcome', 'ruleId'])
    expect(Object.hasOwn(redacted, 'ruleId')).toBe(false)
    expect(redacted).toEqual({ outcome: 'allow' })
  })

  it('returns an empty object for an empty allowlist', () => {
    const redacted = redactDecisionSummary({ outcome: 'allow', apiKey: 'sk-secret' }, [])
    expect(redacted).toEqual({})
  })
})

describe('checkFeatureGateExpiry (Epic P0-05 acceptance[2]: expired gate fails the release gate, real version comparison)', () => {
  it('is active for a release strictly before removalVersion', () => {
    expect(checkFeatureGateExpiry(declaration, '0.1.9')).toBe('active')
  })

  it('is expired for a release exactly at removalVersion (boundary)', () => {
    expect(checkFeatureGateExpiry(declaration, '0.2.0')).toBe('expired')
  })

  it('is expired for a release strictly after removalVersion', () => {
    expect(checkFeatureGateExpiry(declaration, '0.2.1')).toBe('expired')
  })

  it('compares multi-digit segments numerically, not lexically', () => {
    const gate: FeatureGateDeclaration = { ...declaration, removalVersion: '0.9.0' }
    // A naive string comparison would say "0.10.0" < "0.9.0" and wrongly report "active".
    expect(checkFeatureGateExpiry(gate, '0.10.0')).toBe('expired')
  })

  it('a prerelease of the removal version is still active -- SemVer precedence: a prerelease sorts below its release', () => {
    expect(checkFeatureGateExpiry(declaration, '0.2.0-alpha.1')).toBe('active')
  })

  it('compares prerelease identifiers numerically, not lexically', () => {
    const gate: FeatureGateDeclaration = { ...declaration, removalVersion: '0.1.2-alpha.9' }
    // A naive string comparison would say "alpha.10" < "alpha.9" and wrongly report "active".
    expect(checkFeatureGateExpiry(gate, '0.1.2-alpha.10')).toBe('expired')
  })

  it('rejects a malformed version string instead of silently comparing garbage', () => {
    expect(() => checkFeatureGateExpiry(declaration, 'not-a-version')).toThrow(TypeError)
  })
})
