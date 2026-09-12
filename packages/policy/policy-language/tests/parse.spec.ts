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
import { DSH_CONTEXT_KEYS } from '../src/schema.ts'

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

  // BLOCKED-free by ruling (b), 2026-09-12: the vocabulary check is dsh's own,
  // walking the policy's JSON for `context.<key>` accesses, because Cedar
  // 4.12.0's `validate` cannot express dsh's namespaced entity types. What is
  // hand-written is only the membership test; every authorization semantic is
  // still Cedar's.
  it('refuses a policy that reads a context key dsh never sends, naming the key', () => {
    const result = parsePolicySet({
      typo: 'permit(principal, action, resource) when { context.tyop == "read" };',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('unknown-context-key')
    expect(result.errors.join(' ')).toContain('tyop')
    expect(result.errors.join(' ')).toContain('typo')
  })

  it('accepts every key the request builder actually sends', () => {
    // The positive control, and it is the one that would catch a membership
    // test that refused everything: each declared key in its own policy.
    const policies = Object.fromEntries(DSH_CONTEXT_KEYS.map(key =>
      [`reads-${key}`, `permit(principal, action, resource) when { context.${key} == context.${key} };`]))

    expect(parsePolicySet(policies).ok).toBe(true)
  })

  it('reports every unknown key in the set, not just the first', () => {
    const result = parsePolicySet({
      a: 'permit(principal, action, resource) when { context.alpha == 1 };',
      b: 'permit(principal, action, resource) when { context.beta == 1 };',
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.errors.join(' ')).toContain('alpha')
    expect(result.errors.join(' ')).toContain('beta')
  })

  it('refuses an unparsable set BEFORE reading its vocabulary, so the reason names the real fault', () => {
    // Order matters: a policy that does not parse has no vocabulary to read,
    // and reporting it as an unknown key would send a deployment looking for a
    // typo in a key that was never the problem.
    const result = parsePolicySet({ broken: 'permit(principal action resource' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toBe('unparsable')
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
