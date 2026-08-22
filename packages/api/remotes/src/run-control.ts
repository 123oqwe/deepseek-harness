import { randomUUID } from 'node:crypto'
import type { CommandRequest, CommandResponse } from '../../../sdk/protocol/src/commands.ts'
import { validateTransition, isIdempotent } from '../../../sdk/protocol/src/commands.ts'

interface RunState {
  readonly runId: string
  readonly state: string
  readonly revision: number
  readonly children: string[]
  readonly cancelledChildren: string[]
}

export class RunControlManager {
  private runs = new Map<string, RunState>()
  private processedCommands = new Map<string, CommandResponse>()
  private forkHistory: { parentId: string; forkId: string; inheritSecrets: boolean }[] = []

  createRun(runId: string): void {
    this.runs.set(runId, { runId, state: 'running', revision: 1, children: [], cancelledChildren: [] })
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId)
  }

  addChild(runId: string, childId: string): void {
    const run = this.runs.get(runId)
    if (run) {
      this.runs.set(runId, { ...run, children: [...run.children, childId] })
    }
  }

  executeCommand(request: CommandRequest): CommandResponse {
    if (isIdempotent(new Set(this.processedCommands.keys()), request.commandId)) {
      const existing = this.processedCommands.get(request.commandId)
      if (existing) return existing
    }

    const run = this.runs.get(request.runId)
    if (!run) {
      const response: CommandResponse = {
        accepted: false, commandId: request.commandId,
        currentState: 'not-found', revision: 0,
        reason: `Run not found: ${request.runId}`,
      }
      this.processedCommands.set(request.commandId, response)
      return response
    }

    if (run.revision !== request.expectedRevision) {
      const response: CommandResponse = {
        accepted: false, commandId: request.commandId,
        currentState: run.state, revision: run.revision,
        reason: `Revision mismatch: expected ${request.expectedRevision}, got ${run.revision}`,
      }
      this.processedCommands.set(request.commandId, response)
      return response
    }

    const transition = validateTransition(run.state, request.command)
    if (!transition.valid) {
      const response: CommandResponse = {
        accepted: false, commandId: request.commandId,
        currentState: run.state, revision: run.revision,
        reason: `Invalid transition: ${run.state} -> ${request.command}`,
      }
      this.processedCommands.set(request.commandId, response)
      return response
    }

    const newRevision = run.revision + 1
    const newState = transition.to

    if (request.command === 'cancel') {
      for (const childId of run.children) {
        const child = this.runs.get(childId)
        if (child && child.state !== 'cancelled' && child.state !== 'completed') {
          this.runs.set(childId, { ...child, state: 'cancelled', revision: child.revision + 1 })
        }
      }
      this.runs.set(request.runId, { ...run, state: newState, revision: newRevision, cancelledChildren: [...run.children] })
    } else if (request.command === 'fork') {
      const forkId = `run-${randomUUID().slice(0, 12)}`
      const inheritSecrets = request.forkOptions?.inheritSecrets ?? false
      this.runs.set(forkId, {
        runId: forkId, state: 'running', revision: 1,
        children: [], cancelledChildren: [],
      })
      this.forkHistory.push({ parentId: request.runId, forkId, inheritSecrets })
      const response: CommandResponse = {
        accepted: true, commandId: request.commandId,
        currentState: 'running', revision: 1,
        reason: `Forked to ${forkId}, secrets inherited: ${inheritSecrets}`,
      }
      this.processedCommands.set(request.commandId, response)
      return response
    } else {
      this.runs.set(request.runId, { ...run, state: newState, revision: newRevision })
    }

    const response: CommandResponse = {
      accepted: true, commandId: request.commandId,
      currentState: newState, revision: newRevision,
      reason: request.reason,
    }
    this.processedCommands.set(request.commandId, response)
    return response
  }

  getForkHistory(): readonly { parentId: string; forkId: string; inheritSecrets: boolean }[] {
    return this.forkHistory
  }

  clear(): void {
    this.runs.clear()
    this.processedCommands.clear()
    this.forkHistory = []
  }
}
