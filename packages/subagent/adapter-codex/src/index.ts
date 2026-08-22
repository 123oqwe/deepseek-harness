import type { ProviderEvent, MappedEvent, ContinuationToken, ProviderResult } from './types.ts'

export type { ProviderEvent, MappedEvent, ContinuationToken, ProviderResult } from './types.ts'

export function mapEvents(events: readonly ProviderEvent[]): MappedEvent[] {
  const typeMap: Record<string, MappedEvent['type']> = {
    'progress': 'progress',
    'tool_use': 'tool_request',
    'tool_result': 'tool_result',
    'diff': 'diff',
    'usage': 'usage',
    'artifact': 'artifact',
    'error': 'error',
    'completed': 'completed',
    'message': 'progress',
    'thinking': 'progress',
  }
  return events.map((e, i) => ({
    childEventId: `evt-${i + 1}`,
    type: typeMap[e.type] ?? 'progress',
    data: e.data,
    timestamp: e.timestamp,
  }))
}

export function createContinuation(providerId: string, threadId: string, turnId: string, resumeToken: string): ContinuationToken {
  return { providerId, threadId, turnId, resumeToken }
}

export function buildProviderResult(
  answer: string,
  events: readonly MappedEvent[],
  inputTokens: number,
  outputTokens: number,
  artifacts: readonly string[],
  continuation?: ContinuationToken,
): ProviderResult {
  return {
    answer, events,
    usage: { inputTokens, outputTokens },
    artifacts,
    continuation,
  }
}
