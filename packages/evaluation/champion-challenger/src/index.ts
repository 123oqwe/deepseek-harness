import type { EvalResult } from '../../eval/src/types.ts'

export interface ChallengerComparison {
  readonly championId: string
  readonly challengerId: string
  readonly championMetrics: EvalResult['metrics']
  readonly challengerMetrics: EvalResult['metrics']
  readonly successRateDelta: number
  readonly costDelta: number
  readonly challengerBetter: boolean
  readonly autoRollbackTriggered: boolean
}

const NON_AUTO_EVOLVABLE = [
  'trust-kernel',
  'tenant-boundary',
  'audit-integrity',
  'root-signing-keys',
  'irreversible-approval-policy',
]

export class ChampionChallenger {
  private championId: string
  private results = new Map<string, EvalResult>()

  constructor(championId: string) {
    this.championId = championId
  }

  registerResult(result: EvalResult): void {
    this.results.set(result.candidateId, result)
  }

  compare(challengerId: string, canaryThreshold = { maxSuccessRateDegradation: 0.05 }): ChallengerComparison {
    const champion = this.results.get(this.championId)
    const challenger = this.results.get(challengerId)
    if (!champion || !challenger) {
      throw new Error('Missing champion or challenger results')
    }
    const successDelta = challenger.metrics.verifiedTaskSuccess - champion.metrics.verifiedTaskSuccess
    const costDelta = challenger.metrics.cost - champion.metrics.cost
    const autoRollback = successDelta < -canaryThreshold.maxSuccessRateDegradation
    return {
      championId: this.championId,
      challengerId,
      championMetrics: champion.metrics,
      challengerMetrics: challenger.metrics,
      successRateDelta: successDelta,
      costDelta,
      challengerBetter: successDelta > 0 && costDelta <= 0,
      autoRollbackTriggered: autoRollback,
    }
  }

  static isNonAutoEvolvable(component: string): boolean {
    return NON_AUTO_EVOLVABLE.includes(component)
  }

  getChampionId(): string {
    return this.championId
  }
}
