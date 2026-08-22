export type ExecutionWorldKind = 'local' | 'container' | 'remote'
export type PluginTrustLevel = 'L0-unknown' | 'L1-inspected' | 'L2-signed' | 'L3-verified' | 'L4-production' | 'L5-kernel-trusted'

export interface FsPolicy {
  readonly readable: readonly string[]
  readonly writable: readonly string[]
}

export interface NetworkPolicy {
  readonly allowed: readonly string[]
  readonly egressProxy: boolean
}

export interface ProcessPolicy {
  readonly allowed: boolean
  readonly maxProcesses: number
}

export interface SecretsPolicy {
  readonly brokerRequired: boolean
  readonly redactInLogs: boolean
}

export interface RiskThresholds {
  readonly maxRiskLevel: 'read' | 'local-reversible' | 'internal-write' | 'external-communication' | 'destructive' | 'financial' | 'security-sensitive' | 'safety-critical'
}

export interface ApprovalRules {
  readonly autoApprove: readonly string[]
  readonly requireApproval: readonly string[]
  readonly neverAllow: readonly string[]
}

export interface PluginTrust {
  readonly minLevel: PluginTrustLevel
}

export interface BudgetSpec {
  readonly maxTokens: number
  readonly maxCost: number
  readonly maxTimeMs: number
  readonly maxAgents: number
}

export interface RetentionPolicy {
  readonly sessionLogsDays: number
  readonly artifactsDays: number
  readonly auditIndefinite: boolean
}

export interface PolicyProfile {
  readonly name: string
  readonly description: string
  readonly executionWorld: ExecutionWorldKind
  readonly fs: FsPolicy
  readonly network: NetworkPolicy
  readonly process: ProcessPolicy
  readonly secrets: SecretsPolicy
  readonly riskThresholds: RiskThresholds
  readonly approvalRules: ApprovalRules
  readonly pluginTrust: PluginTrust
  readonly budget: BudgetSpec
  readonly retention: RetentionPolicy
  readonly kernelHardDenyDisabled: boolean
}

export const PROFILES: readonly PolicyProfile[] = [
  {
    name: 'observe-only',
    description: 'Read-only, no side effects, no network',
    executionWorld: 'local',
    fs: { readable: ['./**'], writable: [] },
    network: { allowed: [], egressProxy: false },
    process: { allowed: false, maxProcesses: 0 },
    secrets: { brokerRequired: true, redactInLogs: true },
    riskThresholds: { maxRiskLevel: 'read' },
    approvalRules: { autoApprove: ['read'], requireApproval: [], neverAllow: ['write', 'execute', 'network'] },
    pluginTrust: { minLevel: 'L3-verified' },
    budget: { maxTokens: 10000, maxCost: 0.5, maxTimeMs: 60000, maxAgents: 1 },
    retention: { sessionLogsDays: 7, artifactsDays: 7, auditIndefinite: true },
    kernelHardDenyDisabled: false,
  },
  {
    name: 'workspace-safe',
    description: 'Local workspace writes, no network, no external effects',
    executionWorld: 'local',
    fs: { readable: ['./**'], writable: ['./**'] },
    network: { allowed: [], egressProxy: false },
    process: { allowed: true, maxProcesses: 5 },
    secrets: { brokerRequired: true, redactInLogs: true },
    riskThresholds: { maxRiskLevel: 'local-reversible' },
    approvalRules: { autoApprove: ['read', 'local-reversible'], requireApproval: ['internal-write'], neverAllow: ['external-communication', 'destructive', 'financial'] },
    pluginTrust: { minLevel: 'L2-signed' },
    budget: { maxTokens: 50000, maxCost: 2, maxTimeMs: 300000, maxAgents: 3 },
    retention: { sessionLogsDays: 30, artifactsDays: 30, auditIndefinite: true },
    kernelHardDenyDisabled: false,
  },
  {
    name: 'team-standard',
    description: 'Network allowed, external writes with approval, multi-agent',
    executionWorld: 'local',
    fs: { readable: ['./**'], writable: ['./**'] },
    network: { allowed: ['*'], egressProxy: true },
    process: { allowed: true, maxProcesses: 20 },
    secrets: { brokerRequired: true, redactInLogs: true },
    riskThresholds: { maxRiskLevel: 'external-communication' },
    approvalRules: { autoApprove: ['read', 'local-reversible'], requireApproval: ['internal-write', 'external-communication'], neverAllow: ['destructive', 'financial', 'safety-critical'] },
    pluginTrust: { minLevel: 'L3-verified' },
    budget: { maxTokens: 200000, maxCost: 10, maxTimeMs: 1800000, maxAgents: 10 },
    retention: { sessionLogsDays: 90, artifactsDays: 90, auditIndefinite: true },
    kernelHardDenyDisabled: false,
  },
  {
    name: 'production-controlled',
    description: 'Containerized, strict network, all external effects require approval',
    executionWorld: 'container',
    fs: { readable: ['./**'], writable: ['./**'] },
    network: { allowed: ['https://api.internal'], egressProxy: true },
    process: { allowed: true, maxProcesses: 50 },
    secrets: { brokerRequired: true, redactInLogs: true },
    riskThresholds: { maxRiskLevel: 'security-sensitive' },
    approvalRules: { autoApprove: ['read'], requireApproval: ['internal-write', 'external-communication', 'destructive', 'financial'], neverAllow: ['safety-critical'] },
    pluginTrust: { minLevel: 'L4-production' },
    budget: { maxTokens: 1000000, maxCost: 50, maxTimeMs: 86400000, maxAgents: 50 },
    retention: { sessionLogsDays: 365, artifactsDays: 365, auditIndefinite: true },
    kernelHardDenyDisabled: false,
  },
]

export function getProfile(name: string): PolicyProfile | undefined {
  return PROFILES.find(p => p.name === name)
}

export function validateProfile(profile: PolicyProfile): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (profile.kernelHardDenyDisabled) {
    errors.push('kernelHardDenyDisabled must be false')
  }
  if (profile.budget.maxTokens <= 0) errors.push('maxTokens must be positive')
  if (profile.budget.maxAgents <= 0) errors.push('maxAgents must be positive')
  if (profile.pluginTrust.minLevel === 'L0-unknown' || profile.pluginTrust.minLevel === 'L1-inspected') {
    errors.push('Profiles must require at least L2-signed plugins')
  }
  return { valid: errors.length === 0, errors }
}
