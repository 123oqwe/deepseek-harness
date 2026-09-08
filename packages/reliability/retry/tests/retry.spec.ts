/**
 * Epic P4-11's Contract stage: the retry decisions, as decisions.
 *
 * Every case is a pure call, which is the stage and also its limit, stated
 * plainly. These prove the taxonomy DECIDES correctly, not that any layer
 * consults it. must[1]'s "all layers consume the same budget" is a statement
 * about callers and closes at the Usage stage; a budget type nothing consumes
 * satisfies the noun and not the clause.
 *
 * Two things deliberately absent, because the tree already has them and a
 * second spelling is the defect this epic exists to end: there is no backoff
 * case (`@deepseek-ai/dsh-llm-retry` computes it, with symmetric jitter kept
 * as-is per §12.64) and no `Retry-After` case (`providerRetryAfterMs` parses it
 * at the provider boundary and it rides on `LlmError`).
 */
import { describe, expect, it } from 'vitest'
import { classifyFailure, spendsRetryBudget } from '@deepseek-ai/dsh-retry/src/classify.ts'
import { admitRetry, NO_RETRIES_USED } from '@deepseek-ai/dsh-retry/src/budget.ts'
import type { RunRetryBudget } from '@deepseek-ai/dsh-retry/src/budget.ts'

describe('P4-11 acceptance[0]: a permanent failure is not retried', () => {
  it('refuses a 4xx, a policy denial and a malformed request, naming a DIFFERENT reason for each', () => {
    // Named separately because each demands a different next move: fix the
    // arguments, obtain an authorization decision, or stop asking. One
    // `permanent` would make three situations read as one to an operator.
    expect(classifyFailure({ status: 404 })).toEqual({ retryable: false, reason: 'client-error' })
    expect(classifyFailure({ denied: true })).toEqual({ retryable: false, reason: 'policy-denied' })
    expect(classifyFailure({ malformed: true })).toEqual({ retryable: false, reason: 'invalid-input' })
  })

  it('RETRIES 408 and 429, so "4xx" is not read as "never"', () => {
    // The positive control the refusals need. Without it the case above passes
    // against a classifier that refuses every 4xx, stranding every
    // rate-limited request the provider explicitly invited back.
    expect(classifyFailure({ status: 408 })).toEqual({ retryable: true })
    expect(classifyFailure({ status: 429 })).toEqual({ retryable: true })
    expect(classifyFailure({ status: 503 })).toEqual({ retryable: true })
  })
})

describe('P4-11 must[3]: a side effect is retryable only under the ledger\'s guarantee', () => {
  it('REFUSES `sent`, which is the state must[3] exists for', () => {
    // The request left the harness and no receipt came back. Retrying may
    // commit the effect twice, and the transport status says nothing about it.
    expect(classifyFailure({ status: 503, sideEffecting: true, ledger: 'sent' })).toEqual({
      retryable: false,
      reason: 'effect-unsettled',
    })
  })

  it('REFUSES `confirmed` and `ambiguous` too, for opposite reasons', () => {
    // `confirmed`: the effect already committed, so another attempt is a
    // duplicate. `ambiguous`: retrying is precisely what cannot resolve it —
    // it goes to reconciliation, which is P4-12 acceptance[1].
    expect(classifyFailure({ status: 503, sideEffecting: true, ledger: 'confirmed' })).toEqual({
      retryable: false,
      reason: 'effect-unsettled',
    })
    expect(classifyFailure({ status: 503, sideEffecting: true, ledger: 'ambiguous' })).toEqual({
      retryable: false,
      reason: 'effect-unsettled',
    })
  })

  it('REFUSES a side-effecting attempt with NO ledger verdict, because absence is not a guarantee', () => {
    // The trap this is written against: reading "no ledger consulted" as
    // "nothing to worry about" would make must[3] hold only where P4-12 is
    // mounted, and silently not hold everywhere else.
    expect(classifyFailure({ status: 503, sideEffecting: true })).toEqual({
      retryable: false,
      reason: 'effect-unsettled',
    })
  })

  it('ADMITS `prepared` and `compensated`, the two states that ARE safe', () => {
    // Opposite reasons, and the positive control for the whole clause:
    // `prepared` means the request never left, so nothing can be duplicated;
    // `compensated` means the effect happened and was undone, so the key is
    // settled rather than free. Without this, the refusals above would pass
    // against a classifier that refused every side-effecting attempt forever.
    expect(classifyFailure({ status: 503, sideEffecting: true, ledger: 'prepared' })).toEqual({ retryable: true })
    expect(classifyFailure({ status: 503, sideEffecting: true, ledger: 'compensated' })).toEqual({ retryable: true })
  })

  it('leaves a NON side-effecting failure alone, so the ledger gate is scoped to effects', () => {
    expect(classifyFailure({ status: 503 })).toEqual({ retryable: true })
    expect(classifyFailure({ status: 503, ledger: 'sent' })).toEqual({ retryable: true })
  })
})

describe('P4-11 must[2]: a hedged attempt does not spend a retry (the rule half, §12.46-B)', () => {
  it('charges a retry but NOT a hedge', () => {
    // Hedging races a second attempt against one still in flight, so the pair
    // is one logical attempt made twice. Charging both would make hedging cost
    // double and exhaust a budget at half the failures.
    expect(spendsRetryBudget({ status: 503 })).toBe(true)
    expect(spendsRetryBudget({ status: 503, hedged: true })).toBe(false)
  })

  it('does not confuse "hedged" with "retryable"', () => {
    // Orthogonal: a hedged attempt of a permanently failed call is still not
    // retryable, and a hedge of a retryable one still spends nothing. Folding
    // the two would make hedging a way to bypass acceptance[0].
    expect(classifyFailure({ status: 404, hedged: true })).toEqual({ retryable: false, reason: 'client-error' })
    expect(spendsRetryBudget({ status: 404, hedged: true })).toBe(false)
  })
})

describe('P4-11 acceptance[1]: one run budget, however many layers spend it', () => {
  const budget: RunRetryBudget = { maxRetries: 3 }

  it('counts retries from DIFFERENT layers against the same total', () => {
    // The registry's problem statement: several layers each holding their own
    // limit multiplied. Threading one usage value through is what makes two
    // spenders share one total by construction rather than by agreement.
    const first = admitRetry(NO_RETRIES_USED, budget, 0)
    const afterLlm = first.admitted ? first.next : NO_RETRIES_USED
    const second = admitRetry(afterLlm, budget, 0)
    const afterMcp = second.admitted ? second.next : afterLlm
    const third = admitRetry(afterMcp, budget, 0)
    const afterSubagent = third.admitted ? third.next : afterMcp

    expect(afterSubagent.retriesUsed).toBe(3)
    // The fourth is refused no matter which layer asks.
    expect(admitRetry(afterSubagent, budget, 0)).toEqual({ admitted: false, reason: 'retry-cap-reached' })
  })

  it('returns NO usage on refusal, so a refused attempt cannot be recorded as a spent one', () => {
    const decision = admitRetry({ retriesUsed: 3, delayMsUsed: 0 }, budget, 0)
    expect(decision.admitted).toBe(false)
    expect('next' in decision).toBe(false)
  })

  it('charges the delay ON ADMISSION, so a run cannot begin a wait it cannot finish', () => {
    const timed: RunRetryBudget = { maxRetries: 10, maxDelayBudgetMs: 1_000 }
    const first = admitRetry(NO_RETRIES_USED, timed, 800)
    expect(first).toEqual({ admitted: true, next: { retriesUsed: 1, delayMsUsed: 800 } })
    const used = first.admitted ? first.next : NO_RETRIES_USED
    expect(admitRetry(used, timed, 800)).toEqual({ admitted: false, reason: 'delay-budget-exhausted' })
  })

  it('forbids retrying at all at maxRetries 0, rather than treating 0 as unlimited', () => {
    // The off-by-one an operator would be hurt by: a deployment that sets 0 to
    // mean "never retry" must not get "retry forever".
    expect(admitRetry(NO_RETRIES_USED, { maxRetries: 0 }, 0)).toEqual({
      admitted: false,
      reason: 'retry-cap-reached',
    })
  })
})
