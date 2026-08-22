import type { CompensatableAction, StateDiff, RepairOption, ReconciliationResult } from './types.ts'

export class ReconciliationEngine {
  private actions = new Map<string, CompensatableAction>()

  register(action: CompensatableAction): void {
    this.actions.set(action.actionId, action)
  }

  unregister(actionId: string): void {
    this.actions.delete(actionId)
  }

  async reconcile(actionIds: readonly string[]): Promise<ReconciliationResult> {
    const diffs: StateDiff[] = []
    const repairOptions: RepairOption[] = []

    for (const actionId of actionIds) {
      const action = this.actions.get(actionId)
      if (!action) {
        diffs.push({
          actionId,
          expected: null,
          observed: null,
          matched: false,
          description: 'Action not registered',
        })
        repairOptions.push({ actionId, type: 'manual', reason: 'Action not found in engine' })
        continue
      }

      const observeResult = await action.observeState()
      if (!observeResult.reachable) {
        diffs.push({
          actionId,
          expected: action.expected,
          observed: null,
          matched: false,
          description: 'External target unreachable',
        })
        repairOptions.push({ actionId, type: 'retry', reason: 'Target unreachable, retry observation' })
        continue
      }

      const matched = action.compareExpected(observeResult.observedState, action.expected)
      diffs.push({
        actionId,
        expected: action.expected,
        observed: observeResult.observedState,
        matched,
        description: matched ? 'State matches expected' : 'State mismatch detected',
      })

      if (!matched) {
        if (action.reversible) {
          repairOptions.push({ actionId, type: 'compensate', reason: 'State mismatch, reversible action' })
        } else {
          repairOptions.push({ actionId, type: 'manual', reason: 'Irreversible action, requires manual intervention' })
        }
      }
    }

    const manualCount = repairOptions.filter(o => o.type === 'manual').length
    return {
      diffs,
      repairOptions,
      allMatched: diffs.every(d => d.matched),
      manualInterventionCount: manualCount,
    }
  }

  async compensate(actionId: string): Promise<{ success: boolean; reason: string }> {
    const action = this.actions.get(actionId)
    if (!action) {
      return { success: false, reason: 'Action not registered' }
    }
    if (!action.reversible) {
      return { success: false, reason: 'Action is not reversible, requires manual intervention' }
    }
    return action.compensate()
  }

  async compensateAll(actionIds: readonly string[]): Promise<{ results: { actionId: string; success: boolean; reason: string }[] }> {
    const results: { actionId: string; success: boolean; reason: string }[] = []
    for (const actionId of actionIds) {
      const action = this.actions.get(actionId)
      if (!action) {
        results.push({ actionId, success: false, reason: 'Action not registered' })
        continue
      }
      const result = await this.compensate(actionId)
      results.push({ actionId, ...result })
    }
    return { results }
  }

  listActions(): readonly string[] {
    return Array.from(this.actions.keys())
  }

  clear(): void {
    this.actions.clear()
  }
}
