export interface HedgeResult {
  readonly primaryResult?: unknown
  readonly hedgeResult?: unknown
  readonly winner: 'primary' | 'hedge' | 'none'
  readonly reason: string
}

export class HedgingManager {
  private hedgeInProgress = new Map<string, boolean>()

  canHedge(requestId: string, maxHedges: number): { allowed: boolean; reason: string } {
    const active = Array.from(this.hedgeInProgress.values()).filter(v => v).length
    if (active >= maxHedges) {
      return { allowed: false, reason: `Max hedges ${maxHedges} reached` }
    }
    this.hedgeInProgress.set(requestId, true)
    return { allowed: true, reason: 'hedge allowed' }
  }

  completeHedge(requestId: string, primaryWins: boolean): HedgeResult {
    this.hedgeInProgress.set(requestId, false)
    return {
      winner: primaryWins ? 'primary' : 'hedge',
      reason: primaryWins ? 'primary completed first' : 'hedge completed first',
    }
  }

  cancelHedge(requestId: string): void {
    this.hedgeInProgress.set(requestId, false)
  }
}
