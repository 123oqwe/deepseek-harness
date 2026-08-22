import type { RetryBudgetSpec, RetryAttempt, RetryDecision } from './types.ts'

/** Tracks retry consumption against a shared Run budget. */
export class RetryBudget {
  private totalRetries = 0
  private readonly perActionAttempts = new Map<string, number>()
  private readonly history: RetryAttempt[] = []

  constructor(private readonly spec: RetryBudgetSpec) {}

  /** Check if a retry is allowed for the given action. */
  canRetry(actionId: string, attempt: number): { decision: RetryDecision; delayMs: number; reason: string } {
    if (this.totalRetries >= this.spec.maxTotalRetries) {
      return { decision: 'budget-exhausted', delayMs: 0, reason: `Total retries ${this.totalRetries} >= budget ${this.spec.maxTotalRetries}` }
    }

    const currentAttempts = this.perActionAttempts.get(actionId) ?? 0
    if (currentAttempts >= this.spec.maxAttempts) {
      return { decision: 'budget-exhausted', delayMs: 0, reason: `Action attempts ${currentAttempts} >= max ${this.spec.maxAttempts}` }
    }

    const delayMs = this.computeDelay(attempt)
    return { decision: 'retry', delayMs, reason: `retry attempt ${attempt + 1}` }
  }

  /** Record a retry attempt. */
  recordRetry(actionId: string, attempt: number, delayMs: number, error?: import('./types.ts').ErrorClassification): void {
    this.totalRetries++
    this.perActionAttempts.set(actionId, (this.perActionAttempts.get(actionId) ?? 0) + 1)
    this.history.push({ attempt, delayMs, error })
  }

  /** Compute exponential backoff with jitter. */
  private computeDelay(attempt: number): number {
    const exponential = this.spec.baseDelayMs * Math.pow(2, attempt)
    const capped = Math.min(exponential, this.spec.maxDelayMs)
    const jitter = capped * this.spec.jitterRatio * (Math.random() * 2 - 1)
    return Math.max(0, Math.round(capped + jitter))
  }

  /** Get total retries consumed. */
  get totalRetriesConsumed(): number { return this.totalRetries }

  /** Get retry history. */
  getHistory(): readonly RetryAttempt[] { return this.history }
}

/** Default budget spec. */
export const DEFAULT_BUDGET: RetryBudgetSpec = {
  maxAttempts: 5,
  maxTotalRetries: 20,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  jitterRatio: 0.25,
}
