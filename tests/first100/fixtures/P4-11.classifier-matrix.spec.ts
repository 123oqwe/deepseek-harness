/**
 * P4-11 must[0], one retry taxonomy: for every failure the shipped DeepSeek
 * provider can produce, the circuit breaker's verdict and llm-retry's agree on
 * whether it may be retried.
 *
 * The breaker decides with `classifyFailure` over `llmFailureFacts`
 * (`packages/llm/llm/src/index.ts`, `guardedFirstChunk`); llm-retry decides
 * with `isRetryableLlmFailure` (`packages/llm/llm-retry/src/index.ts`), the
 * function its retry decision calls in both policy modes. The HTTP rows take their code
 * from the provider's own `httpErrorCode`, which its package does not export;
 * the other rows are the codes the provider reports without a status. Pure:
 * no process and no network. A row is red when the two verdicts differ.
 */
import { classifyFailure } from '@deepseek-ai/dsh-retry/classify'
import { llmFailureFacts, resolveRetryPolicy, type LlmFailure } from '@deepseek-ai/dsh-llm'
import { isRetryableLlmFailure } from '@deepseek-ai/dsh-llm-retry'
import { describe, expect, it } from 'vitest'
import { httpErrorCode } from '../../../packages/llm/llm-deepseek/src/adapter.ts'

/** The policy the shipped `llm-retry` row resolves to. */
const SHIPPED_POLICY = resolveRetryPolicy(undefined, 'llm-retry')

/** HTTP rows: label, status, and the provider error message when the row needs one. */
const HTTP_ROWS: readonly (readonly [string, number, string | undefined])[] = [
  ['HTTP 400', 400, undefined],
  ['HTTP 400 naming the context length', 400, 'maximum context length is 65536 tokens'],
  ['HTTP 401', 401, undefined],
  ['HTTP 402 with an insufficient balance', 402, 'Insufficient Balance'],
  ['HTTP 403', 403, undefined],
  ['HTTP 404', 404, undefined],
  ['HTTP 408', 408, undefined],
  ['HTTP 409', 409, undefined],
  ['HTTP 413', 413, undefined],
  ['HTTP 422', 422, undefined],
  ['HTTP 429', 429, undefined],
  ['HTTP 429 with an insufficient balance', 429, 'Insufficient Balance'],
  ['HTTP 500', 500, undefined],
  ['HTTP 502', 502, undefined],
  ['HTTP 503', 503, undefined],
  ['HTTP 504', 504, undefined],
]

/** Codes the provider reports with no status. */
const STATUSLESS_CODES: readonly string[] = [
  'TIMEOUT',
  'TRANSPORT',
  'EMPTY_RESPONSE',
  'INVALID_REQUEST',
  'ABORTED',
  'UNSUPPORTED_CONTENT',
  'REQUEST_EXTENSION',
  'MISSING_CREDENTIAL',
  'UNSUPPORTED_REASONING_EFFORT',
  'UNKNOWN',
]

/** One row of the matrix. */
interface Row {
  readonly label: string
  readonly failure: LlmFailure
}

const ROWS: readonly Row[] = [
  ...HTTP_ROWS.map(([label, status, message]): Row => {
    const code = httpErrorCode(status, message === undefined ? undefined : { message })
    return { label: `${label} (${code})`, failure: { message: message ?? label, code, status } }
  }),
  ...STATUSLESS_CODES.map((code): Row => ({ label: `${code} with no status`, failure: { message: code, code } })),
]

describe('P4-11 must[0]: the circuit breaker and llm-retry classify every shipped provider failure the same way', () => {
  it('control: the shipped llm-retry policy is the bounded one, and llm-retry calls at least one shipped failure retryable', () => {
    expect(SHIPPED_POLICY.mode).toBe('normal')
    expect(ROWS.some(row => isRetryableLlmFailure(row.failure))).toBe(true)
  })

  for (const row of ROWS) {
    it(`${row.label}: classifyFailure and llm-retry's isRetryableLlmFailure give the same verdict`, () => {
      const breaker = classifyFailure(llmFailureFacts(row.failure)).retryable
      const llmRetry = isRetryableLlmFailure(row.failure)
      expect(breaker, `breaker retryable=${String(breaker)}, llm-retry retryable=${String(llmRetry)}: ${JSON.stringify(row.failure)}`).toBe(llmRetry)
    })
  }
})
