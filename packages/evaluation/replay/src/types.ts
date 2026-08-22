export interface ReplayBundle {
  readonly bundleId: string
  readonly schemaFingerprint: string
  readonly runPlan: unknown
  readonly events: readonly unknown[]
  readonly modelStreams: readonly unknown[]
  readonly externalObservations: ReadonlyMap<string, unknown>
  readonly policyInputs: readonly unknown[]
  readonly clockSeed: number
  readonly randomSeed: number
  readonly artifactRefs: readonly string[]
}

export interface DecisionDiff {
  readonly stepId: string
  readonly original: unknown
  readonly replayed: unknown
  readonly matched: boolean
}

export interface ReplayResult {
  readonly bundleId: string
  readonly normalizedProjection: readonly unknown[]
  readonly policyDecisions: readonly unknown[]
  readonly outcome: unknown
  readonly diffs: readonly DecisionDiff[]
  readonly allMatched: boolean
}
