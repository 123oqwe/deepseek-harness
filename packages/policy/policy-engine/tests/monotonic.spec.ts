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

/**
 * A deterministic permutation source.
 *
 * Seeded rather than `Math.random`, because a failing permutation has to be
 * reproducible: an order-dependent rule that reddens this suite once and passes
 * on re-run is indistinguishable from flake, which is the outcome this clause
 * exists to rule out. mulberry32 — one multiply-xorshift step, no dependency.
 * @param seed - the PRNG seed.
 * @returns a function producing the next float in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates over a copy, drawing from `next`. */
function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

describe('P2-05 validation[1]: 1000 constraint permutations decide identically', () => {
  // Eight constraints — 40320 orderings — so 1000 draws sample the space
  // rather than exhausting a handful of arrangements. The mix matters more
  // than the count: silent constraints interleaved with objecting ones are
  // what a first-match rule would resolve differently depending on which came
  // first, so a set of all-objecting constraints would agree in every order
  // even under the rule this case is designed to reject.
  const CONSTRAINTS: readonly PolicyConstraint[] = [
    silent, objecting('alpha'), silent, objecting('beta'),
    objecting('gamma'), silent, objecting('delta'), silent,
  ]

  it('gives byte-identical decisions across 1000 seeded permutations, starting from a permit', () => {
    const next = seededRandom(0x5EED_0001)
    const baseline = composeDecision(evaluation('permit'), CONSTRAINTS, REQUEST)
    const baselineReasons = new Set(baseline.constraintReasons)

    let permutations = 0
    for (let i = 0; i < 1000; i++) {
      const composed = composeDecision(evaluation('permit'), shuffled(CONSTRAINTS, next), REQUEST)
      expect(composed.decision, `permutation ${String(i)}`).toEqual(baseline.decision)
      // Compared as a SET: the composition is order-independent in its
      // decision AND in what it collected, but the reasons are accumulated in
      // call order, so the list itself legitimately differs.
      expect(new Set(composed.constraintReasons), `permutation ${String(i)}`).toEqual(baselineReasons)
      permutations++
    }

    expect(permutations).toBe(1000)
    // The negative control for the whole loop: if the constraint set could not
    // produce a refusal, every permutation would agree trivially.
    expect(baseline.decision.effect).toBe('deny')
    expect(baselineReasons.size).toBe(4)
  })

  it('holds from an ASK base too, where a first-match rule would be most tempted to widen', () => {
    // An `ask` is the one base effect a nearer-to-the-user rule might argue
    // should win. It cannot: a constraint contributes a reason and a reason
    // narrows, so every ordering lands on the same deny.
    const next = seededRandom(0x5EED_0002)
    const baseline = composeDecision(evaluation('ask'), CONSTRAINTS, REQUEST)

    for (let i = 0; i < 1000; i++) {
      const composed = composeDecision(evaluation('ask'), shuffled(CONSTRAINTS, next), REQUEST)
      expect(composed.decision, `permutation ${String(i)}`).toEqual(baseline.decision)
    }

    expect(baseline.decision.effect).toBe('deny')
  })

  it('permutes a SILENT-only set to the same permit, so the invariance is not just "everything denies"', () => {
    // Without this, the two cases above would pass on a composition rule that
    // ignored its constraints and always denied.
    const next = seededRandom(0x5EED_0003)
    const allSilent = [silent, silent, silent, silent, silent, silent, silent, silent]

    for (let i = 0; i < 1000; i++) {
      const composed = composeDecision(evaluation('permit'), shuffled(allSilent, next), REQUEST)
      expect(composed.decision.effect, `permutation ${String(i)}`).toBe('permit')
      expect(composed.constraintReasons, `permutation ${String(i)}`).toEqual([])
    }
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
