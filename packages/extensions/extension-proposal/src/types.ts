export type ProposalStatus = 'drafted' | 'scanned' | 'tested' | 'signed' | 'approved' | 'rejected' | 'published' | 'rollback'

export interface ExtensionProposal {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly codeDigest: string
  readonly manifestDigest: string
  readonly scanResult?: { passed: boolean; findings: number }
  readonly testResult?: { passed: boolean; coverage: number }
  readonly signature?: string
  readonly approver?: string
  readonly status: ProposalStatus
  readonly submittedBy: string
  readonly submittedAt: number
  readonly canaryDeployed?: boolean
  readonly rejectionReason?: string
}

export interface PipelineStage {
  readonly name: string
  readonly status: 'pending' | 'in-progress' | 'passed' | 'failed'
  readonly result?: Record<string, unknown>
}
