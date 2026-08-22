export interface OutcomePackage {
  readonly runId: string
  readonly finalAnswer: string | undefined
  readonly artifacts: readonly string[]
  readonly stateDiffs: readonly { actionId: string; before: unknown; after: unknown }[]
  readonly actionTrace: readonly string[]
  readonly policyDecisions: readonly { policyId: string; decision: string }[]
  readonly verificationReport: { summary: string; results: readonly { checkId: string; status: string }[] }
  readonly costs: { tokens: number; durationMs: number }
  readonly failures: readonly string[]
  readonly compensations: readonly { actionId: string; success: boolean }[]
  readonly memoryProposals: readonly { key: string; value: string }[]
  readonly contentDigest: string
  readonly signature: string
}
