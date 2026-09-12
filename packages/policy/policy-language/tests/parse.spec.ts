/**
 * P2-10 C: parsing a policy set, and keeping its three outcomes apart.
 *
 * The taxonomy is the point. A set that does not parse, a set that parses but
 * names vocabulary dsh never sends, and a set that is fine are three different
 * facts about a deployment, and collapsing any two of them is how a broken
 * configuration comes to look like a strict one.
 */
import { describe, expect, it } from 'vitest'
import { parsePolicySet } from '../src/parser.ts'

const GOOD = 'permit(principal, action, resource) when { context.sideEffectClass == "read" };'

describe('P2-10 C: the policy-set parse and its outcomes', () => {
  it('accepts a set every policy of which parses', () => {
    const result = parsePolicySet({ 'baseline-permit': 'permit(principal, action, resource);', gated: GOOD })

    expect(result.ok).toBe(true)
  })

  it('refuses a set that does not parse, and names the policy', () => {
    const result = parsePolicySet({ broken: 'permit(principal action resource)' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('unparsable')
    expect(result.errors.join(' ')).toContain('broken')
  })

  it('refuses an empty set rather than treating it as a policy set that permits nothing', () => {
    // Cedar denies when no permit matches, so an empty set is a refusal of
    // everything — which a deployment almost never means and should state
    // explicitly if it does.
    const result = parsePolicySet({})

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('empty')
  })

  it('keeps the unparsable and the empty reasons distinct, so a caller can tell them apart', () => {
    const broken = parsePolicySet({ broken: '{{{' })
    const empty = parsePolicySet({})

    expect(broken.ok).toBe(false)
    expect(empty.ok).toBe(false)
    if (broken.ok || empty.ok) throw new Error('unreachable')
    expect(broken.reason).not.toBe(empty.reason)
  })
})
