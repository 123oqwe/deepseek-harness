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
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
import { TaskProfileRef, goalRoundOf, taskOriginOf } from '../src/types.ts'
import { SIDE_EFFECT_FIELD, taskProfileRef, validateTaskProfile } from '../src/validate.ts'
import { compileTaskProfile } from '../src/index.ts'
import type { TaskProfileInput } from '../src/index.ts'

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

// ---------------------------------------------------------------------------
// Provider stage (P). NOT FROZEN YET: the C cell is still awaiting observation,
// and these cases are written while waiting so the P freeze has something real
// to freeze. Their titles are not in any freeze entry.
// ---------------------------------------------------------------------------

const input = (over: Partial<TaskProfileInput> = {}): TaskProfileInput => ({
  goalRef,
  goalText: 'add a retry to the upload path',
  origin: 'user-goal',
  identityKnown: true,
  ...over,
})

/** The profile of a successful compile, or a failure naming the refusal. */
const compiled = (over: Partial<TaskProfileInput> = {}): TaskProfile => {
  const result = compileTaskProfile(input(over))
  if (!result.compiled) throw new Error(`expected a profile, got refusal ${result.reason}`)
  return result.profile
}

describe('P4-02 P — the compile is a function of its input alone (acceptance[0])', () => {
  it('compiling the same input twice yields the same reference, which is what the Run log keys on', () => {
    expect(taskProfileRef(compiled())).toBe(taskProfileRef(compiled()))
  })

  it('a changed budget is a different reference, so a revision cannot pass for the original', () => {
    const original = taskProfileRef(compiled({ budget: { maxTurns: 5 } }))
    expect(taskProfileRef(compiled({ budget: { maxTurns: 6 } }))).not.toBe(original)
  })

  it('constraint ids come from the statement, not from position, so an unrelated constraint does not renumber them', () => {
    const one = compiled({ budget: { maxSpendUsd: 3 } })
    const two = compiled({ budget: { maxTurns: 5, maxSpendUsd: 3 } })
    const spendOf = (profile: TaskProfile): string | undefined =>
      profile.constraints.find(entry => entry.statement.includes('USD'))?.id
    expect(spendOf(two)).toBe(spendOf(one))
    expect(two.constraints).toHaveLength(2)
  })
})

describe('P4-02 P — only a stated field becomes a constraint (must[1])', () => {
  it('a stated budget becomes a hard constraint whose provenance names the field it came from', () => {
    const profile = compiled({ budget: { maxTurns: 5 } })
    expect(profile.constraints).toHaveLength(1)
    const [only] = profile.constraints
    expect(only?.strength).toBe('hard')
    expect(only?.provenance.origin).toBe('user-stated')
    expect(only?.provenance.confidence).toBe(1)
    expect(only?.provenance.rationale).toContain('AgentOptions.budget.maxTurns')
  })

  it('invents no constraint from the goal text, however much the text sounds like one', () => {
    const profile = compiled({ goalText: 'do not add a dependency and finish within three turns' })
    expect(profile.constraints).toStrictEqual([])
  })

  it('records the goal text as the objective and keeps the reference beside it, never instead of it', () => {
    const profile = compiled({ goalText: '  add a retry  ' })
    expect(profile.objective).toBe('add a retry')
    expect(profile.goalRef).toStrictEqual(goalRef)
  })
})

describe('P4-02 P — what it cannot determine, it asks (must[2], acceptance[2])', () => {
  it('reports the side effect as undetermined at confidence 0 rather than guessing a class', () => {
    const profile = compiled()
    expect(profile.sideEffect.ground).toBe('unknown-default')
    expect(profile.sideEffect.provenance.confidence).toBe(0)
    expect(profile.sideEffect.provenance.rationale).toContain('no structured field states the effect')
  })

  it('asks about the side effect it could not determine, so the profile is valid under must[2]', () => {
    const profile = compiled()
    expect(profile.questions.map(entry => entry.field)).toContain('sideEffect')
    expect(validateTaskProfile(profile).valid).toBe(true)
  })

  it('asks whose authorization applies when no identity is attached, and does not when one is', () => {
    expect(compiled({ identityKnown: false }).questions.map(entry => entry.field)).toContain('actingIdentity')
    expect(compiled({ identityKnown: true }).questions.map(entry => entry.field)).not.toContain('actingIdentity')
  })

  it('records the workspace trust state in the rationale without letting it decide the class', () => {
    const untrusted = compiled({ workspaceTrust: 'untrusted' })
    const execute = compiled({ workspaceTrust: 'trusted-execute' })
    expect(untrusted.sideEffect.provenance.rationale).toContain('workspace trust is untrusted')
    expect(execute.sideEffect.provenance.rationale).toContain('workspace trust is trusted-execute')
    expect(execute.sideEffect.ground).toBe('unknown-default')
  })

  it('says the trust state was not supplied rather than calling it untrusted, while still failing closed', () => {
    // Two different facts. The decision is the same either way -- the class is
    // the unknown default -- but a profile compiled with no trust state must not
    // record an observation this compile never made.
    // `compiled()` omits the field entirely, which is the real absent case;
    // passing `undefined` explicitly is not assignable under
    // `exactOptionalPropertyTypes` and would also be a different input.
    const absent = compiled()
    expect(absent.sideEffect.provenance.rationale).toContain('workspace trust was not supplied')
    expect(absent.sideEffect.provenance.rationale).not.toContain('untrusted')
    expect(absent.sideEffect.ground).toBe('unknown-default')
    expect(absent.sideEffect.provenance.confidence).toBe(0)
  })
})

describe('P4-02 P — what is not a task compiles to nothing (must[2], delegate ruling)', () => {
  it('refuses injected plugin context rather than producing a profile per notice', () => {
    const result = compileTaskProfile(input({ origin: 'injected-context' }))
    expect(result).toStrictEqual({ compiled: false, reason: 'not-a-task' })
  })

  it('refuses a source kind it has no case for, the same way', () => {
    expect(compileTaskProfile(input({ origin: 'unknown-source' }))).toStrictEqual({ compiled: false, reason: 'not-a-task' })
  })

  it('refuses a blank goal instead of emitting a profile whose objective says nothing', () => {
    expect(compileTaskProfile(input({ goalText: '   ' }))).toStrictEqual({ compiled: false, reason: 'empty-goal' })
  })
})

describe('P4-02 P — the module surface the Provider stage promises', () => {
  it('exports exactly one runtime symbol, so a later convenience re-export cannot slip in', async () => {
    // The Contract stage left `index.ts` a type-only barrel and froze no case
    // over that shape, so nothing guarded it (recorded in evidence-P4-02.md).
    // The Provider stage adds exactly one runtime export and this is the case
    // that holds the line: `export type *` contributes no runtime key, so the
    // namespace's own keys are the whole runtime surface.
    const namespace = await import('../src/index.ts')
    expect(Object.keys(namespace).sort()).toStrictEqual(['compileTaskProfile'])
  })
})

// ---------------------------------------------------------------------------
// Provider stage SUPPLEMENT (delegate ruling, OQ2). The P freeze is sealed at
// `9a820c4016` and these titles are not in it: they are the behaviour the
// ruling added afterwards, frozen separately so the sealed entry stays exactly
// what was observed when it was sealed.
// ---------------------------------------------------------------------------

describe('P4-02 P — content the objective could not carry is asked about, not dropped (must[2], OQ2)', () => {
  it('still compiles a goal whose message also held blocks the text does not include', () => {
    // The case OQ2 exists for. Before the ruling this input refused as
    // `empty-goal` and an image-led task had no profile at all.
    const compiled = compileTaskProfile(input({
      goalText: 'make this diagram match the code',
      unreadGoalContent: [{ kind: 'image', count: 2 }],
    }))
    expect(compiled.compiled).toBe(true)
  })

  it('asks what the unread blocks ask for, naming their kind and their count', () => {
    const compiled = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 2 }] }))
    if (!compiled.compiled) throw new Error('expected a profile')
    const asked = compiled.profile.questions.find(entry => entry.field === 'unreadGoalContent')
    expect(asked?.reason).toBe('ambiguous')
    // The count is in the prompt because "something was dropped" is not a
    // question anyone can answer.
    expect(asked?.prompt).toContain('2 image blocks')
  })

  it('asks nothing when every block reached the objective, so the question is about content and not about compiling', () => {
    // The positive control the case above needs: without it, a compiler that
    // asked this question unconditionally would pass.
    const compiled = compileTaskProfile(input())
    if (!compiled.compiled) throw new Error('expected a profile')
    expect(compiled.profile.questions.map(entry => entry.field)).not.toContain('unreadGoalContent')
  })

  it('treats a counted zero as nothing unread, so an empty tally is not a question', () => {
    const compiled = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 0 }] }))
    if (!compiled.compiled) throw new Error('expected a profile')
    expect(compiled.profile.questions.map(entry => entry.field)).not.toContain('unreadGoalContent')
  })

  it('yields the same reference whatever order the caller counted the kinds in (acceptance[0])', () => {
    // The caller counts by iterating its own content array, so the order is
    // its accident. Two callers that saw the same message must still produce
    // the same digest or the revision chain sees a revision that did not
    // happen.
    const forward = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 1 }, { kind: 'audio', count: 3 }] }))
    const reversed = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'audio', count: 3 }, { kind: 'image', count: 1 }] }))
    if (!forward.compiled || !reversed.compiled) throw new Error('expected two profiles')
    expect(taskProfileRef(forward.profile)).toBe(taskProfileRef(reversed.profile))
  })

  it('yields a DIFFERENT reference when the tally itself changed, so a revision is visible', () => {
    const one = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 1 }] }))
    const two = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 2 }] }))
    if (!one.compiled || !two.compiled) throw new Error('expected two profiles')
    expect(taskProfileRef(one.profile)).not.toBe(taskProfileRef(two.profile))
  })

  it('stays valid under the durable boundary check, so the extra question breaks no must[2] rule', () => {
    const compiled = compileTaskProfile(input({ unreadGoalContent: [{ kind: 'image', count: 2 }] }))
    if (!compiled.compiled) throw new Error('expected a profile')
    expect(validateTaskProfile(compiled.profile).valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Fault/Qualification stage (F). NOT FROZEN YET.
//
// **What F does NOT re-assert, measured before writing it.** The preFlight's
// plan listed three cases the Contract stage turns out to already freeze under
// the same argv — a reference that is not a sha256 digest, a confidence outside
// `[0, 1]`, and both spellings of "asks about a field it also decided". Writing
// them again would mean two cases with one title in one report, which is how a
// freeze entry's title match becomes ambiguous. F adds only what nothing
// observes yet: the four generic kinds driven through the COMPILER at their
// most impoverished, the ORDER the refusals are decided in, and the revision
// arithmetic validation[2]'s chain rests on, field by field.
//
// Persistence is validation[2]'s other half and is not here: the
// `run/task-profile` event is written by `@deepseek-ai/dsh-run`, and
// `packages/run/run/tests/task-profile.spec.ts` observes it. F freezes the
// arithmetic, U freezes the writing (delegate ruling, OQ5, §12.46-B).
// ---------------------------------------------------------------------------

/** The four generic kinds as compiler INPUTS, each stripped of everything optional. */
const FOUR_IMPOVERISHED_INPUTS: readonly (readonly [string, string])[] = [
  ['code', 'add a retry to the upload path'],
  ['research', 'compare three canonicalization libraries'],
  ['external-action', 'send the summary to the mailing list'],
  ['personal-plan', 'lay out a four-week reading plan'],
]

describe('P4-02 F — the four generic kinds with nothing stated (validation[0], validation[1])', () => {
  for (const [kind, goalText] of FOUR_IMPOVERISHED_INPUTS) {
    it(`compiles ${kind} from a goal that states no budget, no trust and no identity, and asks about every one of them`, () => {
      // C's four fixtures were literal profiles and P compiled one input. This
      // is the fault direction over the same four: the input is structurally
      // valid and tells the compiler nothing, so a profile that came back with
      // a decided side effect or no questions would have invented the lot.
      const compiled = compileTaskProfile({ goalRef, goalText, origin: 'user-goal', identityKnown: false })
      if (!compiled.compiled) throw new Error(`expected a profile for ${kind}`)
      expect(compiled.profile.objective).toBe(goalText)
      expect(compiled.profile.constraints).toStrictEqual([])
      expect(compiled.profile.sideEffect.ground).toBe('unknown-default')
      expect(compiled.profile.questions.map(entry => entry.field).sort()).toStrictEqual(['actingIdentity', 'sideEffect'])
      // And it is readable back out of a durable log, which is the point of
      // compiling it at all.
      expect(validateTaskProfile(compiled.profile).valid).toBe(true)
    })
  }
})

describe('P4-02 F — which refusal wins when an input fails two ways at once (must[2], validation[1])', () => {
  it('refuses a blank injected-context message as not-a-task, not as empty-goal', () => {
    // Both refusals apply. Reporting `empty-goal` would say the message was a
    // task whose goal happened to be missing, which is the opposite of what
    // happened, and a caller routing on the reason would then go looking for
    // the text instead of accepting that there was no task.
    const compiled = compileTaskProfile(input({ origin: 'injected-context', goalText: '   ' }))
    expect(compiled).toStrictEqual({ compiled: false, reason: 'not-a-task' })
  })

  it('refuses a goal that is only whitespace, rather than asking about the fields around it', () => {
    // The refusal comes before the asking. A compile that answered with a
    // profile carrying three questions and a blank objective would be a record
    // of a task nobody stated.
    const compiled = compileTaskProfile(input({ goalText: ' \t\n ', identityKnown: false, unreadGoalContent: [{ kind: 'image', count: 1 }] }))
    expect(compiled).toStrictEqual({ compiled: false, reason: 'empty-goal' })
  })
})

describe('P4-02 F — the revision arithmetic validation[2] rests on, field by field', () => {
  const base = input({
    goalText: 'add a retry to the upload path',
    budget: { maxTurns: 4, maxSpendUsd: 2 },
    workspaceTrust: 'trusted-read',
    identityKnown: true,
    unreadGoalContent: [{ kind: 'image', count: 1 }],
  })
  const refOf = (over: Partial<TaskProfileInput>): string => {
    const compiled = compileTaskProfile({ ...base, ...over })
    if (!compiled.compiled) throw new Error('expected a profile')
    return taskProfileRef(compiled.profile)
  }
  const baseRef = refOf({})

  const MOVES: readonly (readonly [string, Partial<TaskProfileInput>])[] = [
    ['the goal text', { goalText: 'add a retry to the download path' }],
    ['the goal message it refers to', { goalRef: { sessionId: goalRef.sessionId, messageId: MessageId('message-other') } }],
    ['the turn ceiling', { budget: { maxTurns: 5, maxSpendUsd: 2 } }],
    ['the spend ceiling', { budget: { maxTurns: 4, maxSpendUsd: 3 } }],
    ['the workspace trust state', { workspaceTrust: 'untrusted' }],
    ['whether an identity is attached', { identityKnown: false }],
    ['the tally of content the objective does not include', { unreadGoalContent: [{ kind: 'image', count: 2 }] }],
  ]

  for (const [what, over] of MOVES) {
    it(`changing ${what} alone changes the reference, so that revision is visible in the chain`, () => {
      expect(refOf(over)).not.toBe(baseRef)
    })
  }

  it('leaves the reference alone when nothing structured changed, so an unchanged goal is not a revision', () => {
    // The positive control the seven above need: without it, a digest over a
    // clock or a counter would pass every one of them.
    expect(refOf({})).toBe(baseRef)
  })
})

// ---------------------------------------------------------------------------
// Contract stage SUPPLEMENT (delegate ruling, OQ4(b)). The C freeze is sealed
// and these titles are not in it. The ruling makes a goal continuation round a
// task, which it was not when C was frozen, and carries the goal's identity on
// the goal reference; both are C vocabulary, so the C cell goes back through
// observation with these cases in it.
// ---------------------------------------------------------------------------

const goalRound = { goalId: brandString<GoalId>('goal-7'), revision: 2, round: 3 } as const
const goalSource: MessageSource = { kind: 'goal', ...goalRound }

describe('P4-02 C — an entered goal\'s continuation round is a task (OQ4(b))', () => {
  it('classifies a goal continuation round as a user goal, not as an unknown source', () => {
    // The fail-closed default put these in `unknown-source`, which excluded
    // them — while `user/message`'s own documentation lists an entered goal
    // continuation round beside a direct prompt as a user-role message. One
    // recorded session sat on that.
    expect(taskOriginOf(goalSource)).toBe('user-goal')
  })

  it('still falls a kind it has no case for through to unknown-source, so the new case widened nothing else', () => {
    // The control the case above needs: `goal` became a task, and nothing else did.
    const notAGoal: MessageSource = { kind: 'tool', callId: brandString<ToolCallId>('call-2') }
    expect(taskOriginOf(notAGoal)).toBe('unknown-source')
  })

  it('reads the goal, the revision and the round off a continuation round', () => {
    expect(goalRoundOf(goalSource)).toStrictEqual(goalRound)
  })

  it('reads nothing off a direct human prompt, which continues no entered goal', () => {
    expect(goalRoundOf({ kind: 'user' })).toBeUndefined()
  })

  it('accepts a profile whose goal reference names the round it came from', () => {
    const withRound = profile({ goalRef: { ...goalRef, goalRound } })
    expect(validateTaskProfile(withRound).valid).toBe(true)
  })

  it('refuses round 0, because the goal domain admits positive rounds only', () => {
    // A stored 0 is a corrupted record rather than a first round, and a reader
    // that accepted it would report a round the goal domain never admitted.
    const impossible = profile({ goalRef: { ...goalRef, goalRound: { ...goalRound, round: 0 } } })
    expect(validateTaskProfile(impossible).valid).toBe(false)
  })

  it('refuses an unrecognised key inside the round, the same way the profile refuses one', () => {
    const extra = profile({ goalRef: { ...goalRef, goalRound: { ...goalRound, phase: 'later' } } } as never)
    expect(validateTaskProfile(extra).valid).toBe(false)
  })

  it('gives a different reference to two profiles that differ only in which round they came from', () => {
    // Which round of a revised goal a profile was compiled from is part of what
    // the profile IS: two rounds with identical text are not the same task, and
    // the revision chain has to be able to tell them apart.
    const third = taskProfileRef(profile({ goalRef: { ...goalRef, goalRound } }))
    const fourth = taskProfileRef(profile({ goalRef: { ...goalRef, goalRound: { ...goalRound, round: 4 } } }))
    expect(third).not.toBe(fourth)
  })

  it('gives a different reference to a profile with no round at all, so absence is not round 1', () => {
    expect(taskProfileRef(profile())).not.toBe(taskProfileRef(profile({ goalRef: { ...goalRef, goalRound } })))
  })
})
