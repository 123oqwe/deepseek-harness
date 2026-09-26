/**
 * P2-03 acceptance[2]: the side-effect class an action manifest records for
 * each risk class, one case per class, and the two properties the table must
 * keep: it covers every risk class, and it is monotone, so no domain tag earns
 * a lower manifest class than a lower-risk tag would.
 */
import { describe, expect, it } from 'vitest'
import { RISK_CLASSES_BY_ASCENDING_RISK, SIDE_EFFECT_CLASS_BY_RISK, sideEffectClassOf } from '../src/index.ts'
import type { ManifestSideEffectClass, RiskClass } from '../src/index.ts'

/** The manifest's own classes, lowest risk first; `destructive` is its highest. */
const MANIFEST_ORDER: readonly ManifestSideEffectClass[] = ['read', 'write', 'network', 'process', 'destructive']

/** Each risk class and the manifest class the delegate approved for it (2026-09-26). */
const EXPECTED: readonly (readonly [RiskClass, ManifestSideEffectClass])[] = [
  ['read', 'read'],
  ['local-reversible', 'write'],
  ['internal-write', 'write'],
  ['external-communication', 'network'],
  ['destructive', 'destructive'],
  ['financial', 'destructive'],
  ['security-sensitive', 'destructive'],
  ['safety-critical', 'destructive'],
]

describe('P2-03 acceptance[2]: the manifest records each risk class as one side-effect class', () => {
  for (const [riskClass, sideEffectClass] of EXPECTED) {
    it(`records ${riskClass} as ${sideEffectClass}`, () => {
      expect(sideEffectClassOf(riskClass)).toBe(sideEffectClass)
    })
  }

  it('covers every risk class, and nothing else', () => {
    expect(Object.keys(SIDE_EFFECT_CLASS_BY_RISK).toSorted()).toEqual(RISK_CLASSES_BY_ASCENDING_RISK.toSorted())
  })

  it('never records a riskier class as a lower manifest class', () => {
    const ranks = RISK_CLASSES_BY_ASCENDING_RISK.map(riskClass => MANIFEST_ORDER.indexOf(sideEffectClassOf(riskClass)))
    expect(ranks).not.toContain(-1)
    expect(ranks.every((rank, index) => index === 0 || rank >= (ranks[index - 1] ?? rank))).toBe(true)
  })
})
