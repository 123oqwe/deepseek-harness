/**
 * U-stage proof of Epic P0-05 acceptance[2]: an expired gate fails in the
 * release gate. `assertNoExpiredFeatureGates` is the real check
 * `scripts/release/verify.ts` wires into `pnpm run release:verify`'s `dsh`
 * family run -- the repository's genuine, pre-existing release-gate script
 * (real GitHub Actions release workflow; see its own module doc), reusing
 * `checkFeatureGateExpiry`'s real SemVer-precedence comparison
 * (`@deepseek-ai/dsh-feature-gates`, Epic P0-05 Provider-stage) rather than
 * a second implementation of it.
 */
import { describe, expect, it } from 'vitest'
import type { FeatureGateDeclaration, FeatureGateId } from '@deepseek-ai/dsh-feature-gates'
import { assertNoExpiredFeatureGates, RELEASE_GATE_FEATURE_GATES } from './feature-gate-expiry.ts'

const active: FeatureGateDeclaration = {
  id: 'active-gate' as FeatureGateId,
  owner: 'team-harness',
  introducedVersion: '0.1.0',
  defaultByProfile: { default: 'shadow' },
  removalVersion: '0.9.0',
}

const expired: FeatureGateDeclaration = {
  id: 'stale-gate' as FeatureGateId,
  owner: 'team-runtime',
  introducedVersion: '0.1.0',
  defaultByProfile: { default: 'enforce' },
  removalVersion: '0.1.0',
}

describe('assertNoExpiredFeatureGates', () => {
  it('passes over an empty declaration list', () => {
    expect(() => { assertNoExpiredFeatureGates([], '0.1.2-alpha.2') }).not.toThrow()
  })

  it('passes when every declared gate is still active for the release version', () => {
    expect(() => { assertNoExpiredFeatureGates([active], '0.1.2-alpha.2') }).not.toThrow()
  })

  it('fails, naming the gate, when a declared gate has passed its removalVersion', () => {
    expect(() => { assertNoExpiredFeatureGates([expired], '0.1.2-alpha.2') })
      .toThrow(/stale-gate.*removalVersion 0\.1\.0.*owner team-runtime/s)
  })

  it('names every expired gate, not only the first', () => {
    const secondExpired: FeatureGateDeclaration = { ...expired, id: 'second-stale-gate' as FeatureGateId }
    expect(() => { assertNoExpiredFeatureGates([active, expired, secondExpired], '0.1.2-alpha.2') })
      .toThrow(/2 feature gate\(s\)/)
  })
})

describe('RELEASE_GATE_FEATURE_GATES', () => {
  it('is empty -- no capability has migrated behind a gate yet', () => {
    expect(RELEASE_GATE_FEATURE_GATES).toEqual([])
  })
})
