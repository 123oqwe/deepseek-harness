/**
 * Clause coverage for Epic P2-03's first-class ActionManifest. One `it()` per
 * registry-declared must[] clause and acceptance[] item (compound clauses split
 * into multiple named cases, mirroring `@deepseek-ai/dsh-plugin-ownership`'s
 * precedent). Every case calls an exported function from
 * `../src/canonicalize.ts` against real branded/typed fixture data.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserPrincipal, PrincipalId, RunId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'
import canonicalize from 'canonicalize'
import fc from 'fast-check'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import {
  assertManifestPrecedesExecution,
  canonicalizeArguments,
  classifySideEffect,
  computeArgumentsHash,
  createActionManifest,
} from '../src/canonicalize.ts'
import type {
  ActionId,
  ActionManifest,
  ActionOrigin,
  ActionTarget,
  AppendedManifest,
  ArgumentsHash,
  CapabilityRef,
  Compensation,
  CreateActionManifestRequest,
  EvidenceRequirement,
  ExpectedDiff,
  IdempotencyKey,
  Precondition,
} from '../src/types.ts'

const actor: Principal = createUserPrincipal(PrincipalId('user-1'), TenantId('tenant-1'))
const runId = RunId('run-1')

const preconditions: readonly Precondition[] = [{ description: 'target file exists' }]
const expectedDiff: ExpectedDiff = { description: 'file contents replaced', before: 'old contents', after: 'new contents' }
const compensation: Compensation = { reversible: true, capability: brandString<CapabilityRef>('fs:write_file'), argumentsHash: brandString<ArgumentsHash>('compensation-hash'), description: 'restore prior contents' }
const evidenceRequirements: readonly EvidenceRequirement[] = [{ kind: 'before-state', description: 'file contents before write' }]
const target: ActionTarget = { kind: 'filesystem', path: '/workspace/example.txt' }

/** Build a real {@link CreateActionManifestRequest} fixture, without exercising the (stubbed) real construction function. */
function fixtureRequest(overrides: Partial<CreateActionManifestRequest> = {}): CreateActionManifestRequest {
  return {
    actionId: brandString<ActionId>('action-1'),
    runId,
    actor,
    capability: brandString<CapabilityRef>('fs:write_file'),
    origin: 'native-tool-call',
    target,
    args: { path: '/workspace/example.txt', contents: 'new contents' },
    idempotencyKey: brandString<IdempotencyKey>('idem-1'),
    preconditions,
    expectedDiff,
    compensation,
    evidenceRequirements,
    ...overrides,
  }
}

/**
 * Build a real {@link ActionManifest} fixture directly (not through the
 * stubbed `createActionManifest`), for tests that only need an
 * already-appended manifest.
 */
function fixtureManifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    actionId: brandString<ActionId>('action-1'),
    runId,
    actor,
    capability: brandString<CapabilityRef>('fs:write_file'),
    origin: 'native-tool-call',
    target,
    argumentsHash: brandString<ArgumentsHash>('hash-1'),
    sideEffectClass: 'write',
    classified: true,
    requiresApproval: false,
    idempotencyKey: brandString<IdempotencyKey>('idem-1'),
    preconditions,
    expectedDiff,
    compensation,
    evidenceRequirements,
    ...overrides,
  }
}

describe('P2-03 Contract — must clauses', () => {
  it('must[0]: a constructed manifest carries actionId/runId/actor/capability/target/argumentsHash/sideEffectClass/idempotencyKey/preconditions/expectedDiff/compensation/evidence requirements', () => {
    const request = fixtureRequest()
    const manifest = createActionManifest(request)
    expect(manifest.actionId).toBe(request.actionId)
    expect(manifest.runId).toBe(request.runId)
    expect(manifest.actor).toBe(request.actor)
    expect(manifest.capability).toBe(request.capability)
    expect(manifest.target).toEqual(request.target)
    expect(typeof manifest.argumentsHash).toBe('string')
    expect(manifest.argumentsHash.length).toBeGreaterThan(0)
    expect(['read', 'write', 'network', 'process', 'destructive']).toContain(manifest.sideEffectClass)
    expect(manifest.idempotencyKey).toBe(request.idempotencyKey)
    expect(manifest.preconditions).toEqual(request.preconditions)
    expect(manifest.expectedDiff).toEqual(request.expectedDiff)
    expect(manifest.compensation).toEqual(request.compensation)
    expect(manifest.evidenceRequirements).toEqual(request.evidenceRequirements)
  })

  it('must[1]: an execution attempt with no manifest appended for its actionId is refused before any policy/approval step could run', () => {
    const decision = assertManifestPrecedesExecution(brandString<ActionId>('never-manifested'), brandString<ArgumentsHash>('hash-1'), [])
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('no-manifest-appended')
  })

  it('must[2]: a code-mode embedded sub-dispatch is admitted when its manifest precedes it, and refused exactly like a native call when it does not', () => {
    const actionId = brandString<ActionId>('code-mode-action')
    const argumentsHash = brandString<ArgumentsHash>('code-mode-hash')
    const manifest = fixtureManifest({ actionId, argumentsHash, origin: 'code-mode-embedded' as ActionOrigin })
    const appended: readonly AppendedManifest[] = [{ manifest, sequence: 1 }]

    const admitted = assertManifestPrecedesExecution(actionId, argumentsHash, appended)
    expect(admitted.admitted).toBe(true)
    if (admitted.admitted) expect(admitted.manifest.origin).toBe('code-mode-embedded')

    const refused = assertManifestPrecedesExecution(brandString<ActionId>('code-mode-unmanifested'), argumentsHash, [])
    expect(refused.admitted).toBe(false)
    if (!refused.admitted) expect(refused.reason).toBe('no-manifest-appended')
  })

  it('must[2]: a plugin RPC call is admitted when its manifest precedes it, and refused exactly like a native call when it does not', () => {
    const actionId = brandString<ActionId>('plugin-rpc-action')
    const argumentsHash = brandString<ArgumentsHash>('plugin-rpc-hash')
    const manifest = fixtureManifest({ actionId, argumentsHash, origin: 'plugin-rpc' as ActionOrigin })
    const appended: readonly AppendedManifest[] = [{ manifest, sequence: 1 }]

    const admitted = assertManifestPrecedesExecution(actionId, argumentsHash, appended)
    expect(admitted.admitted).toBe(true)
    if (admitted.admitted) expect(admitted.manifest.origin).toBe('plugin-rpc')

    const refused = assertManifestPrecedesExecution(brandString<ActionId>('plugin-rpc-unmanifested'), argumentsHash, [])
    expect(refused.admitted).toBe(false)
    if (!refused.admitted) expect(refused.reason).toBe('no-manifest-appended')
  })
})

describe('P2-03 Contract — acceptance[0]: 任何外部写操作在事件日志中都存在先于执行的 ActionManifest', () => {
  it('a manifest generated and durably appended before execution admits that exact execution attempt', () => {
    const actionId = brandString<ActionId>('write-action')
    const argumentsHash = brandString<ArgumentsHash>('write-hash')
    const manifest = fixtureManifest({ actionId, argumentsHash })
    const appended: readonly AppendedManifest[] = [{ manifest, sequence: 1 }]

    const decision = assertManifestPrecedesExecution(actionId, argumentsHash, appended)
    expect(decision.admitted).toBe(true)
    if (decision.admitted) {
      expect(decision.manifest.actionId).toBe(actionId)
      expect(decision.manifest.argumentsHash).toBe(argumentsHash)
    }
  })

  it('an external write whose actionId has no preceding manifest is blocked, even when unrelated manifests already exist in the log', () => {
    const unrelatedManifest = fixtureManifest({ actionId: brandString<ActionId>('unrelated-action'), argumentsHash: brandString<ArgumentsHash>('unrelated-hash') })
    const appended: readonly AppendedManifest[] = [{ manifest: unrelatedManifest, sequence: 1 }]

    const decision = assertManifestPrecedesExecution(brandString<ActionId>('write-action-without-manifest'), brandString<ArgumentsHash>('write-hash'), appended)
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('no-manifest-appended')
  })

  it('a manifest appended for the right actionId but the wrong arguments hash does not admit execution (tamper/substitution is not a preceding manifest)', () => {
    const actionId = brandString<ActionId>('substituted-action')
    const manifest = fixtureManifest({ actionId, argumentsHash: brandString<ArgumentsHash>('manifested-hash') })
    const appended: readonly AppendedManifest[] = [{ manifest, sequence: 1 }]

    const decision = assertManifestPrecedesExecution(actionId, brandString<ArgumentsHash>('different-hash-at-execution-time'), appended)
    expect(decision.admitted).toBe(false)
    if (!decision.admitted) expect(decision.reason).toBe('manifest-argument-mismatch')
  })
})

describe('P2-03 Contract — acceptance[1]: 参数规范化稳定，语义相同对象得到相同 hash', () => {
  it('objects with the same keys in a different order hash identically', () => {
    const hashA = computeArgumentsHash({ path: '/workspace/example.txt', contents: 'new contents' })
    const hashB = computeArgumentsHash({ contents: 'new contents', path: '/workspace/example.txt' })
    expect(hashA).toBe(hashB)
  })

  it('the SAME JSON value spelled with an escape or a literal character hashes identically', () => {
    // RFC 8785 conformance: `\\u00e9` and the literal character are one value
    // with two source spellings, and JSON parsing collapses them before a
    // manifest is ever built. This is the escape-spelling half of the clause.
    const escaped = JSON.parse('{"path":"\\u00e9"}') as { path: string }
    expect(computeArgumentsHash(escaped)).toBe(computeArgumentsHash({ path: '\u00e9' }))
  })

  it('SECURITY: NFC and NFD are DIFFERENT values and MUST NOT share a hash', () => {
    // The correction of 2026-09-06, and the reason this file changed. RFC 8785
    // does not normalize Unicode and neither may this: precomposed and
    // decomposed are different code point sequences, so where they name two
    // different files, one approval bound to `argumentsHash` would authorise
    // the other action. P2-06 binds approvals to this hash.
    //
    // Both forms are CONSTRUCTED from code points, never written as literals: a
    // shell or an editor may normalize a source file, and the case would then
    // compare a string with itself and pass while testing nothing. That is
    // exactly what happened while verifying the replacement library.
    const nfc = '\u00e9'
    const nfd = 'e\u0301'
    expect(nfc).not.toBe(nfd)
    expect(computeArgumentsHash({ path: nfc })).not.toBe(computeArgumentsHash({ path: nfd }))
  })

  it('SECURITY: a manifest REFUSES a non-finite number, which would otherwise share a hash with a real null', () => {
    // The value-domain half of the same confusion the NFC normalization caused,
    // reached from the other side. `{amount: Infinity}` canonicalizes to
    // `{"amount":null}` — correct per RFC 8785, which builds on JSON — so it
    // shares an argumentsHash with an action whose amount really is null. P2-06
    // binds approvals to that hash, so approving one would approve the other.
    //
    // The refusal belongs HERE and not in the canonicalizer: making the
    // canonicalizer throw would put it out of step with the reference
    // implementation, and the differential case would catch that immediately.
    // The value domain is the manifest's contract; the encoding is JCS's.
    expect(() => createActionManifest({ ...fixtureRequest(), args: { amount: Number.POSITIVE_INFINITY } }))
      .toThrow(/Infinity, which JSON renders as null/)
    expect(() => createActionManifest({ ...fixtureRequest(), args: { nested: [{ n: Number.NaN }] } }))
      .toThrow(/args\.nested\[0\]\.n is NaN/)
    expect(() => createActionManifest({ ...fixtureRequest(), args: { big: 1n } as never }))
      .toThrow(/is a bigint, which has no JSON form/)
    // A real null is still a legal value, which is what makes the refusal mean
    // something rather than being a blanket ban on the shape.
    expect(() => createActionManifest({ ...fixtureRequest(), args: { amount: null } })).not.toThrow()
  })

  it('a non-finite number canonicalizes to null, exactly as JSON.stringify defines it', () => {
    // Not a refusal: RFC 8785 builds on JSON, and JSON has no Infinity or NaN —
    // `JSON.stringify` renders both as `null`, and the reference implementation
    // does the same. Pinned because "what happens to a value JSON cannot hold"
    // is the kind of edge a hand-written canonicalizer gets wrong silently.
    expect(canonicalizeArguments({ n: Number.POSITIVE_INFINITY }))
      .toBe(canonicalizeArguments({ n: null }))
    expect(canonicalizeArguments({ n: Number.NaN }))
      .toBe(canonicalizeArguments({ n: null }))
  })

  it('numbers in different literal representations of the same value hash identically', () => {
    const hashA = computeArgumentsHash({ count: 100 })
    const hashB = computeArgumentsHash({ count: 1e2 })
    expect(hashA).toBe(hashB)
  })

  it('arguments that differ semantically hash to different values (canonicalization is not a constant function)', () => {
    const hashA = computeArgumentsHash({ path: '/workspace/example.txt' })
    const hashB = computeArgumentsHash({ path: '/workspace/other.txt' })
    expect(hashA).not.toBe(hashB)
  })
})

describe('P2-03 Contract — acceptance[2]: 无法分类副作用的动作默认高风险并要求审批', () => {
  it('an action whose side effect cannot be classified defaults to the highest-risk class and requires approval', () => {
    const classification = classifySideEffect(undefined)
    expect(classification.classified).toBe(false)
    expect(classification.sideEffectClass).toBe('destructive')
    expect(classification.requiresApproval).toBe(true)

    const manifest = createActionManifest(fixtureRequest()) // fixtureRequest() sets no declaredSideEffectClass at all
    expect(manifest.sideEffectClass).toBe('destructive')
    expect(manifest.requiresApproval).toBe(true)
  })

  it('an action with a declared, classifiable side effect is classified as declared, not defaulted to the unclassifiable high-risk fallback', () => {
    const classification = classifySideEffect('read')
    expect(classification.classified).toBe(true)
    expect(classification.sideEffectClass).toBe('read')
  })
})

/**
 * P2-03 Fault — validation[2]: the canonicalizer is fuzzed for hash confusion.
 *
 * The Contract stage pinned three named confusions with one example each: key
 * order, NFC versus NFD, and `100` versus `1e2`. Three examples cannot say
 * whether the property holds generally, and the clause asks for fuzzing
 * precisely because a canonicalizer fails on the input nobody thought to write.
 *
 * Two directions, and both are needed. **Same value, different spelling must
 * collide** — otherwise a replay of an identical action is refused as tampering.
 * **Different value must not collide** — otherwise a substituted argument passes
 * as the one that was authorised, which is the attack the hash exists to stop.
 * A canonicalizer that returned a constant satisfies the first alone; one that
 * hashed raw bytes satisfies the second alone.
 *
 * **Effective samples, measured 2026-09-06:** key-order 500/500, Unicode
 * 200/200, no-collision 500/500, separator 300/300 — every property runs its
 * whole budget with no precondition rejections. That is the number a starving
 * generator destroys while the suite stays green, so check a generator change
 * against these counts rather than against the colour.
 */
/**
 * P2-03 — the hand-written canonicalizer agrees with the RFC 8785 reference.
 *
 * The four named properties (key order, number spelling, escape spelling, and
 * NFC-versus-NFD) are the ones someone thought to name. JCS has more: keys sort
 * by UTF-16 code unit, numbers render by ES6 `Number::toString`, `-0`
 * serializes as `0`, strings escape as `JSON.stringify` does. **Agreeing with a
 * list is weaker than agreeing with the reference**, and this is the case that
 * makes the hand-written implementation's exception auditable rather than
 * asserted — it exists only because every JS JCS library recurses and overflows
 * on the depths the code-mode path produces.
 */
describe('P2-03 — differential conformance against the RFC 8785 reference implementation', () => {
  /** JSON values reaching the edges JCS actually specifies, not just the ones already named. */
  const jcsValue = fc.letrec<{ value: JsonValue }>(tie => ({
    value: fc.oneof(
      { depthSize: 'small', maxDepth: 6 },
      fc.constant(null),
      fc.boolean(),
      // -0, exponent forms either side of the ES6 fixed/exponential switch, and
      // an integer past 2^53 — the number cases a hand-written renderer misses.
      fc.constantFrom(0, -0, 1, -1, 1e21, 1e-7, 1.5e300, 9007199254740993, 0.1, -0.0001),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      // Strings spanning both normalization forms, escapes, and a surrogate
      // pair. The decomposed form is BUILT from code points: a literal in this
      // file could be normalized by an editor, and the case would then compare
      // a string with itself.
      fc.constantFrom('', 'a', '\u00e9', 'e\u0301', '"', '\\', '\n', '\u0000', '\u007f', '\ud83d\ude00', 'ß', 'A'),
      fc.string({ maxLength: 8 }),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(fc.oneof(fc.string({ minLength: 1, maxLength: 5 }), fc.constantFrom('a', 'A', 'á', 'Z', '0')), tie('value'), { maxKeys: 5 }),
    ),
  })).value

  it('produces byte-identical output to `canonicalize` for every generated JSON value', () => {
    fc.assert(fc.property(jcsValue, (value) => {
      expect(canonicalizeArguments(value)).toBe(canonicalize(value))
    }), { numRuns: 1000 })
  })

  it('canonicalizes at a depth every JS JCS library overflows on, which is why it is hand-written', () => {
    // The measured constraint, reproducible rather than asserted in a comment:
    // canonicalize 2.1.0 handles 1000 and throws at 5000; 4.0.0 and
    // json-canonicalize 3.0.0 throw at 5000 too. This is the same depth
    // `packages/core/tools/tests/ptc.spec.ts` dispatches at.
    let deep: JsonValue = { leaf: true }
    for (let index = 0; index < 5_000; index += 1) deep = { next: deep }
    expect(() => canonicalizeArguments(deep)).not.toThrow()
    expect(() => canonicalize(deep)).toThrow(/call stack/)
  })
})

describe('P2-03 Fault — validation[2]: fuzzing the canonicalizer for hash confusion', () => {
  /** A JSON value generator, kept shallow enough that shrinking reports something readable. */
  const jsonValue = fc.letrec<{ value: JsonValue }>(tie => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1000, max: 1000 }),
      fc.string(),
      fc.array(tie('value'), { maxLength: 4 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), { maxKeys: 4 }),
    ),
  })).value

  /** Rebuild an object graph with every object's keys in a different order. */
  const reorderKeys = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(reorderKeys)
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value).reverse()
      return Object.fromEntries(entries.map(([key, nested]) => [key, reorderKeys(nested)]))
    }
    return value
  }

  it('key order never changes the hash, over generated values rather than one example', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      expect(computeArgumentsHash(reorderKeys(value))).toBe(computeArgumentsHash(value))
    }), { numRuns: 500 })
  })

  it('SECURITY: NFD and NFC never share a hash, over generated strings that have two forms', () => {
    // REVERSED on 2026-09-06. This case used to assert that a Unicode form
    // change never changes the hash — the exact confusion RFC 8785 forbids —
    // and it carried a mutation proof, so the defect was pinned as a
    // requirement. **A mutation proof shows a suite is sensitive to what it
    // asserts; it says nothing about whether the assertion is right.** What
    // decides that is the clause wording, the make-vs-use ledger's risk note
    // for this epic, and the security consequence — and all three pointed the
    // other way while this case was frozen.
    //
    // Built from characters that decompose, not filtered from arbitrary
    // strings: a filter looked right and starved, because `fc.string()` almost
    // never produces a value whose NFD differs from its NFC, so the run spent
    // its whole budget rejecting inputs and hung rather than failing.
    const composed = fc.stringMatching(/^[\u00e0-\u00ff\u0100-\u017f]{1,8}$/)
    fc.assert(fc.property(composed, (text) => {
      const nfd = text.normalize('NFD')
      const nfc = text.normalize('NFC')
      fc.pre(nfd !== nfc)
      expect(computeArgumentsHash({ text: nfd })).not.toBe(computeArgumentsHash({ text: nfc }))
    }), { numRuns: 200 })
  })

  it('two values that differ do NOT collide, which is the half a constant hash would satisfy', () => {
    fc.assert(fc.property(jsonValue, jsonValue, (a, b) => {
      // Compared through the canonical form rather than through deep equality:
      // the claim is about what the hash distinguishes, and two values with the
      // same canonical string SHOULD hash alike — that is the point of the
      // first two cases.
      fc.pre(canonicalizeArguments(a) !== canonicalizeArguments(b))
      expect(computeArgumentsHash(a)).not.toBe(computeArgumentsHash(b))
    }), { numRuns: 500 })
  })

  it('a key containing the separator does not collide with a value spelled to look like one', () => {
    // WHAT THIS DOES AND DOES NOT SHOW, corrected after running the mutation.
    // It was first written claiming to prove what length-prefixing buys — which
    // is wrong twice over: this canonicalizer does not length-prefix (that is
    // `computeSchemaFingerprint`, a different function in a different package),
    // and unquoting the key so `:` stops being escaped reddens NOTHING here.
    //
    // The reason is structural and worth stating rather than patching over: every
    // emitted value is self-delimiting — strings arrive quoted, numbers as
    // numeric literals, containers in braces — so no key spelling can produce the
    // byte sequence another value produces. The separator confusion this case is
    // named for cannot be constructed against this canonicalizer at all.
    //
    // The case is kept because it is a true difference check over generated
    // pairs, and the assertion is NOT rewritten to chase the surviving mutation
    // (BLOCKED-079). What changed is the claim above it.
    fc.assert(fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (left, right) => {
      fc.pre(left !== right)
      expect(computeArgumentsHash({ [`${left}:${right}`]: 1 }))
        .not.toBe(computeArgumentsHash({ [left]: `${right}:1` }))
    }), { numRuns: 300 })
  })
})
