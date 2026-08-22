import type { EvalConfig, EvalResult, EvalMetrics } from '@deepseek-ai/dsh-eval'
import { randomUUID } from 'node:crypto'

export class EvalRunner {
  async run(
    candidateId: string,
    _config: EvalConfig,
    metricsFn: () => Promise<EvalMetrics>,
  ): Promise<EvalResult> {
    const metrics = await metricsFn()
    return {
      evalId: `eval-${randomUUID().slice(0, 12)}`,
      candidateId,
      metrics,
      replayable: true,
      auditable: true,
    }
  }
}
