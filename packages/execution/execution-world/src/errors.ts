export type ExecutionOutcome =
  | { type: 'success'; result: unknown }
  | { type: 'policy_denied'; capability: string; reason: string }
  | { type: 'sandbox_unavailable'; reason: string }
  | { type: 'resource_exhausted'; resource: string; limit: number; current: number }
  | { type: 'timeout'; timeoutMs: number; elapsedMs: number }
  | { type: 'cancelled'; reason: string }
  | { type: 'tool_failed'; tool: string; error: string }
  | { type: 'world_lost'; worldId: string; reason: string }

export function isSuccess(outcome: ExecutionOutcome): boolean {
  return outcome.type === 'success'
}

export function isDenied(outcome: ExecutionOutcome): boolean {
  return outcome.type === 'policy_denied'
}

export function isRetryable(outcome: ExecutionOutcome): boolean {
  return outcome.type === 'timeout' || outcome.type === 'sandbox_unavailable'
}

export function isTerminal(outcome: ExecutionOutcome): boolean {
  return outcome.type === 'success' || outcome.type === 'policy_denied' || outcome.type === 'cancelled'
}

export function formatOutcome(outcome: ExecutionOutcome): string {
  switch (outcome.type) {
    case 'success': return `success`
    case 'policy_denied': return `policy_denied: ${outcome.capability} - ${outcome.reason}`
    case 'sandbox_unavailable': return `sandbox_unavailable: ${outcome.reason}`
    case 'resource_exhausted': return `resource_exhausted: ${outcome.resource} (limit: ${outcome.limit}, current: ${outcome.current})`
    case 'timeout': return `timeout after ${outcome.elapsedMs}ms (limit: ${outcome.timeoutMs}ms)`
    case 'cancelled': return `cancelled: ${outcome.reason}`
    case 'tool_failed': return `tool_failed: ${outcome.tool} - ${outcome.error}`
    case 'world_lost': return `world_lost: ${outcome.worldId} - ${outcome.reason}`
  }
}
