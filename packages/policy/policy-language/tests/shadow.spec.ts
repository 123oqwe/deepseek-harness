/**
 * P2-10 must[1]'s two remaining halves: shadow evaluation and diff explain.
 *
 * The cases come in pairs. A shadow that reports the live decision is
 * indistinguishable from one that ignores the candidate entirely until a case
 * shows the candidate's answer reaching the report; a diff that finds a change
 * is indistinguishable from one that calls everything changed until a case
 * shows two sets differing in nothing.
 *
 * The diff cases compile their sets through this package's own compiler rather
 * than hand-writing a `CompiledPolicySet`: the property under test is that the
 * diff and the pin agree, and a hand-made set could be given a pin that no
 * compile would produce.
 */
import { describe, expect, it } from 'vitest'
import type { ClosedDecision, PolicyEvaluation, PolicySetDigest } from '@deepseek-ai/dsh-policy-engine'
import { brandString } from '@deepseek-ai/dsh-brand'
import { compilePolicySet, type CompiledPolicySet, type PolicyPinInputs } from '../src/compiler.ts'
import { DSH_CONTEXT_KEYS } from '../src/schema.ts'
import { diffExplain, shadowEvaluate } from '../src/shadow.ts'

const INPUTS: PolicyPinInputs = { contextKeys: DSH_CONTEXT_KEYS, engineVersion: '4.12.0' }

const BASELINE = 'permit(principal, action, resource);'
const GATED = 'permit(principal, action, resource) when { context.sideEffectClass == "read" };'
const NARROWED = 'permit(principal, action, resource) when { context.sideEffectClass == "write" };'

/** One engine answer, as a caller already holds it. */
function evaluation(decision: Partial<ClosedDecision> & { effect: ClosedDecision['effect'] }, matched: readonly string[]): PolicyEvaluation {
  return {
    decision: {
      effect: decision.effect,
      ...decision.reason === undefined ? {} : { reason: decision.reason },
      policySet: decision.policySet ?? brandString<PolicySetDigest>('pin-live'),
    },
    explain: { matched: matched.map(id => brandString<PolicyEvaluation['explain']['matched'][number]>(id)), diagnostics: [] },
  }
}

/** A compiled set, or a failure naming the refusal. */
function compiled(policies: Readonly<Record<string, string>>): CompiledPolicySet {
  const result = compilePolicySet(policies, INPUTS)
  if (!result.ok) throw new Error(`expected a compiled set, got ${result.reason}`)
  return result
}

describe('P2-10 must[1]: a shadow run cannot change what happens', () => {
  const live = evaluation({ effect: 'permit' }, ['baseline-permit'])

  it('P2-10 P: shadow reports the live decision verbatim, whatever the candidate said', () => {
    const candidate = evaluation({ effect: 'deny', reason: 'forbidden-by-policy', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated'])
    const outcome = shadowEvaluate(live, candidate)
    expect(outcome.decision).toStrictEqual(live.decision)
    expect(outcome.decision.effect).toBe('permit')
  })

  it('P2-10 P: shadow flags disagreement when the candidate would deny what live permits', () => {
    const candidate = evaluation({ effect: 'deny', reason: 'forbidden-by-policy', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated'])
    expect(shadowEvaluate(live, candidate).agrees).toBe(false)
  })

  it('P2-10 P: shadow agrees when both reach the same effect, though the two sets are different', () => {
    const candidate = evaluation({ effect: 'permit', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated'])
    // The positive control for the case above, and the reason `agrees` is not
    // a whole-decision comparison: the digests differ by definition.
    expect(candidate.decision.policySet).not.toBe(live.decision.policySet)
    expect(shadowEvaluate(live, candidate).agrees).toBe(true)
  })

  it('P2-10 P: a shadow run carries the candidate\'s explain, never the live one', () => {
    const candidate = evaluation({ effect: 'permit', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated'])
    expect(shadowEvaluate(live, candidate).shadow.matched).toStrictEqual(candidate.explain.matched)
    expect(shadowEvaluate(live, candidate).shadow.matched).not.toStrictEqual(live.explain.matched)
  })

  it('P2-10 P: a disagreement says which policies each side matched', () => {
    const candidate = evaluation({ effect: 'deny', reason: 'forbidden-by-policy', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated', 'baseline-permit'])
    const outcome = shadowEvaluate(evaluation({ effect: 'permit' }, ['zeta', 'baseline-permit']), candidate)
    expect(outcome.onlyLive).toStrictEqual(['zeta'])
    expect(outcome.onlyShadow).toStrictEqual(['gated'])
  })

  it('P2-10 P: two sides that matched the same policies report nothing on either list', () => {
    // The positive control for the case above: without it, a pair of lists
    // that always named everything would satisfy it.
    const outcome = shadowEvaluate(
      evaluation({ effect: 'permit' }, ['baseline-permit', 'zeta']),
      evaluation({ effect: 'permit', policySet: brandString<PolicySetDigest>('pin-candidate') }, ['zeta', 'baseline-permit']),
    )
    expect([outcome.onlyLive, outcome.onlyShadow]).toStrictEqual([[], []])
    expect(outcome.agrees).toBe(true)
  })

  it('P2-10 P: a difference in reason alone is a disagreement', () => {
    const denyFor = (reason: NonNullable<ClosedDecision['reason']>): PolicyEvaluation =>
      evaluation({ effect: 'deny', reason, policySet: brandString<PolicySetDigest>('pin-candidate') }, ['gated'])
    expect(shadowEvaluate(denyFor('forbidden-by-policy'), denyFor('forbidden-by-policy')).agrees).toBe(true)
    expect(shadowEvaluate(denyFor('forbidden-by-policy'), denyFor('no-matching-permit')).agrees).toBe(false)
  })
})

describe('P2-10 must[1]: a diff says what changed in the unit an explain reports', () => {
  it('P2-10 P: the diff names what was added and what was removed, by policy id', () => {
    const before = compiled({ 'baseline-permit': BASELINE, gated: GATED })
    const after = compiled({ gated: GATED, extra: BASELINE })
    const diff = diffExplain(before, after)
    expect(diff.added).toStrictEqual(['extra'])
    expect(diff.removed).toStrictEqual(['baseline-permit'])
    expect(diff.changed).toStrictEqual([])
  })

  it('P2-10 P: a policy whose text changed is reported as changed, not as added and removed', () => {
    const before = compiled({ 'baseline-permit': BASELINE, gated: GATED })
    const after = compiled({ 'baseline-permit': BASELINE, gated: NARROWED })
    const diff = diffExplain(before, after)
    expect(diff.changed).toStrictEqual(['gated'])
    expect([diff.added, diff.removed]).toStrictEqual([[], []])
  })

  it('P2-10 P: two sets that compile to the same pin differ in nothing', () => {
    const before = compiled({ 'baseline-permit': BASELINE, gated: GATED })
    const after = compiled({ gated: GATED, 'baseline-permit': BASELINE })
    const diff = diffExplain(before, after)
    // The pin is taken over the canonical text, so listing the same policies
    // in another order is the same set — and the diff has to say so too, or a
    // deployment gets two accounts of one upgrade.
    expect(diff.afterPin).toBe(diff.beforePin)
    expect([diff.added, diff.removed, diff.changed]).toStrictEqual([[], [], []])
  })

  it('P2-10 P: a changed pin and an empty diff cannot both happen for the same pair', () => {
    const before = compiled({ 'baseline-permit': BASELINE })
    const after = compiled({ 'baseline-permit': BASELINE, gated: GATED })
    const diff = diffExplain(before, after)
    expect(diff.afterPin).not.toBe(diff.beforePin)
    expect([...diff.added, ...diff.removed, ...diff.changed].length).toBeGreaterThan(0)
  })

  it('P2-10 P: the lists are in id order, so two runs over one pair read the same', () => {
    const before = compiled({ 'baseline-permit': BASELINE })
    const after = compiled({ 'baseline-permit': BASELINE, zeta: GATED, alpha: NARROWED })
    expect(diffExplain(before, after).added).toStrictEqual(['alpha', 'zeta'])
    expect(diffExplain(before, after)).toStrictEqual(diffExplain(before, after))
  })
})
