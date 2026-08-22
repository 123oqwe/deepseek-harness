import type { ErrorClassification } from './types.ts'

/** Classify an error into a taxonomy category with retryability. */
export function classifyError(error: { status?: number; message?: string; code?: string }): ErrorClassification {
  const status = error.status
  const message = error.message ?? ''
  const code = error.code ?? ''

  // Policy denial — never retryable
  if (status === 403 || message.includes('policy') || message.includes('denied')) {
    return { category: 'policy-denied', retryable: false, reason: 'Policy denied' }
  }

  // Invalid input — never retryable
  if (status === 400 || status === 422) {
    return { category: 'invalid-input', retryable: false, reason: 'Invalid input' }
  }

  // Permanent client errors (4xx except 408, 429)
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return { category: 'permanent', retryable: false, reason: `Permanent ${status}` }
  }

  // Rate limited — retryable with delay
  if (status === 429) {
    return { category: 'rate-limited', retryable: true, reason: 'Rate limited', retryAfterMs: 1000 }
  }

  // Timeout — retryable
  if (status === 408 || code === 'ETIMEDOUT' || message.includes('timeout')) {
    return { category: 'timeout', retryable: true, reason: 'Timeout' }
  }

  // Server errors — retryable
  if (status !== undefined && status >= 500) {
    return { category: 'server-error', retryable: true, reason: `Server ${status}` }
  }

  // Network errors — retryable
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'EAI_AGAIN') {
    return { category: 'network-error', retryable: true, reason: `Network ${code}` }
  }

  // Ambiguous — don't retry by default (side effects may have occurred)
  if (message.includes('ambiguous') || code === 'ECONNABORTED') {
    return { category: 'ambiguous', retryable: false, reason: 'Ambiguous completion' }
  }

  // Default to transient if unknown
  return { category: 'transient', retryable: true, reason: 'Unknown transient error' }
}

/** Check if an action with side effects is retryable (requires idempotency). */
export function isSideEffectRetryable(
  classification: ErrorClassification,
  hasIdempotencyKey: boolean,
): boolean {
  if (!classification.retryable) return false
  if (classification.category === 'ambiguous' && !hasIdempotencyKey) return false
  return hasIdempotencyKey
}
