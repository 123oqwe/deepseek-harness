export interface RoutingDecision {
  readonly chosen: string
  readonly alternatives: readonly string[]
  readonly success: boolean
  readonly timestamp: number
}

export interface RegretScore {
  readonly decision: string
  readonly regret: number
  readonly reason: string
}

export class RouterRegretEvaluator {
  private decisions: RoutingDecision[] = []

  record(decision: RoutingDecision): void {
    this.decisions.push(decision)
  }

  evaluate(): readonly RegretScore[] {
    const byChoice = new Map<string, { total: number; success: number }>()
    const byAlternative = new Map<string, { total: number; success: number }>()

    for (const d of this.decisions) {
      const chosen = byChoice.get(d.chosen) ?? { total: 0, success: 0 }
      byChoice.set(d.chosen, { total: chosen.total + 1, success: chosen.success + (d.success ? 1 : 0) })

      for (const alt of d.alternatives) {
        const a = byAlternative.get(alt) ?? { total: 0, success: 0 }
        byAlternative.set(alt, { total: a.total + 1, success: a.success + (d.success ? 1 : 0) })
      }
    }

    const scores: RegretScore[] = []
    for (const [choice, stats] of byChoice) {
      const successRate = stats.success / stats.total
      const altSuccessRate = Array.from(byAlternative.values())
        .reduce((sum, s) => sum + s.success / s.total, 0) / byAlternative.size
      const regret = Math.max(0, altSuccessRate - successRate)
      scores.push({ decision: choice, regret, reason: `success ${successRate.toFixed(2)} vs alt avg ${altSuccessRate.toFixed(2)}` })
    }
    return scores.sort((a, b) => b.regret - a.regret)
  }

  getDecisionCount(): number {
    return this.decisions.length
  }
}
