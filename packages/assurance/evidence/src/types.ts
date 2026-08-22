export type EvidenceType = 'test-result' | 'build-log' | 'artifact-digest' | 'command-output' | 'file-hash' | 'runtime-state'

export interface EvidenceItem {
  readonly id: string
  readonly type: EvidenceType
  readonly contentDigest: string
  readonly collectedAt: number
  readonly collectedBy: string
  readonly runId: string
  readonly metadata: Record<string, string>
}

export interface EvidenceBundle {
  readonly id: string
  readonly items: readonly EvidenceItem[]
  readonly bundleDigest: string
  readonly createdAt: number
  readonly runId: string
}
