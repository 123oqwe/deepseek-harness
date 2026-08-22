export interface TokenBudget {
  readonly maxTokens: number
  readonly usedTokens: number
  readonly remaining: number
}

export function createBudget(maxTokens: number): TokenBudget {
  return { maxTokens, usedTokens: 0, remaining: maxTokens }
}

export function consume(budget: TokenBudget, tokens: number): TokenBudget {
  const used = budget.usedTokens + tokens
  return { maxTokens: budget.maxTokens, usedTokens: used, remaining: Math.max(0, budget.maxTokens - used) }
}
