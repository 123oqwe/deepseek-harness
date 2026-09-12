/**
 * P2-10 P: accepting a deployment's policy set (validation[0]'s exhaustion
 * bound, acceptance[1]'s pin at the point a set is admitted).
 *
 * The bound is the Provider stage's because nothing bounds a policy set
 * anywhere else — not in the parse, which is per-policy, and not in
 * `@deepseek-ai/dsh-settings`, which accepts whatever the document holds. It is
 * applied over the COMPLETE set, so the cases below are about totals: how many
 * policies, and how many bytes across all of them.
 */
import { describe, expect, it } from 'vitest'
import { getCedarVersion } from '@cedar-policy/cedar-wasm/nodejs'
import { acceptPolicySet, compilePolicySet, DSH_CONTEXT_KEYS, type PolicySetBounds } from '../src/index.ts'

const BOUNDS: PolicySetBounds = { maxPolicies: 3, maxSourceBytes: 1024 }
const PERMIT = 'permit(principal, action, resource);'

/** A set of `count` distinct, parseable policies. */
function setOf(count: number): { policies: Record<string, string> } {
  return { policies: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${String(i)}`, PERMIT])) }
}

describe('P2-10 P validation[0]: the bound is over the complete set', () => {
  it('admits a set exactly at the policy limit, and refuses the one past it', () => {
    expect(acceptPolicySet(setOf(3), BOUNDS).ok).toBe(true)

    const refused = acceptPolicySet(setOf(4), BOUNDS)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('too-many-policies')
    // The numbers a deployment needs to act, both of them: what it sent and
    // what it admits. A refusal naming neither leaves an operator guessing.
    expect(refused.ok === false && refused.errors[0]).toContain('4 policies')
    expect(refused.ok === false && refused.errors[0]).toContain('admits 3')
  })

  it('refuses on TOTAL bytes, not on any single policy, which is the exhaustion the clause names', () => {
    // Three policies, each well under the byte limit, together over it. A
    // per-policy limit would admit this set; the clause is about the set.
    const long = `${PERMIT.slice(0, -1)} when { context.tokenTenant == "${'t'.repeat(400)}" };`
    const refused = acceptPolicySet({ policies: { a: long, b: long, c: long } }, BOUNDS)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('policy-set-too-large')
  })

  it('counts bytes rather than characters, so a multibyte policy costs its encoding', () => {
    // 400 CJK characters in a policy id's annotation: 1200 UTF-8 bytes, over
    // the 1024 limit, while `String.length` would read 400-odd and admit it.
    const multibyte = `@description("${'策'.repeat(400)}")\n${PERMIT}`
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(BOUNDS.maxSourceBytes)
    expect(multibyte.length).toBeLessThan(BOUNDS.maxSourceBytes)

    const refused = acceptPolicySet({ policies: { a: multibyte } }, BOUNDS)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('policy-set-too-large')
  })

  it('bounds BEFORE parsing, so an oversized set is refused for its size and not for its content', () => {
    // Every policy here is unparseable AND the set is over the limit. The
    // refusal must name the size: bounding after parsing would do the work the
    // bound exists to avoid, and would report a broken set as a huge one only
    // by accident of which check ran first.
    const junk = 'x'.repeat(600)
    const refused = acceptPolicySet({ policies: { a: junk, b: junk } }, BOUNDS)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('policy-set-too-large')
  })
})

describe("P2-10 P: the frozen refusals pass through, and the bound's do not join them", () => {
  it('passes a content refusal through unchanged, with the Contract stage’s own reason', () => {
    const refused = acceptPolicySet(
      { policies: { typo: 'permit(principal, action, resource) when { context.tyop == 1 };' } },
      BOUNDS,
    )

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('unknown-context-key')
  })

  it('refuses an empty set as empty rather than as a set within its bounds', () => {
    const refused = acceptPolicySet({ policies: {} }, BOUNDS)

    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.reason).toBe('empty')
  })
})

describe('P2-10 P acceptance[1]: what the accepted set is pinned against', () => {
  it('pins against the engine that will evaluate, read from the engine rather than configured', () => {
    const section = setOf(1)
    const accepted = acceptPolicySet(section, BOUNDS)
    const expected = compilePolicySet(section.policies, {
      contextKeys: DSH_CONTEXT_KEYS,
      engineVersion: getCedarVersion(),
    })

    expect(accepted.ok).toBe(true)
    expect(expected.ok).toBe(true)
    expect(accepted.ok === true && accepted.pin).toBe(expected.ok === true && expected.pin)
  })

  it('gives a different pin than the same set would take against another engine version', () => {
    // The control for the case above: if the pin ignored the engine version,
    // both would agree and the first case would pass without proving anything.
    const section = setOf(1)
    const accepted = acceptPolicySet(section, BOUNDS)
    const other = compilePolicySet(section.policies, {
      contextKeys: DSH_CONTEXT_KEYS,
      engineVersion: `${getCedarVersion()}-not-this-one`,
    })

    expect(accepted.ok === true && other.ok === true && accepted.pin === other.pin).toBe(false)
  })
})
