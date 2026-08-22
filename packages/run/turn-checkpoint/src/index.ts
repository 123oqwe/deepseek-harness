import type { TurnCheckpoint, CheckpointBoundary, ResumeDecision } from './types.ts'
import { randomUUID } from 'node:crypto'

export type { TurnCheckpoint, CheckpointBoundary, ResumeDecision } from './types.ts'

export class TurnCheckpointManager {
  private checkpoints: TurnCheckpoint[] = []

  checkpoint(runId: string, boundary: CheckpointBoundary, userMessage: string, actionLedgerState: string): TurnCheckpoint {
    const cp: TurnCheckpoint = {
      checkpointId: `cp-${randomUUID().slice(0, 12)}`,
      runId, boundary, timestamp: Date.now(),
      userMessage, actionLedgerState, canResume: true,
    }
    this.checkpoints.push(cp)
    return cp
  }

  getLastCheckpoint(runId: string): TurnCheckpoint | undefined {
    return [...this.checkpoints].reverse().find(cp => cp.runId === runId)
  }

  getCheckpoints(runId: string): readonly TurnCheckpoint[] {
    return this.checkpoints.filter(cp => cp.runId === runId)
  }

  determineResume(runId: string, actionLedgerState: string): ResumeDecision {
    const last = this.getLastCheckpoint(runId)
    if (!last) {
      return { action: 'continue', fromCheckpointId: '', reason: 'No checkpoint found, starting fresh' }
    }
    if (last.actionLedgerState === actionLedgerState) {
      return { action: 'continue', fromCheckpointId: last.checkpointId, reason: 'State matches, can continue' }
    }
    if (last.boundary === 'tool_call' || last.boundary === 'tool_result') {
      return { action: 'replay', fromCheckpointId: last.checkpointId, reason: 'State mismatch at tool boundary, replay pure steps' }
    }
    return { action: 'reconcile', fromCheckpointId: last.checkpointId, reason: 'State mismatch, reconciliation needed' }
  }

  clear(): void {
    this.checkpoints = []
  }
}
