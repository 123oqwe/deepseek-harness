/**
 * Contract-stage pure decision logic for Epic P2-03's first-class
 * ActionManifest: argument canonicalization and hashing (acceptance[1]),
 * side-effect classification with a fail-closed default (acceptance[2]),
 * manifest construction (must[0], must[1]), and the durable-append-precedes-
 * execution ordering gate (must[1], acceptance[0], must[2]).
 *
 * None of these functions read a file, spawn a process, or construct a
 * Cordis `Context` — every input is a plain value the caller supplies. This
 * epic's `stages.P` is `N/A` ("immutable definition/canonicalizer, not an
 * I/O provider"), so this file never grows a real-I/O counterpart of its
 * own; wiring `createActionManifest`/`assertManifestPrecedesExecution` into
 * the real tool dispatch pipeline (`packages/core/tools/src/index.ts`,
 * `packages/core/tools/src/ptc.ts`, `packages/core/agent-loop/src/tool-calls.ts`)
 * is a later Usage-stage Consumer's job, not this file's.
 *
 * @module @deepseek-ai/dsh-action-manifest/canonicalize
 */
export type * from './types.ts'

import type {
  ActionId,
  ActionManifest,
  ActionSideEffectClass,
  AppendedManifest,
  ArgumentsHash,
  CreateActionManifestRequest,
  ExecutionGateDecision,
  SideEffectClassification,
} from './types.ts'
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Canonicalize an arguments value per **RFC 8785 (JCS)**: sorted keys, one
 * number spelling, one string-escape spelling — and **Unicode normalization
 * form PRESERVED**.
 *
 * **The NFC normalization this used to do was a security defect** (corrected
 * 2026-09-06). JCS deliberately does not normalize, because two code point
 * sequences are two values. Folding them meant precomposed and decomposed
 * spellings of the same character produced one `argumentsHash`, so where they
 * name two different files, an approval bound to that hash for one action would
 * authorise the other — and P2-06 binds approvals to exactly this hash. It also
 * broke cross-language agreement by construction: P8-07's Python side uses a
 * standard JCS library, which does not normalize either.
 *
 * **Why this is hand-written when a library exists, which is a question this
 * repository is right to ask.** Every JavaScript RFC 8785 implementation is
 * recursive, and measured on 2026-09-06: `canonicalize` 2.1.0 handles depth
 * 1000 and overflows the stack at 5000; `canonicalize` 4.0.0 and
 * `json-canonicalize` 3.0.0 overflow at 5000 too. The code-mode dispatch path
 * genuinely produces arguments that deep — `packages/core/tools/tests/ptc.spec.ts`
 * dispatches at depth 5000 to pin that boundary — so no available library can
 * do what this call site requires. The exception is not "nobody looked for a
 * library"; it is a constraint that can be re-tested when one of them stops
 * recursing.
 *
 * **What keeps that exception honest is a differential test, not this comment.**
 * `canonicalize@2.1.0` is a devDependency purely as an oracle: a property case
 * asserts this function agrees with the reference implementation over generated
 * JSON, so conformance is checked against the standard rather than against four
 * properties someone chose to name. Agreeing with a list is weaker than
 * agreeing with the reference — the list cannot know about UTF-16 code unit key
 * ordering, `-0`, or ES6 number formatting until someone thinks of them.
 * @param args - the action's raw arguments value.
 * @returns the RFC 8785 canonical string form of `args`.
 */
export function canonicalizeArguments(args: JsonValue): string {
  // An explicit work stack replaces the call stack, which is what lets this
  // canonicalize at depths every JS JCS library overflows on. A stack overflow
  // here would not be a slow path: it makes the manifest for that call
  // impossible to produce at all, so P2-03 must[2]'s code-mode gate could not
  // be wired while the recursive form stood.
  //
  // Correctness is established against the REFERENCE implementation, not
  // against the recursive predecessor this replaced. Equivalence to the old
  // code would only have proved the two agree; the differential property case
  // proves this agrees with RFC 8785 as `canonicalize` implements it.
  const out: string[] = []
  // A frame is either a value still to be written, or a literal separator to
  // emit once the values before it are done.
  const stack: ({ readonly value: JsonValue } | { readonly literal: string })[] = [{ value: args }]
  while (stack.length > 0) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by the loop condition
    const frame = stack.pop()!
    if ('literal' in frame) {
      out.push(frame.literal)
      continue
    }
    const value = frame.value
    if (value === null) { out.push('null'); continue }
    if (typeof value === 'boolean') { out.push(value ? 'true' : 'false'); continue }
    if (typeof value === 'number') { out.push(JSON.stringify(value)); continue }
    if (typeof value === 'string') { out.push(JSON.stringify(value)); continue }
    if (Array.isArray(value)) {
      // Pushed in reverse so the stack pops them left to right.
      stack.push({ literal: ']' })
      for (let index = value.length - 1; index >= 0; index -= 1) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- index is in range
        stack.push({ value: value[index]! })
        if (index > 0) stack.push({ literal: ',' })
      }
      stack.push({ literal: '[' })
      continue
    }
    const entries = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    stack.push({ literal: '}' })
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- index is in range
      const [key, entryValue] = entries[index]!
      stack.push({ value: entryValue })
      stack.push({ literal: `${JSON.stringify(key)}:` })
      if (index > 0) stack.push({ literal: ',' })
    }
    stack.push({ literal: '{' })
  }
  return out.join('')
}

/**
 * Hash `args` into the {@link ArgumentsHash} an {@link ActionManifest}
 * carries (must[0], acceptance[1]). Two `args` values that
 * {@link canonicalizeArguments} maps to the same canonical string MUST hash
 * to the same {@link ArgumentsHash} — key order, Unicode normalization form,
 * and number literal spelling never affect the result (validation[2]'s
 * fuzz requirement).
 * @param args - the action's raw arguments value.
 * @returns a stable {@link ArgumentsHash} for `args`.
 */
export function computeArgumentsHash(args: JsonValue): ArgumentsHash {
  const digest = createHash('sha256').update(canonicalizeArguments(args), 'utf8').digest('hex')
  return brandString<ArgumentsHash>(digest)
}

/**
 * Classify an action's side effect from the underlying capability's own
 * declared class, when one is available (acceptance[2]). When `declared` is
 * `undefined` — the capability declares no {@link ActionSideEffectClass}, or
 * the caller could not resolve one — this function MUST return
 * `{ sideEffectClass: 'destructive', classified: false, requiresApproval: true }`:
 * the highest-risk class, marked unclassified, requiring approval. When
 * `declared` is present, it is trusted directly:
 * `{ sideEffectClass: declared, classified: true, requiresApproval }`, with
 * `requiresApproval` decided by `declared` itself (a later fix-round's
 * policy, not fixed by this Contract stage beyond the unclassifiable
 * default).
 * @param declared - the capability's own declared side-effect class, or `undefined` when none is available.
 * @returns the resulting {@link SideEffectClassification}.
 */
export function classifySideEffect(declared: ActionSideEffectClass | undefined): SideEffectClassification {
  if (declared === undefined) return { sideEffectClass: 'destructive', classified: false, requiresApproval: true }
  return { sideEffectClass: declared, classified: true, requiresApproval: declared === 'destructive' }
}

/**
 * Refuse arguments carrying values JSON cannot hold, before a manifest exists.
 *
 * The manifest's value domain is JSON — that is the contract, and it belongs
 * here rather than in the canonicalizer. `canonicalizeArguments` agrees with
 * RFC 8785, which builds on JSON, and JSON renders `Infinity` and `NaN` as
 * `null`; making the canonicalizer throw instead would put it out of step with
 * the reference implementation, which the differential case would catch.
 *
 * But `null` is a real value a caller might mean. `{amount: Infinity}` and
 * `{amount: null}` canonicalize identically, so they share an
 * `argumentsHash` — and P2-06 binds approvals to that hash, which makes
 * approving one of them approve the other. The same confusion the NFC
 * normalization caused, reached from the value domain instead of from the
 * encoding.
 *
 * A `bigint` is refused for the same reason from the other direction: it has no
 * JSON form at all, and `JSON.stringify` throws on it rather than choosing one.
 * @param args - the arguments value about to be hashed into a manifest.
 * @throws TypeError naming the offending path when a value has no JSON form.
 */
function assertJsonArguments(args: JsonValue): void {
  // An explicit stack, not recursion. `computeArgumentsHash` canonicalises the
  // same value iteratively and survives arguments deeper than the structured-
  // clone call stack -- a case `ptc.spec.ts` pins -- so a recursive validator
  // in front of it turned a supported input into a RangeError. Nothing found
  // it while `createActionManifest` had no production caller: the validator
  // only ever saw test-sized values (BLOCKED-143).
  const pending: { value: unknown; path: string }[] = [{ value: args, path: 'args' }]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, path } = next
    if (typeof value === 'bigint') {
      throw new TypeError(`createActionManifest: ${path} is a bigint, which has no JSON form`)
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`createActionManifest: ${path} is ${String(value)}, which JSON renders as null and would share a hash with a real null`)
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => { pending.push({ value: item, path: `${path}[${String(index)}]` }) })
      continue
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) pending.push({ value: nested, path: `${path}.${key}` })
    }
  }
}

/**
 * must[0]/must[1]'s manifest-construction entry point: build a complete
 * {@link ActionManifest} from `request`, deriving
 * {@link ActionManifest.argumentsHash} via `computeArgumentsHash(request.args)`
 * and {@link ActionManifest.sideEffectClass}/{@link ActionManifest.requiresApproval}
 * via `classifySideEffect(request.declaredSideEffectClass)`. Construction
 * alone never durably appends anything or makes a policy/approval decision
 * — must[1] requires generation to happen first, but generation and
 * durable append are two distinct steps; a later Usage-stage Consumer owns
 * the actual append.
 * @param request - the {@link CreateActionManifestRequest} to build a manifest from.
 * @returns a complete {@link ActionManifest}.
 */
export function createActionManifest(request: CreateActionManifestRequest): ActionManifest {
  assertJsonArguments(request.args)
  const classification = classifySideEffect(request.declaredSideEffectClass)
  return {
    actionId: request.actionId,
    runId: request.runId,
    actor: request.actor,
    capability: request.capability,
    origin: request.origin,
    target: request.target,
    argumentsHash: computeArgumentsHash(request.args),
    sideEffectClass: classification.sideEffectClass,
    requiresApproval: classification.requiresApproval,
    idempotencyKey: request.idempotencyKey,
    preconditions: request.preconditions,
    expectedDiff: request.expectedDiff,
    compensation: request.compensation,
    evidenceRequirements: request.evidenceRequirements,
  }
}

/**
 * must[1]/acceptance[0]'s ordering gate: an execution attempt for
 * `actionId`/`argumentsHash` may proceed only when `appended` already
 * contains an {@link AppendedManifest} whose `manifest.actionId` equals
 * `actionId` AND whose `manifest.argumentsHash` equals `argumentsHash`.
 * Refuses with `'no-manifest-appended'` when no appended manifest names
 * `actionId` at all — the execution path attempted to run before
 * generating and durably appending a manifest, or skipped manifest
 * generation entirely (must[2]: this refusal applies identically
 * regardless of the manifest's {@link ActionOrigin} — a code-mode embedded
 * sub-dispatch or a plugin RPC call gets no exemption). Refuses with
 * `'manifest-argument-mismatch'` when a manifest for `actionId` exists but
 * its `argumentsHash` differs from `argumentsHash` — the appended manifest
 * does not describe this execution attempt.
 * @param actionId - the {@link ActionId} of the execution attempt to gate.
 * @param argumentsHash - the {@link ArgumentsHash} the execution attempt is about to run with.
 * @param appended - every {@link AppendedManifest} durably appended so far, in append order.
 * @returns `{ admitted: true, manifest }` naming the matching manifest, or `{ admitted: false, reason }`.
 */
export function assertManifestPrecedesExecution(
  actionId: ActionId,
  argumentsHash: ArgumentsHash,
  appended: readonly AppendedManifest[],
): ExecutionGateDecision {
  const forActionId = appended.filter(entry => entry.manifest.actionId === actionId)
  if (forActionId.length === 0) return { admitted: false, reason: 'no-manifest-appended' }
  const matching = forActionId.find(entry => entry.manifest.argumentsHash === argumentsHash)
  if (matching === undefined) return { admitted: false, reason: 'manifest-argument-mismatch' }
  return { admitted: true, manifest: matching.manifest }
}
