/**
 * Agent Lifecycle State Machine.
 *
 * States: queued, starting, running, waiting_tool, waiting_human, paused,
 * cancelling, failed, completed, orphaned.
 *
 * @module @deepseek-ai/dsh-agent/state-machine
 */

export type AgentState =
  | 'queued' | 'starting' | 'running' | 'waiting_tool' | 'waiting_human'
  | 'paused' | 'cancelling' | 'failed' | 'completed' | 'orphaned'

export interface StateTransition {
  readonly from: AgentState
  readonly to: AgentState
  readonly reason: string
  readonly runId: string
  readonly leaseEpoch: number
  readonly timestamp: string
}

const ALLOWED: Record<AgentState, AgentState[]> = {
  queued: ['starting', 'cancelling', 'failed'],
  starting: ['running', 'failed', 'cancelling'],
  running: ['waiting_tool', 'waiting_human', 'paused', 'cancelling', 'completed', 'failed', 'orphaned'],
  waiting_tool: ['running', 'paused', 'cancelling', 'failed', 'orphaned'],
  waiting_human: ['running', 'paused', 'cancelling', 'failed', 'orphaned'],
  paused: ['running', 'cancelling', 'orphaned'],
  cancelling: ['completed', 'failed'],
  failed: [],
  completed: [],
  orphaned: ['starting', 'cancelling'],
}

export class InvalidAgentTransitionError extends Error {
  constructor(from: AgentState, to: AgentState) {
    super(`Invalid agent state transition: ${from} -> ${to}`)
    this.name = 'InvalidAgentTransitionError'
  }
}

export function canTransition(from: AgentState, to: AgentState): boolean {
  // eslint-disable-next-line no-unnecessary-condition
  return ALLOWED[from]?.includes(to) ?? false
}

export function assertTransition(from: AgentState, to: AgentState): void {
  if (!canTransition(from, to)) {
    throw new InvalidAgentTransitionError(from, to)
  }
}

export function createTransition(from: AgentState, to: AgentState, reason: string, runId: string, leaseEpoch: number): StateTransition {
  assertTransition(from, to)
  return { from, to, reason, runId, leaseEpoch, timestamp: new Date().toISOString() }
}

export function isTerminal(state: AgentState): boolean {
  return state === 'completed' || state === 'failed'
}

export function isActive(state: AgentState): boolean {
  return !isTerminal(state) && state !== 'orphaned'
}

export function isWaiting(state: AgentState): boolean {
  return state === 'waiting_tool' || state === 'waiting_human'
}
