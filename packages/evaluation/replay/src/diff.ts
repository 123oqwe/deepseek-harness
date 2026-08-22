import type { DecisionDiff } from './types.ts'

export function computeDiffs(
  original: readonly unknown[],
  replayed: readonly unknown[],
): DecisionDiff[] {
  const diffs: DecisionDiff[] = []
  const maxLen = Math.max(original.length, replayed.length)
  for (let i = 0; i < maxLen; i++) {
    const orig = original[i]
    const repl = replayed[i]
    diffs.push({
      stepId: `step-${i}`,
      original: orig,
      replayed: repl,
      matched: JSON.stringify(orig) === JSON.stringify(repl),
    })
  }
  return diffs
}

export function findFirstDivergence(diffs: readonly DecisionDiff[]): number {
  for (let i = 0; i < diffs.length; i++) {
    if (!diffs[i]?.matched) return i
  }
  return -1
}
