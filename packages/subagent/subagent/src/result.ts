export type ResultStatus = 'completed' | 'failed' | 'cancelled' | 'partial'

export interface SubagentResult {
  readonly requestId: string
  readonly runId: string
  readonly status: ResultStatus
  readonly output: string
  readonly artifacts: readonly ArtifactRef[]
  readonly evidence: readonly EvidenceRef[]
  readonly metrics: {
    readonly tokensUsed: number
    readonly cost: number
    readonly durationMs: number
    readonly toolCalls: number
  }
  readonly error?: string
  readonly completedAt: number
}

export interface ArtifactRef {
  readonly artifactId: string
  readonly digest: string
  readonly mimeType: string
}

export interface EvidenceRef {
  readonly evidenceId: string
  readonly digest: string
  readonly type: string
}

export function validateResult(result: SubagentResult): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!result.requestId) errors.push('requestId required')
  if (!result.runId) errors.push('runId required')
  if (!result.output && result.status === 'completed') errors.push('output required for completed status')
  if (result.metrics.tokensUsed < 0) errors.push('tokensUsed must be non-negative')
  if (result.metrics.cost < 0) errors.push('cost must be non-negative')
  if (result.completedAt <= 0) errors.push('completedAt must be positive')
  return { valid: errors.length === 0, errors }
}

export function mergeResults(results: readonly SubagentResult[]): { merged: SubagentResult[]; conflicts: string[] } {
  const merged: SubagentResult[] = []
  const conflicts: string[] = []
  const seen = new Set<string>()

  for (const r of results) {
    if (seen.has(r.requestId)) {
      conflicts.push(`Duplicate result for ${r.requestId}`)
      continue
    }
    seen.add(r.requestId)
    merged.push(r)
  }

  return { merged, conflicts }
}
