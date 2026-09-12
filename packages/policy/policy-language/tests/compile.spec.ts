/**
 * P2-10 C: the pinned policy-set artifact (acceptance[1]).
 *
 * The pin answers "same input and version, same output". Its three inputs are
 * the canonical policy text, the vocabulary those policies are read against,
 * and the engine version that canonicalises and evaluates them — because the
 * same text against a changed vocabulary, or a changed engine, is a different
 * evaluator wearing the same policy set.
 */
import { describe, expect, it } from 'vitest'
import { compilePolicySet } from '../src/compiler.ts'
import { DSH_CONTEXT_KEYS } from '../src/schema.ts'

const INPUTS = { contextKeys: DSH_CONTEXT_KEYS, engineVersion: '4.12.0' }
const SET = {
  'baseline-permit': 'permit(principal, action, resource);',
  gated: 'permit(principal, action, resource) when { context.sideEffectClass == "read" };',
}

/** The pin of a set that compiles, or a thrown assertion naming the refusal. */
function pinOf(policies: Readonly<Record<string, string>>, inputs = INPUTS): string {
  const result = compilePolicySet(policies, inputs)
  if (!result.ok) throw new Error(`expected a compiled set, got ${result.reason}`)
  return result.pin
}

describe('P2-10 acceptance[1]: the pin is stable for one input and version', () => {
  it('gives the same set the same pin, twice', () => {
    expect(pinOf(SET)).toBe(pinOf(SET))
  })

  it('ignores formatting, because the canonical text is what is pinned', () => {
    const loose = {
      'baseline-permit': 'permit(  principal , action , resource )  ;',
      gated: 'permit(principal,action,resource)\n  when {   context.sideEffectClass=="read"  };',
    }

    expect(pinOf(loose)).toBe(pinOf(SET))
  })

  it('ignores the order the policy map was built in', () => {
    const reordered = { gated: SET.gated, 'baseline-permit': SET['baseline-permit'] }

    expect(pinOf(reordered)).toBe(pinOf(SET))
  })
})

describe('P2-10 acceptance[1]: each of the three inputs moves the pin', () => {
  it('moves when one character of one policy changes', () => {
    const edited = { ...SET, gated: SET.gated.replace('"read"', '"write"') }

    expect(pinOf(edited)).not.toBe(pinOf(SET))
  })

  it('moves when the vocabulary changes, because the same text means something else', () => {
    const narrowed = { ...INPUTS, contextKeys: DSH_CONTEXT_KEYS.filter(key => key !== 'tokenTenant') }

    expect(pinOf(SET, narrowed)).not.toBe(pinOf(SET))
  })

  it('moves when the engine version changes, so a cedar upgrade re-pins visibly', () => {
    // Without this input a `formatPolicies` that changed across a cedar patch
    // would drift every pin silently. Binding the version makes an upgrade an
    // intentional, visible re-pin instead.
    const upgraded = { ...INPUTS, engineVersion: '4.13.0' }

    expect(pinOf(SET, upgraded)).not.toBe(pinOf(SET))
  })
})

describe('P2-10: a set that will not compile has no pin', () => {
  it('refuses through the same taxonomy the parse uses', () => {
    const result = compilePolicySet({ typo: 'permit(principal, action, resource) when { context.tyop == 1 };' }, INPUTS)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('unknown-context-key')
  })
})
