import type { ContextNode } from '@deepseek-ai/dsh-context-graph'
import { consume, type TokenBudget } from './budget.ts'

export { createBudget, consume } from './budget.ts'
export type { TokenBudget } from './budget.ts'

export interface RetrievalPlan {
  readonly includedNodes: readonly ContextNode[]
  readonly excludedNodes: readonly string[]
  readonly totalTokens: number
  readonly budget: TokenBudget
  readonly reason: string
}

export function planRetrieval(
  nodes: readonly ContextNode[],
  budget: TokenBudget,
): RetrievalPlan {
  // Sort by relevance score (descending), then by recency
  const sorted = [...nodes].sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
    return b.timestamp - a.timestamp
  })

  const included: ContextNode[] = []
  const excluded: string[] = []
  let currentBudget = budget

  for (const node of sorted) {
    if (currentBudget.remaining >= node.tokenEstimate) {
      included.push(node)
      currentBudget = consume(currentBudget, node.tokenEstimate)
    } else {
      excluded.push(node.id)
    }
  }

  return {
    includedNodes: included,
    excludedNodes: excluded,
    totalTokens: currentBudget.usedTokens,
    budget: currentBudget,
    reason: `Included ${included.length} nodes, excluded ${excluded.length} due to budget`,
  }
}
