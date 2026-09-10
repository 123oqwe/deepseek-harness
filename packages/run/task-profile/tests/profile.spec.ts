/**
 * Contract-stage behavior of the generic compiled TaskProfile (Epic P4-02, C
 * stage).
 *
 * Each case names the clause it observes. Several come in pairs, because a
 * refusal on its own proves nothing: a case showing a profile is REFUSED for
 * claiming certainty about an unknown side effect is indistinguishable from a
 * validator that refuses everything until the case beside it shows the same
 * profile ACCEPTED once the certainty is dropped. The four generic fixtures
 * (validation[0]) are the positive controls the negative cases are measured
 * against.
 *
 * What is deliberately NOT here: compiling. `compileTaskProfile` is the P
 * stage's deliverable, so acceptance[0]'s stability is observed at this stage
 * over the reference a profile canonicalizes to, which is the property the Run
 * event log depends on and the one a compiler must preserve.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InferenceProvenance,
  TaskConstraint,
  TaskGoalRef,
  TaskProfile,
  TaskQuestion,
  TaskSideEffect,
} from '../src/types.ts'
import { TaskProfileRef, taskOriginOf } from '../src/types.ts'
import { SIDE_EFFECT_FIELD, taskProfileRef, validateTaskProfile } from '../src/validate.ts'

const goalRef: TaskGoalRef = { sessionId: SessionId('session-p4-02'), messageId: MessageId('message-goal') }

const provenance = (over: Partial<InferenceProvenance> = {}): InferenceProvenance => ({
  origin: 'user-stated',
  goalRef,
  confidence: 1,
  rationale: 'stated in the goal message',
  ...over,
})

const constraint = (id: string, over: Partial<TaskConstraint> = {}): TaskConstraint => ({
  id,
  strength: 'hard',
  statement: `constraint ${id}`,
  provenance: provenance(),
  ...over,
})

const sideEffect = (over: Partial<TaskSideEffect> = {}): TaskSideEffect => ({
  riskClass: 'read',
  ground: 'policy-rule',
  provenance: provenance(),
  ...over,
})

const unknownSideEffect = (): TaskSideEffect => ({
  riskClass: 'security-sensitive',
  ground: 'unknown-default',
  provenance: provenance({ origin: 'default', confidence: 0, rationale: 'nothing in the goal decided it' }),
})

const question = (id: string, field: string, over: Partial<TaskQuestion> = {}): TaskQuestion => ({
  id,
  field,
  reason: 'high-risk-missing',
  prompt: `what should ${field} be?`,
  goalRef,
  ...over,
})

const profile = (over: Partial<TaskProfile> = {}): TaskProfile => ({
  goalRef,
  objective: 'do the thing the goal asks for',
  constraints: [constraint('c1')],
  sideEffect: sideEffect(),
  questions: [],
  ...over,
})

/** validation[0]'s four generic task kinds, as profiles rather than as a `kind` field. */
const FOUR_GENERIC_FIXTURES: readonly (readonly [string, TaskProfile])[] = [
  ['code', profile({
    objective: 'add a retry to the upload path',
    constraints: [constraint('no-new-dependency', { statement: 'do not add a dependency' })],
    sideEffect: sideEffect({ riskClass: 'internal-write' }),
  })],
  ['research', profile({
    objective: 'compare three canonicalization libraries',
    constraints: [constraint('cite-sources', { strength: 'soft', statement: 'cite every claim' })],
    sideEffect: sideEffect({ riskClass: 'read' }),
  })],
  ['external-action', profile({
    objective: 'send the summary to the mailing list',
    constraints: [constraint('recipients', { statement: 'only the announce list' })],
    sideEffect: sideEffect({ riskClass: 'external-communication' }),
  })],
  ['personal-plan', profile({
    objective: 'lay out a four-week reading plan',
    constraints: [constraint('weekly-hours', { strength: 'soft', statement: 'about three hours a week' })],
    sideEffect: sideEffect({ riskClass: 'local-reversible' }),
  })],
]

describe('P4-02 C — the four generic fixtures (validation[0])', () => {
  it.each(FOUR_GENERIC_FIXTURES)('a %s task compiles into the generic vocabulary with nothing vertical in it', (_kind, fixture) => {
    const result = validateTaskProfile(fixture)
    expect(result.valid).toBe(true)
  })

  it('rejects a profile carrying a field the generic vocabulary does not have (must[0])', () => {
    const result = validateTaskProfile({ ...profile(), salesStage: 'negotiation' })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors.map(error => error.code)).toContain('malformed')
  })
})

describe('P4-02 C — the reference a profile is named by (acceptance[0])', () => {
  it('the same profile canonicalizes to the same reference, whatever order its keys were built in', () => {
    const built = profile()
    const reordered: TaskProfile = {
      questions: built.questions,
      sideEffect: built.sideEffect,
      constraints: built.constraints,
      objective: built.objective,
      goalRef: built.goalRef,
    }
    expect(taskProfileRef(reordered)).toBe(taskProfileRef(built))
  })

  it('a profile whose confidence changed is a different reference, so a revision cannot pass for the original', () => {
    const original = profile()
    const revised = profile({ constraints: [constraint('c1', { provenance: provenance({ confidence: 0.5 }) })] })
    expect(taskProfileRef(revised)).not.toBe(taskProfileRef(original))
  })

  it('refuses a reference that is not a sha256 digest, so a caller cannot choose one', () => {
    expect(() => TaskProfileRef('not-a-digest')).toThrow(TypeError)
    expect(() => TaskProfileRef('A'.repeat(64))).toThrow(TypeError)
  })
})

describe('P4-02 C — every hard constraint traces to its source (acceptance[1], must[1])', () => {
  it.each(FOUR_GENERIC_FIXTURES)('%s: each constraint carries the goal message it came from and how certain the compile is', (_kind, fixture) => {
    for (const entry of fixture.constraints) {
      expect(entry.provenance.goalRef).toStrictEqual(goalRef)
      expect(entry.provenance.confidence).toBeGreaterThanOrEqual(0)
      expect(entry.provenance.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('refuses a hard constraint with no provenance at all', () => {
    const { provenance: _dropped, ...withoutSource } = constraint('c1')
    const result = validateTaskProfile({ ...profile(), constraints: [withoutSource] })
    expect(result.valid).toBe(false)
    if (result.valid) return
    // The path, not just the refusal: acceptance[1] is about WHICH constraint
    // lost its source, and a refusal that cannot say where is a refusal a
    // caller cannot act on.
    expect(result.errors.map(error => error.path)).toContain('constraints.0.provenance')
  })

  it('refuses a confidence outside [0, 1], so a traceable source cannot carry an unreadable certainty', () => {
    const result = validateTaskProfile(profile({ constraints: [constraint('c1', { provenance: provenance({ confidence: 1.5 }) })] }))
    expect(result.valid).toBe(false)
  })

  it('keeps two contradictory hard constraints side by side, each with its own source (validation[1])', () => {
    const conflicting = profile({
      constraints: [
        constraint('finish-today', { statement: 'finish today' }),
        constraint('review-first', { statement: 'wait for a review that takes a week' }),
      ],
    })
    const result = validateTaskProfile(conflicting)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.profile.constraints.map(entry => entry.id)).toStrictEqual(['finish-today', 'review-first'])
    expect(result.profile.constraints.every(entry => entry.provenance.goalRef.messageId === goalRef.messageId)).toBe(true)
  })

  it('refuses two constraints sharing an id, which would make a question about one of them unaddressable', () => {
    const result = validateTaskProfile(profile({ constraints: [constraint('same'), constraint('same')] }))
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors.map(error => error.code)).toContain('duplicate-id')
  })
})

describe('P4-02 C — an unknown side effect is never "none" (acceptance[2])', () => {
  it('has no "none" class to be marked with: the vocabulary refuses one', () => {
    // No cast: `validateTaskProfile` takes `unknown`, which is what a profile
    // read back out of an older build's session log actually is. Reaching for
    // `as unknown as TaskSideEffect` here would be constructing a lie about
    // the type instead of exercising the boundary that has to refuse it.
    const result = validateTaskProfile({ ...profile(), sideEffect: { ...sideEffect(), riskClass: 'none' } })
    expect(result.valid).toBe(false)
  })

  it('accepts an unknown side effect that reports itself as undetermined', () => {
    const result = validateTaskProfile(profile({ sideEffect: unknownSideEffect() }))
    expect(result.valid).toBe(true)
  })

  it('refuses the same unknown side effect when it claims to be certain', () => {
    const claiming = { ...unknownSideEffect(), provenance: provenance({ origin: 'default', confidence: 1 }) }
    const result = validateTaskProfile(profile({ sideEffect: claiming }))
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors.map(error => error.code)).toContain('unknown-side-effect-claims-confidence')
  })

  it('a decided classification and an undetermined one are distinguishable by ground alone', () => {
    expect(sideEffect({ riskClass: 'security-sensitive' }).ground).toBe('policy-rule')
    expect(unknownSideEffect().ground).toBe('unknown-default')
  })
})

describe('P4-02 C — missing information asks rather than guesses (must[2], validation[1])', () => {
  it('carries the question as data alongside an undetermined side effect', () => {
    const asking = profile({ sideEffect: unknownSideEffect(), questions: [question('q1', SIDE_EFFECT_FIELD)] })
    const result = validateTaskProfile(asking)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.profile.questions[0]?.goalRef).toStrictEqual(goalRef)
  })

  it('refuses a profile that asks about the side effect while also recording it as decided', () => {
    const result = validateTaskProfile(profile({ sideEffect: sideEffect(), questions: [question('q1', SIDE_EFFECT_FIELD)] }))
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors.map(error => error.code)).toContain('question-field-also-decided')
  })

  it('refuses a profile that asks about a constraint it also states', () => {
    const result = validateTaskProfile(profile({ constraints: [constraint('recipients')], questions: [question('q1', 'recipients')] }))
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors.map(error => error.code)).toContain('question-field-also-decided')
  })

  it('allows a question about a constraint the profile does NOT state, which is the whole point of asking', () => {
    const result = validateTaskProfile(profile({ constraints: [constraint('recipients')], questions: [question('q1', 'budget')] }))
    expect(result.valid).toBe(true)
  })

  it('reports every violated rule at once rather than one per round-trip', () => {
    const result = validateTaskProfile(profile({
      constraints: [constraint('same'), constraint('same')],
      sideEffect: { ...unknownSideEffect(), provenance: provenance({ origin: 'default', confidence: 1 }) },
    }))
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(new Set(result.errors.map(error => error.code))).toStrictEqual(new Set(['duplicate-id', 'unknown-side-effect-claims-confidence']))
  })
})

describe('P4-02 C — only a human goal is a task (must[2], delegate ruling 2026-09-10)', () => {
  it('a direct user prompt is the one origin that compiles', () => {
    expect(taskOriginOf({ kind: 'user' })).toBe('user-goal')
  })

  it('injected plugin context is recognised and is not a task', () => {
    const injected: MessageSource = { kind: 'plugin', plugin: 'memory-context' }
    expect(taskOriginOf(injected)).toBe('injected-context')
  })

  it('a source the classifier has no case for falls through to not-a-task rather than to a goal', () => {
    // `tool` is a real member of the union that `taskOriginOf` deliberately
    // does not name, so it exercises the same fall-through a plugin-added kind
    // would. Constructed legally rather than cast: `MessageSourceMap` is
    // merge-extensible, and a test that augmented it to invent a kind would
    // change the union for every file in the repository -- measured, and it
    // broke eight unrelated apps/cli fixtures.
    const notAGoal: MessageSource = { kind: 'tool', callId: brandString<ToolCallId>('call-1') }
    expect(taskOriginOf(notAGoal)).toBe('unknown-source')
  })
})

describe('P4-02 C — the published schema says the same thing as the types', () => {
  const schema = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'spec', 'task-profile.schema.json'), 'utf8'),
  ) as {
    required: string[]
    additionalProperties: boolean
    $defs: { sideEffect: { properties: { riskClass: { enum: string[] }; ground: { enum: string[] } } } }
  }

  it('requires exactly the five generic fields and admits no others (must[0])', () => {
    expect(schema.required).toStrictEqual(['goalRef', 'objective', 'constraints', 'sideEffect', 'questions'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('publishes a risk vocabulary with no "none" member (acceptance[2])', () => {
    expect(schema.$defs.sideEffect.properties.riskClass.enum).not.toContain('none')
    expect(schema.$defs.sideEffect.properties.ground.enum).toContain('unknown-default')
  })
})
