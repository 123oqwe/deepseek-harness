import type { AgentContextTopology } from '@deepseek-ai/dsh-contexttopology'

export interface TelemetryEntry {
  readonly sourceId: string
  readonly sourceType: string
  readonly tokenCount: number
  readonly selectionReason: string
  readonly redactedPreview: string
}

export interface ContextTelemetry {
  readonly agentId: string
  readonly entries: readonly TelemetryEntry[]
  readonly totalTokens: number
}

function redactPreview(content: string, maxLength = 80): string {
  const trimmed = content.slice(0, maxLength)
  return trimmed.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
    .replace(/[\w.+-]+@[\w.-]+\w{2,}/gi, '[REDACTED-EMAIL]')
    .replace(/(password|secret|token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

export function buildTelemetry(topology: AgentContextTopology): ContextTelemetry {
  const allSources = [...topology.zones.shared, ...topology.zones.private, ...topology.zones.retrievable]
  const entries: TelemetryEntry[] = allSources.map(source => ({
    sourceId: source.id,
    sourceType: source.type,
    tokenCount: estimateTokens(source.content),
    selectionReason: source.zone === 'shared' ? 'inherited from parent' : source.zone === 'private' ? 'agent private' : 'retrieved on demand',
    redactedPreview: redactPreview(source.content),
  }))

  const totalTokens = entries.reduce((sum, e) => sum + e.tokenCount, 0)
  return { agentId: topology.agentId, entries, totalTokens }
}

export function isTelemetrySafe(telemetry: ContextTelemetry): { safe: boolean; leaks: string[] } {
  const leaks: string[] = []
  for (const entry of telemetry.entries) {
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(entry.redactedPreview)) {
      leaks.push(`SSN leaked in ${entry.sourceId}`)
    }
    if (/(password|secret|token)\s*[=:]\s*[^[]/.test(entry.redactedPreview)) {
      leaks.push(`Secret leaked in ${entry.sourceId}`)
    }
  }
  return { safe: leaks.length === 0, leaks }
}
