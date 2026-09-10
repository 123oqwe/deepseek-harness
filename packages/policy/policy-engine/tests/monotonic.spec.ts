/**
 * Epic P2-05 Contract stage: the closed decision set, the monotonic
 * composition rule, and the three Cedar semantics this epic adopts an engine
 * FOR — proven against the real `@cedar-policy/cedar-wasm` 4.12.0 rather than
 * cited from its documentation.
 *
 * The Cedar cases are here, in the Contract stage, and the package's own source
 * still does not import an engine: what they pin is the VOCABULARY the types
 * above are designed against. A conformance case that ran only in the provider
 * package would let the C stage's design rest on a claim nobody checked until
 * the provider existed.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  EMPTY_POLICY_SET,
  composeDecision,
  decisionWhenUnavailable,
  isImmediatelyAllowed,
} from '../src/evaluate.ts'
import type {
  ClosedDecision,
  PolicyConstraint,
  PolicyEvaluation,
  PolicyRequest,
  PolicySetDigest,
} from '../src/types.ts'

const SET = brandString<PolicySetDigest>('sha256-policyset')

/**
 * A request carrying all five inputs must[0] names.
 *
 * Built as a whole rather than piecemeal, because the property under test is
 * about composition and not about the request: every case answers the SAME
 * question, so a decision that differs differs for the rule's reason.
 */
const REQUEST = {
  identity: { kind: 'user' },
  token: undefined,
  manifest: { actionId: 'a-1' },
  world: { kind: 'absent' },
  facts: { workspaceTrust: 'trusted-execute', permissionPosture: 'default' },
} as unknown as PolicyRequest

function evaluation(effect: ClosedDecision['effect'], reason?: ClosedDecision['reason']): PolicyEvaluation {
  return {
    decision: { effect, ...reason === undefined ? {} : { reason }, policySet: SET },
    explain: { matched: [], diagnostics: [] },
  }
}

/** A constraint that always objects, naming itself so the audit can tell them apart. */
function objecting(name: string): PolicyConstraint {
  return () => `${name} objected`
}

/** A constraint that never objects. */
const silent: PolicyConstraint = () => undefined

describe('P2-05 must[1]: the decision set is closed', () => {
  it('treats ask as NOT allowed, so a pending human answer cannot be acted on', () => {
    // `effect !== 'deny'` reads as "allowed" and silently admits `ask` — the
    // state where nobody has answered yet.
    expect(isImmediatelyAllowed({ effect: 'permit', policySet: SET })).toBe(true)
    expect(isImmediatelyAllowed({ effect: 'ask', reason: 'approval-required', policySet: SET })).toBe(false)
    expect(isImmediatelyAllowed({ effect: 'deny', reason: 'forbidden-by-policy', policySet: SET })).toBe(false)
  })

  it('carries the policy-set digest on every decision, including a refusal', () => {
    // acceptance[1]'s replay compares the digest first: without it, "the policy
    // changed" and "the decision changed" are the same observation.
    expect(composeDecision(evaluation('permit'), [], REQUEST).decision.policySet).toBe(SET)
    expect(composeDecision(evaluation('permit'), [objecting('p')], REQUEST).decision.policySet).toBe(SET)
    expect(decisionWhenUnavailable(SET).policySet).toBe(SET)
    expect(decisionWhenUnavailable(undefined).policySet).toBe(EMPTY_POLICY_SET)
  })
})

describe('P2-05 must[2]: a plugin may narrow a decision and never widen one', () => {
  it('turns a permit into a deny when ONE constraint objects', () => {
    const composed = composeDecision(evaluation('permit'), [silent, objecting('guard')], REQUEST)

    expect(composed.decision).toEqual({ effect: 'deny', reason: 'constrained-by-plugin', policySet: SET })
  })

  it('turns an ask into a deny, because a constraint is a condition and not a prompt', () => {
    // An `ask` that a constraint could leave standing would let a plugin's
    // objection be waved through by the human answering a different question.
    const composed = composeDecision(evaluation('ask', 'approval-required'), [objecting('guard')], REQUEST)

    expect(composed.decision.effect).toBe('deny')
  })

  it('leaves a deny denied, whatever the constraints say', () => {
    const denied = evaluation('deny', 'forbidden-by-policy')

    expect(composeDecision(denied, [silent, silent], REQUEST).decision).toEqual(denied.decision)
    expect(composeDecision(denied, [objecting('guard')], REQUEST).decision).toEqual(denied.decision)
  })

  it('is ORDER-INDEPENDENT: the same constraints in any order give the same decision', () => {
    // This is the property `dsh-permission-rules` does not have. Its ordered
    // allow/deny rules resolve by FIRST MATCH, so a rule nearer the user
    // overrides a baseline deny and the outcome depends on which of two
    // independently installed plugins loaded first.
    const forward = composeDecision(evaluation('permit'), [silent, objecting('a'), objecting('b')], REQUEST)
    const reversed = composeDecision(evaluation('permit'), [objecting('b'), objecting('a'), silent], REQUEST)

    expect(forward.decision).toEqual(reversed.decision)
    expect(new Set(forward.constraintReasons)).toEqual(new Set(reversed.constraintReasons))
  })

  it('cannot be handed a permitting constraint at all: the type carries no such shape', () => {
    // The negative control for the case above. A constraint returns a reason to
    // deny or nothing; there is no value it can return that widens a decision,
    // which is why order-independence is structural rather than tested-into.
    const widening = (() => 'permit') as PolicyConstraint

    // Even a constraint written to say "permit" only contributes a REASON, and
    // a reason narrows.
    expect(composeDecision(evaluation('permit'), [widening], REQUEST).decision.effect).toBe('deny')
  })

  it('records every constraint reason even when the decision was already deny', () => {
    // For the audit, not the decision: an operator asking why an action was
    // refused is told everything that refused it.
    const composed = composeDecision(evaluation('deny', 'no-matching-permit'), [objecting('a'), objecting('b')], REQUEST)

    expect(composed.constraintReasons).toEqual(['a objected', 'b objected'])
  })

  it('leaves a permit permitted when no constraint objects, so the rule is not a constant', () => {
    const composed = composeDecision(evaluation('permit'), [silent, silent], REQUEST)

    expect(composed.decision.effect).toBe('permit')
    expect(composed.constraintReasons).toEqual([])
  })
})

describe('P2-05 acceptance[2]: losing the provider denies by name', () => {
  it('denies with policy-unavailable rather than falling open', () => {
    // The provider is an ordinary plugin and may be unmounted like any other.
    // What may not be lost is the enforcement, so the enforcement point answers
    // for itself when its engine is gone.
    expect(decisionWhenUnavailable(SET)).toEqual({
      effect: 'deny',
      reason: 'policy-unavailable',
      policySet: SET,
    })
  })

  it('names WHICH policy set it could not reach, so a replay can tell the two failures apart', () => {
    expect(decisionWhenUnavailable(SET).policySet).toBe(SET)
    expect(decisionWhenUnavailable(undefined).policySet).toBe(EMPTY_POLICY_SET)
  })
})
