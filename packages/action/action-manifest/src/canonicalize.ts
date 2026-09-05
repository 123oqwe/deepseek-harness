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
 * Canonicalize an arguments value into a stable, deterministic string form:
 * object keys sorted, strings Unicode-normalized, numbers rendered in one
 * canonical representation — so two semantically identical `args` values
 * always canonicalize identically regardless of source key order, Unicode
 * form, or number literal spelling (acceptance[1], validation[2]).
 * `computeArgumentsHash` is expected to call this before hashing.
 * @param args - the action's raw arguments value.
 * @returns the canonical string form of `args`.
 */
export function canonicalizeArguments(args: JsonValue): string {
  // Iterative, not recursive. The recursive form produced identical output for
  // every input this package's own suite exercises, and threw
  // `Maximum call stack size exceeded` on inputs the code-mode dispatch path
  // genuinely produces: `packages/core/tools/tests/ptc.spec.ts` dispatches
  // "binding arguments deeper than the structured-clone call stack", and depth
  // 20000 overflows while depth 1000 hashes in 2ms. Because this function
  // feeds `computeArgumentsHash`, a stack overflow here is not a slow path —
  // it makes the manifest for that call impossible to produce at all, so
  // P2-03 must[2]'s code-mode gate could not be wired while it stood.
  //
  // An explicit work stack replaces the call stack; nothing else changes. Key
  // ordering, NFC normalization, number spelling and the emitted punctuation
  // are the same operations in the same order, so every already-computed hash
  // stays valid — the equivalence is asserted case-by-case against a retained
  // copy of the recursive form in this package's own tests.
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
    if (typeof value === 'string') { out.push(JSON.stringify(value.normalize('NFC'))); continue }
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
      .map(([key, entryValue]): [string, JsonValue] => [key.normalize('NFC'), entryValue])
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
