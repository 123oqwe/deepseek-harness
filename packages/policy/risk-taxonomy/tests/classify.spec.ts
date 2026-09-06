/**
 * Contract-stage behavior of the risk taxonomy and its pure classifier
 * (Epic P2-04, C stage).
 *
 * Each case names the clause it observes. The pairs matter more than the
 * individual assertions: a "cannot downgrade" case is worthless without the
 * case proving the same input CAN reach the lower class when the policy says
 * so, or the refusal would be indistinguishable from a classifier that always
 * returns the maximum.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classify,
  KERNEL_HARD_DENY_CLASSES,
  RISK_CLASSES_BY_ASCENDING_RISK,
  riskRank,
} from '../src/classify.ts'
import type { RiskPolicy } from '../src/types.ts'

const policy = (rules: RiskPolicy['rules'], rest: Partial<RiskPolicy> = {}): RiskPolicy => ({ rules, ...rest })

describe('P2-04 C — the eight-class risk taxonomy (must[0])', () => {
  it('must[0]: the taxonomy is exactly the eight named classes, in ascending risk order', () => {
    expect(RISK_CLASSES_BY_ASCENDING_RISK).toEqual([
      'read',
      'local-reversible',
      'internal-write',
      'external-communication',
      'destructive',
      'financial',
      'security-sensitive',
      'safety-critical',
    ])
  })

  it('must[0]: the order is total and strict, so "highest risk" has exactly one meaning', () => {
    const ranks = RISK_CLASSES_BY_ASCENDING_RISK.map(riskRank)
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
    expect(new Set(ranks).size).toBe(RISK_CLASSES_BY_ASCENDING_RISK.length)
  })
})

describe('P2-04 C — organisation policy decides the mapping, not the plugin (must[1])', () => {
  it('must[1]: the SAME declared tag classifies differently under two organisation policies', () => {
    const subject = { actionId: 'act-1', domainTags: ['send-email'] }
    const permissive = classify(subject, policy([{ domainTag: 'send-email', riskClass: 'external-communication' }]))
    const strict = classify(subject, policy([{ domainTag: 'send-email', riskClass: 'security-sensitive' }]))
    expect(permissive.riskClass).toBe('external-communication')
    expect(strict.riskClass).toBe('security-sensitive')
  })

  it('must[1]: a declared tag no policy rule mentions does not carry the plugin\'s own suggestion into the result', () => {
    // The subject type has no field for a self-assigned class, so the only
    // way a plugin could influence the band is through a tag. An unmentioned
    // tag decides nothing.
    const result = classify({ actionId: 'act-2', domainTags: ['whatever-the-plugin-calls-it'] }, policy([]))
    expect(result.ground).toBe('unknown-default')
    expect(result.decidedBy).toBeUndefined()
  })
})

describe('P2-04 C — classification reports confidence and grounds (must[2])', () => {
  it('must[2]: a rule-decided classification names the tag that decided it and reports full confidence', () => {
    const result = classify({ actionId: 'act-3', domainTags: ['read-file'] }, policy([{ domainTag: 'read-file', riskClass: 'read' }]))
    expect(result).toEqual({
      riskClass: 'read',
      ground: 'policy-rule',
      decidedBy: 'read-file',
      confidence: 1,
      hardDenied: false,
    })
  })

  it('must[2]: the grounds distinguish a class reached BY A RULE from the same class reached by the unknown default', () => {
    // Both land on safety-critical. Without `ground` an operator could not
    // tell a deliberate classification from a failure to classify, which is
    // the whole information content of must[2]'s 依据.
    const byRule = classify({ actionId: 'act-4', domainTags: ['fire-suppression'] }, policy([{ domainTag: 'fire-suppression', riskClass: 'safety-critical' }]))
    const byDefault = classify({ actionId: 'act-5', domainTags: [] }, policy([]))
    expect(byRule.riskClass).toBe(byDefault.riskClass)
    expect(byRule.ground).not.toBe(byDefault.ground)
    expect(byRule.confidence).toBe(1)
    expect(byDefault.confidence).toBe(0)
  })
})

describe('P2-04 C — the unknown default escalates (must[3])', () => {
  it('must[3]: an action no rule matches classifies at the HIGHEST class, not the lowest', () => {
    const result = classify({ actionId: 'act-6', domainTags: ['unheard-of'] }, policy([]))
    expect(result.riskClass).toBe(RISK_CLASSES_BY_ASCENDING_RISK.at(-1))
    expect(result.ground).toBe('unknown-default')
  })

  it('must[3]: a composite action takes the MAXIMUM risk of its matched tags', () => {
    const result = classify(
      { actionId: 'act-7', domainTags: ['read-file', 'wire-transfer'] },
      policy([
        { domainTag: 'read-file', riskClass: 'read' },
        { domainTag: 'wire-transfer', riskClass: 'financial' },
      ]),
    )
    expect(result.riskClass).toBe('financial')
    expect(result.decidedBy).toBe('wire-transfer')
  })

  it('must[3]: one unrecognised tag beside a matched one does NOT escalate the whole action', () => {
    // The positive control for the unknown default: without this, a
    // classifier that escalated on any unmatched tag would pass every case
    // above while making the default useless in practice, since real actions
    // carry tags no policy enumerates.
    const result = classify(
      { actionId: 'act-8', domainTags: ['read-file', 'some-new-tag'] },
      policy([{ domainTag: 'read-file', riskClass: 'read' }]),
    )
    expect(result.riskClass).toBe('read')
    expect(result.ground).toBe('policy-rule')
  })
})

describe('P2-04 C — a plugin cannot downgrade its own action (acceptance[1])', () => {
  it('acceptance[1]: adding a low-risk tag beside a high-risk one cannot lower the result', () => {
    const rules: RiskPolicy['rules'] = [
      { domainTag: 'read-file', riskClass: 'read' },
      { domainTag: 'delete-volume', riskClass: 'destructive' },
    ]
    const honest = classify({ actionId: 'act-9', domainTags: ['delete-volume'] }, policy(rules))
    const gaming = classify({ actionId: 'act-9', domainTags: ['delete-volume', 'read-file'] }, policy(rules))
    expect(honest.riskClass).toBe('destructive')
    expect(gaming.riskClass).toBe('destructive')
  })

  it('acceptance[1]: the classifier CAN return the low class when the policy alone says so, so the case above is not a constant', () => {
    const result = classify({ actionId: 'act-10', domainTags: ['read-file'] }, policy([{ domainTag: 'read-file', riskClass: 'read' }]))
    expect(result.riskClass).toBe('read')
  })
})

describe('P2-04 C — an organisation may raise its bar but not switch off a kernel hard deny (acceptance[2])', () => {
  it('acceptance[2]: an organisation can add a hard-deny class of its own', () => {
    const result = classify(
      { actionId: 'act-11', domainTags: ['wire-transfer'] },
      policy([{ domainTag: 'wire-transfer', riskClass: 'financial' }], { addedHardDenyClasses: ['financial'] }),
    )
    expect(result.hardDenied).toBe(true)
    expect(result.ground).toBe('kernel-hard-deny')
  })

  it('acceptance[2]: a policy that switches off a kernel hard-deny class is REFUSED, naming the class', () => {
    expect(() => classify(
      { actionId: 'act-12', domainTags: [] },
      policy([], { removedHardDenyClasses: [...KERNEL_HARD_DENY_CLASSES] }),
    )).toThrow(/switches off the kernel hard-deny class "safety-critical"/u)
  })

  it('acceptance[2]: a policy adding nothing and removing nothing still hard-denies the kernel class', () => {
    // Without this, the refusal above could hold while the kernel floor
    // itself was never applied to an ordinary classification.
    const result = classify({ actionId: 'act-13', domainTags: [] }, policy([]))
    expect(result.riskClass).toBe('safety-critical')
    expect(result.hardDenied).toBe(true)
  })
})

describe('P2-04 C — the package barrel is scaffold, not implementation (BLOCKED-131, B4(f))', () => {
  it('src/index.ts is exactly one statement and it re-exports types only', () => {
    // The barrel exists because the root tsdown config builds every workspace
    // package against a fixed entry glob, so a package without an `index.ts`
    // fails the build the moment its directory exists. That makes it scaffold
    // the repository forces, not Contract-stage work — and the way to keep
    // that true is to pin it, because the cheapest way to "fix" a later
    // missing export is to add a runtime one here and quietly turn the
    // Contract stage into an implementation.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.ts'), 'utf8')
    const statements = source
      .replace(/\/\*\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
    expect(statements).toEqual(["export type * from './types.ts'"])
  })
})
