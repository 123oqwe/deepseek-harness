/**
 * Normalization for values thrown by a final LLM adapter boundary.
 *
 * @module @deepseek-ai/dsh-llm/adapter-failure
 */

import type { FailureFacts } from '@deepseek-ai/dsh-retry/classify'

import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  HarnessError,
  INVALID_CREDENTIAL_CODE,
  QUOTA_EXCEEDED_CODE,
} from './error.ts'
import type { LlmFailure } from './types.ts'

/**
 * Codes that name a request the provider could not accept as written.
 *
 * Mapped to `malformed` rather than left to the status because the two say
 * different things to an operator: a `400` is "this endpoint rejected it" and
 * `invalid-input` is "the arguments are wrong", which is the one an operator
 * can act on. A context overflow belongs here because the conversation must
 * shrink before a resend can succeed.
 */
const MALFORMED_CODES: ReadonlySet<string> = new Set([
  'INVALID_REQUEST',
  'INVALID_ARGS',
  'UNSUPPORTED_CONTENT',
  'UNSUPPORTED_REASONING_EFFORT',
  'REQUEST_EXTENSION',
  CONTEXT_WINDOW_EXCEEDED_CODE,
])

/**
 * Codes that name a condition only the caller can change: a rejected, absent
 * or unusable credential, an exhausted balance, or the caller's own
 * cancellation. Not `malformed`, because the request itself may be correct and
 * calling it malformed would send someone to fix it.
 */
const CALLER_SIDE_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'MISSING_CREDENTIAL',
  INVALID_CREDENTIAL_CODE,
  QUOTA_EXCEEDED_CODE,
  'ABORTED',
])

/**
 * Codes that name a transient condition when the failure carries no status.
 *
 * An adapter may report a failure without a status, and then its code is the
 * only evidence of what happened: a statusless failure is retryable only when
 * its code says the condition passes.
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  EMPTY_RESPONSE_CODE,
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/**
 * Read an adapter failure into the facts the retry classifier decides on
 * (Epic P4-11).
 *
 * Carries only what an LLM call can actually observe. `sideEffecting` is
 * absent because generating a completion commits no external effect, and
 * asserting `false` would claim a guarantee this layer cannot make; `denied`
 * is absent because a policy refusal is raised by the permission gate before
 * an adapter is reached, so it never arrives as an adapter failure. A failure
 * with neither a status nor a code named here is `unclassified`.
 * @param failure - the normalized adapter failure.
 * @returns the facts, with fields absent when the failure did not carry them.
 */
export function llmFailureFacts(failure: LlmFailure): FailureFacts {
  const { code, status } = failure
  const malformed = MALFORMED_CODES.has(code)
  const callerSide = CALLER_SIDE_CODES.has(code)
  const unclassified = status === undefined && !malformed && !callerSide && !TRANSIENT_CODES.has(code)
  return Object.freeze({
    ...status === undefined ? {} : { status },
    ...malformed ? { malformed } : {},
    ...callerSide ? { callerSide } : {},
    ...unclassified ? { unclassified } : {},
  })
}

/**
 * Detach serializable provider facts from a value thrown by an adapter.
 * @param value - arbitrary value thrown during adapter dispatch or iteration.
 * @returns immutable provider-neutral facts suitable for a terminal finish chunk.
 * @internal
 */
export function normalizeLlmFailure(value: unknown): LlmFailure {
  const error = value instanceof Error
    ? value
    : new HarnessError(thrownMessage(value), 'UNKNOWN', { cause: value })
  // Cross-package copies preserve own data but not class identity. Trust the
  // carried facts only when both own properties agree after validation.
  const carried = ownFailureSnapshot(error)
  if (carried !== undefined && carried.code === ownErrorCode(error)) return carried
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error),
  })
}

/** Render a non-Error throw without letting hostile coercion escape normalization. */
function thrownMessage(value: unknown): string {
  try {
    const message = String(value)
    return message.length > 0 ? message : 'LLM adapter failed'
  } catch (_hostileThrownValue) {
    return 'LLM adapter failed'
  }
}

/** Read a foreign error's own data-backed `code` without invoking accessors. */
function ownErrorCode(error: Error): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Snapshot an own data property without invoking an SDK-defined accessor. */
function ownFailureSnapshot(error: Error): LlmFailure | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'failure')
    return descriptor !== undefined && 'value' in descriptor
      ? failureSnapshot(descriptor.value)
      : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Validate and detach an arbitrary serializable failure payload. */
function failureSnapshot(value: unknown): LlmFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const candidate = value as Partial<LlmFailure>
    const message = candidate.message
    const code = candidate.code
    const status = candidate.status
    const providerRetryAfterMs = candidate.providerRetryAfterMs
    const requestId = candidate.requestId
    if (typeof message !== 'string' || message.length === 0
      || typeof code !== 'string' || code.length === 0
      || (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599))
      || (providerRetryAfterMs !== undefined
        && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0))
      || (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0))) return undefined
    return Object.freeze({
      message,
      code,
      ...status === undefined ? {} : { status },
      ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs },
      ...requestId === undefined ? {} : { requestId },
    })
  } catch (_sdkFailureGetter) {
    return undefined
  }
}

/** Read an SDK error message without letting an accessor replace the primary failure. */
function errorMessage(error: Error): string {
  try {
    const message: unknown = error.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch (_sdkMessageGetter) {
    // The fallback below preserves a serializable failure beside the original Error.
  }
  return 'LLM adapter failed'
}

/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
function harnessErrorCode(error: Error): string {
  return error instanceof HarnessError ? error.code : 'UNKNOWN'
}
