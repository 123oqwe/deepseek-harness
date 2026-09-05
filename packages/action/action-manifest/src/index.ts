/**
 * Package entry point barrel. Standard package-registration infra, not
 * itself part of Epic P2-03's Contract-stage deliverable: every
 * Contract-stage type and decision function is defined and
 * documented in `./types.ts`/`./canonicalize.ts`, which this file only
 * re-exports (`./canonicalize.ts` already re-exports `./types.ts` in full).
 * Registry `stages.C.files` for P2-03 does not list this file;
 * `stages.U.files` does — a later Usage-stage Consumer adds the real
 * tool-dispatch wiring here.
 *
 * @module @deepseek-ai/dsh-action-manifest
 */
export * from './canonicalize.ts'

import { createActionManifest, assertManifestPrecedesExecution, computeArgumentsHash } from './canonicalize.ts'
import type {
  ActionId,
  ActionManifest,
  AppendedManifest,
  CreateActionManifestRequest,
  ExecutionGateDecision,
} from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * The durable append sink an execution path writes its manifest to before
 * running (must[1]).
 *
 * Deliberately an interface rather than a concrete log: the Contract stage
 * fixed `AppendedManifest.sequence` as assigned by "a real durable log (a
 * later Usage-stage Consumer)", and the appender is what supplies it. A
 * Consumer wires the session log in; tests wire an in-memory one.
 */
export interface ManifestAppender {
  /**
   * Durably append one manifest and return it with its assigned sequence.
   * @param manifest - the manifest to append.
   * @returns the appended record, carrying the monotonic sequence it occupies.
   */
  append(manifest: ActionManifest): AppendedManifest
  /**
   * Every manifest appended so far, in append order.
   * @returns the append-ordered log.
   */
  appended(): readonly AppendedManifest[]
}

/**
 * An in-memory {@link ManifestAppender}, assigning sequences from 1.
 * @returns a fresh appender.
 */
export function createMemoryManifestAppender(): ManifestAppender {
  const log: AppendedManifest[] = []
  return {
    append(manifest) {
      const entry = { manifest, sequence: log.length + 1 }
      log.push(entry)
      return entry
    },
    appended: () => log,
  }
}

/**
 * Generate a manifest, durably append it, and only then decide whether this
 * execution may proceed — must[1]'s order, enforced in one call so no
 * execution path can perform the steps out of order or skip one.
 *
 * This function is the whole of must[2]'s no-bypass guarantee. It takes the
 * action's `origin`, so a native tool call, a code-mode embedded call, and a
 * plugin RPC all reach the same gate through the same code, rather than each
 * path carrying its own copy of the rule. A path that skipped this function
 * would produce no appended manifest at all, which
 * {@link assertManifestPrecedesExecution} refuses as `no-manifest-appended`.
 *
 * The append happens BEFORE the gate decision and is never rolled back on a
 * refusal: acceptance[0] requires a manifest to exist in the log for every
 * external write attempt, and a refused attempt is exactly the case where the
 * record matters most. Rolling back would erase the evidence of the refusal.
 * @param appender - the durable sink.
 * @param request - the manifest request, including the raw `args` to hash.
 * @returns the gate decision, plus the appended record for the caller's evidence.
 */
export function appendManifestThenGate(
  appender: ManifestAppender,
  request: CreateActionManifestRequest,
): { readonly appended: AppendedManifest; readonly decision: ExecutionGateDecision } {
  const manifest = createActionManifest(request)
  const appended = appender.append(manifest)
  const decision = assertManifestPrecedesExecution(manifest.actionId, manifest.argumentsHash, appender.appended())
  return { appended, decision }
}

/**
 * Decide whether an already-manifested action may execute with the arguments
 * it is about to run with, re-hashing them rather than trusting a caller's
 * hash.
 *
 * Separate from {@link appendManifestThenGate} because the arguments a path
 * finally executes with are not always the ones it declared: a code-mode
 * program or an RPC layer can rewrite them between manifest and dispatch, and
 * that rewrite is precisely what `manifest-argument-mismatch` exists to catch.
 * @param actionId - the action being executed.
 * @param args - the raw arguments the execution is about to run with.
 * @param appended - the durable log.
 * @returns the gate decision.
 */
export function gateExecution(
  actionId: ActionId,
  args: JsonValue,
  appended: readonly AppendedManifest[],
): ExecutionGateDecision {
  return assertManifestPrecedesExecution(actionId, computeArgumentsHash(args), appended)
}

