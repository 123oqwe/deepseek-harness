export interface CompactionResult {
  readonly originalTokens: number
  readonly compactedTokens: number
  readonly ratio: number
  readonly droppedItems: readonly string[]
  readonly preservedItems: readonly string[]
  readonly fidelityScore: number
}

export function compact(
  items: { id: string; tokens: number; importance: number }[],
  maxTokens: number,
): CompactionResult {
  const sorted = [...items].sort((a, b) => b.importance - a.importance)
  const preserved: string[] = []
  const dropped: string[] = []
  let compactedTokens = 0
  let totalTokens = 0

  for (const item of items) totalTokens += item.tokens

  for (const item of sorted) {
    if (compactedTokens + item.tokens <= maxTokens) {
      preserved.push(item.id)
      compactedTokens += item.tokens
    } else {
      dropped.push(item.id)
    }
  }

  const ratio = totalTokens > 0 ? compactedTokens / totalTokens : 0
  const fidelityScore = items.length > 0 ? preserved.length / items.length : 0

  return { originalTokens: totalTokens, compactedTokens, ratio, droppedItems: dropped, preservedItems: preserved, fidelityScore }
}
