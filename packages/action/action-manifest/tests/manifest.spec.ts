/**
 * Clause coverage for Epic P2-03's first-class ActionManifest. One `it()` per
 * registry-declared must[] clause and acceptance[] item (compound clauses split
 * into multiple named cases, mirroring `@deepseek-ai/dsh-plugin-ownership`'s
 * precedent). Every case calls an exported function from
 * `../src/canonicalize.ts` against real branded/typed fixture data.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserPrincipal, PrincipalId, RunId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'
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

  it('strings in different Unicode normalization forms (NFC vs NFD) hash identically', () => {
    const nfc = 'é' // 'é' as a single precomposed code point
    const nfd = 'é' // 'e' + combining acute accent, same rendered character
    const hashA = computeArgumentsHash({ path: nfc })
    const hashB = computeArgumentsHash({ path: nfd })
    expect(hashA).toBe(hashB)
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
 */
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
      return Object.fromEntries(entries.map(([key, nested]) => [key, reorderKeys(nested as JsonValue)]))
    }
    return value
  }

  it('key order never changes the hash, over generated values rather than one example', () => {
    fc.assert(fc.property(jsonValue, (value) => {
      expect(computeArgumentsHash(reorderKeys(value))).toBe(computeArgumentsHash(value))
    }), { numRuns: 500 })
  })

  it('a Unicode form change never changes the hash, over generated strings that HAVE two forms', () => {
    // Built from characters that decompose, not filtered from arbitrary strings.
    // A filter looked right and starved: `fc.string()` almost never produces a
    // value whose NFD differs from its NFC, so the generator spends its budget
    // rejecting and the case hangs rather than failing — a property that cannot
    // find an input to test is not a passing property.
    const composed = fc.stringMatching(/^[\u00e0-\u00ff\u0100-\u017f]{1,8}$/)
    fc.assert(fc.property(composed, (text) => {
      const nfd = text.normalize('NFD')
      const nfc = text.normalize('NFC')
      fc.pre(nfd !== nfc)
      expect(computeArgumentsHash({ text: nfd })).toBe(computeArgumentsHash({ text: nfc }))
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
