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

describe('P2-04 owns how RiskClass relates to P1-01 SideEffectClass: a shared spelling is not a shared meaning', () => {
  // The backfill the make-vs-use ledger owes for this epic's ASSIGNED
  // ownership of `P1-01 SideEffectClass`. The module header of `../src/types.ts`
  // records the fact; nothing pinned it. THREE side-effect vocabularies coexist
  // deliberately: `@deepseek-ai/dsh-plugin-manifest`'s `SideEffectClass` (P1-01)
  // and `@deepseek-ai/dsh-action-manifest`'s `ActionSideEffectClass` (P2-03)
  // classify MECHANISM — what an operation touches — while these eight classify
  // RISK: what it costs when the operation is wrong.
  //
  // No behaviour is added here. What is pinned is that the two spellings the
  // vocabularies SHARE are not one concept, which is the property that stops a
  // plugin picking a mechanism tag to buy a lower risk band (acceptance[1]).
  it('gives `read` and `destructive` a meaning set by the POLICY, not by the mechanism word they share with SideEffectClass', () => {
    // P1-01's SideEffectClass spells these two the same way. A deployment is
    // free to place a tag named for a mechanism anywhere in the risk order, and
    // the classifier obeys the policy rather than the spelling.
    const asDestructive = classify(
      { actionId: 'a', domainTags: ['filesystem-read'] },
      policy([{ domainTag: 'filesystem-read', riskClass: 'destructive' }]),
    )
    expect(asDestructive.riskClass).toBe('destructive')

    const asRead = classify(
      { actionId: 'a', domainTags: ['process-control'] },
      policy([{ domainTag: 'process-control', riskClass: 'read' }]),
    )
    expect(asRead.riskClass).toBe('read')
  })

  it('has no member that is not a RiskClass, so a SideEffectClass value can never be used as one', () => {
    // `SideEffectClass` is `none | read | write | network | process |
    // destructive`. Only `read` and `destructive` are also risk classes; the
    // other four have no risk meaning at all, which is why a mapping between
    // the vocabularies must be written and can never be an identity.
    const mechanismOnly = ['none', 'write', 'network', 'process']
    for (const value of mechanismOnly) {
      expect(RISK_CLASSES_BY_ASCENDING_RISK).not.toContain(value)
    }
    expect(RISK_CLASSES_BY_ASCENDING_RISK).toContain('read')
    expect(RISK_CLASSES_BY_ASCENDING_RISK).toContain('destructive')
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
    // Both land on the SAME class by different routes. Without `ground` an
    // operator could not tell a deliberate classification from a failure to
    // classify, which is the whole information content of must[2]'s 依据.
    // The class here is the unknown default's, since that is the collision
    // that actually arises: a rule may assign it deliberately too.
    const byRule = classify({ actionId: 'act-4', domainTags: ['key-material'] }, policy([{ domainTag: 'key-material', riskClass: 'security-sensitive' }]))
    const byDefault = classify({ actionId: 'act-5', domainTags: [] }, policy([]))
    expect(byRule.riskClass).toBe(byDefault.riskClass)
    expect(byRule.ground).not.toBe(byDefault.ground)
    expect(byRule.confidence).toBe(1)
    expect(byDefault.confidence).toBe(0)
  })
})

describe('P2-04 C — the unknown default escalates (must[3])', () => {
  it('must[3]: an action no rule matches classifies at the highest POLICY-ADJUSTABLE class, never in the kernel hard-deny band', () => {
    // §12.47. must[3] says an unknown action defaults higher and P2-03's
    // acceptance[2] says it defaults to high risk AND REQUIRES APPROVAL: both
    // name approval, not refusal. Defaulting into the hard-deny band would
    // equate "unknown" with "known catastrophic" and refuse every action
    // outright, since nothing declares domain tags yet.
    const result = classify({ actionId: 'act-6', domainTags: ['unheard-of'] }, policy([]))
    const adjustable = RISK_CLASSES_BY_ASCENDING_RISK
      .filter(riskClass => !KERNEL_HARD_DENY_CLASSES.includes(riskClass))
    expect(result.riskClass).toBe(adjustable.at(-1))
    expect(result.ground).toBe('unknown-default')
    expect(result.hardDenied).toBe(false)
  })

  it('must[3]: an organisation that wants unknowns REFUSED can add that class to its own hard-deny list', () => {
    // The escape hatch that makes the default a threshold rather than a
    // ceiling: raising your own bar is permitted, lowering the kernel's is not.
    const strict = classify(
      { actionId: 'act-6b', domainTags: ['unheard-of'] },
      { ...policy([]), addedHardDenyClasses: ['security-sensitive'] },
    )
    expect(strict.hardDenied).toBe(true)
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
    // itself was never applied to an ordinary classification. The action
    // DECLARES the catastrophic tag: since §12.47 the kernel band is reached
    // by declaration, never by failing to classify.
    const result = classify(
      { actionId: 'act-13', domainTags: ['fire-suppression'] },
      policy([{ domainTag: 'fire-suppression', riskClass: 'safety-critical' }]),
    )
    expect(result.riskClass).toBe('safety-critical')
    expect(result.hardDenied).toBe(true)
  })
})

describe('P2-04 P — the barrel publishes the classifier and nothing that executes on import', () => {
  it('src/index.ts re-exports the type surface and the classifier, and declares no runtime value of its own', () => {
    // The Contract stage pinned this barrel to a single type-only statement,
    // because the cheapest way to "fix" a missing export is to add a runtime
    // one here and quietly turn a contract into an implementation. The
    // Provider stage is where that constraint retires BY DESIGN, so the
    // property worth pinning changes rather than disappears: the barrel may
    // now name runtime exports, and it still must not DECLARE any — a `const`
    // or a call here would run at import time, in a package whose whole claim
    // is that classification is pure and policy is a parameter.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.ts'), 'utf8')
    const statements = source
      .replace(/\/\*\*[\s\S]*?\*\//gu, '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
    expect(statements.every(line => line.startsWith('export') || /^[}A-Za-z_,'./ ]+$/u.test(line))).toBe(true)
    expect(statements.some(line => /\b(?:const|let|var|function|class)\b/u.test(line))).toBe(false)
    expect(source).toContain("export type * from './types.ts'")
    expect(source).toContain('classify,')
  })
})

/**
 * P2-04 Fault stage: the boundaries where a classification decision flips.
 *
 * Enumerated as data with the count asserted against a floor, so a boundary
 * cannot be deleted while every remaining case still passes — the same shape
 * P4-08's resume matrix uses, and for the same reason.
 *
 * The boundaries worth pinning here are the ones where being wrong is not
 * merely a wrong label: an action that should have been refused running, an
 * action that should have run being refused, or a plugin moving its own band.
 */
describe('P2-04 Fault — risk classification boundary matrix', () => {
  interface RiskFault {
    readonly boundary: string
    readonly run: () => void
  }

  const FAULTS: readonly RiskFault[] = [
    {
      boundary: '01 an unmatched tag takes the unknown default, not the lowest class',
      run: () => { expect(classify({ actionId: 'a', domainTags: ['nope'] }, policy([])).ground).toBe('unknown-default') },
    },
    {
      boundary: '02 the unknown default stops BELOW the kernel band, so unknown is asked about and not refused',
      run: () => {
        const decided = classify({ actionId: 'a', domainTags: ['nope'] }, policy([]))
        expect(decided.hardDenied).toBe(false)
        expect(KERNEL_HARD_DENY_CLASSES).not.toContain(decided.riskClass)
      },
    },
    {
      boundary: '03 an EMPTY tag list is the same unknown as an unmatched tag',
      run: () => { expect(classify({ actionId: 'a', domainTags: [] }, policy([])).ground).toBe('unknown-default') },
    },
    {
      boundary: '04 a composite action takes the maximum, so a low tag cannot dilute a high one',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['r', 'w'] }, policy([
          { domainTag: 'r', riskClass: 'read' },
          { domainTag: 'w', riskClass: 'destructive' },
        ])).riskClass).toBe('destructive')
      },
    },
    {
      boundary: '05 tag ORDER does not change the maximum',
      run: () => {
        const rules: RiskPolicy['rules'] = [
          { domainTag: 'r', riskClass: 'read' },
          { domainTag: 'w', riskClass: 'destructive' },
        ]
        expect(classify({ actionId: 'a', domainTags: ['w', 'r'] }, policy(rules)).riskClass)
          .toBe(classify({ actionId: 'a', domainTags: ['r', 'w'] }, policy(rules)).riskClass)
      },
    },
    {
      boundary: '06 one unrecognised tag beside a matched one does not escalate to the unknown default',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['r', 'nope'] }, policy([{ domainTag: 'r', riskClass: 'read' }])).riskClass)
          .toBe('read')
      },
    },
    {
      boundary: '07 a duplicate rule for one tag does not change the outcome',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['r'] }, policy([
          { domainTag: 'r', riskClass: 'read' },
          { domainTag: 'r', riskClass: 'read' },
        ])).riskClass).toBe('read')
      },
    },
    {
      boundary: '08 two rules for one tag take the HIGHER, so a second rule cannot lower the first',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['r'] }, policy([
          { domainTag: 'r', riskClass: 'destructive' },
          { domainTag: 'r', riskClass: 'read' },
        ])).riskClass).toBe('destructive')
      },
    },
    {
      boundary: '09 the kernel band is reached by DECLARATION and is hard-denied',
      run: () => {
        const decided = classify({ actionId: 'a', domainTags: ['fire'] }, policy([{ domainTag: 'fire', riskClass: 'safety-critical' }]))
        expect(decided).toMatchObject({ riskClass: 'safety-critical', hardDenied: true, ground: 'kernel-hard-deny' })
      },
    },
    {
      boundary: '10 an organisation may ADD a hard-deny class of its own',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['m'] }, policy(
          [{ domainTag: 'm', riskClass: 'financial' }],
          { addedHardDenyClasses: ['financial'] },
        )).hardDenied).toBe(true)
      },
    },
    {
      boundary: '11 a policy that switches off a KERNEL hard-deny class is refused, naming it',
      run: () => {
        expect(() => classify({ actionId: 'a', domainTags: [] }, policy([], { removedHardDenyClasses: ['safety-critical'] })))
          .toThrow(/safety-critical/u)
      },
    },
    {
      boundary: '12 removing a class the kernel does NOT pin removes nothing and is not an error',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: [] }, policy([], { removedHardDenyClasses: ['financial'] })).ground)
          .toBe('unknown-default')
      },
    },
    {
      boundary: '13 confidence separates a ruled class from the same class reached by default',
      run: () => {
        const byRule = classify({ actionId: 'a', domainTags: ['k'] }, policy([{ domainTag: 'k', riskClass: 'security-sensitive' }]))
        const byDefault = classify({ actionId: 'b', domainTags: [] }, policy([]))
        expect(byRule.riskClass).toBe(byDefault.riskClass)
        expect([byRule.confidence, byDefault.confidence]).toEqual([1, 0])
      },
    },
    {
      boundary: '14 the deciding tag is NAMED when a rule decided, and absent when nothing did',
      run: () => {
        expect(classify({ actionId: 'a', domainTags: ['r'] }, policy([{ domainTag: 'r', riskClass: 'read' }])).decidedBy).toBe('r')
        expect(classify({ actionId: 'a', domainTags: [] }, policy([])).decidedBy).toBeUndefined()
      },
    },
  ]

  it('enumerates at least twelve boundaries, each named once', () => {
    expect(FAULTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FAULTS.map(fault => fault.boundary)).size).toBe(FAULTS.length)
  })

  for (const fault of FAULTS) {
    it(`fault boundary ${fault.boundary}`, fault.run)
  }
})
