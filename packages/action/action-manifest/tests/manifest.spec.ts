/**
 * Contract-stage RED scaffold for Epic P2-03's first-class ActionManifest.
 * One `it()` per registry-declared must[] clause and acceptance[] item
 * (compound clauses split into multiple named cases, mirroring
 * `@deepseek-ai/dsh-plugin-ownership`'s precedent). Every case below calls a
 * real exported function from `../src/canonicalize.ts` against real
 * branded/typed fixture data; every function currently throws
 * `'not implemented: ...'`, so every case fails for that reason today — the
 * assertions past the throwing call describe the behavior a later
 * fix-round must satisfy (dead code until then, same idiom as the
 * `plugin-ownership` precedent's multi-step cases).
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserPrincipal, PrincipalId, RunId, TenantId, type Principal } from '@deepseek-ai/dsh-principal'
import { describe, expect, it } from 'vitest'
import {
  assertManifestPrecedesExecution,
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
