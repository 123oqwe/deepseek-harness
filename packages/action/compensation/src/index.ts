

export interface SagaStep {
  readonly stepId: string
  readonly actionId: string
  readonly reversible: boolean
  readonly compensateReason?: string | undefined
}

export interface SagaResult {
  readonly completed: readonly string[]
  readonly compensated: readonly string[]
  readonly failed: readonly string[]
  readonly manualIntervention: readonly string[]
}

export class SagaCoordinator {
  private steps: SagaStep[] = []

  addStep(step: SagaStep): void {
    this.steps.push(step)
  }

  getSteps(): readonly SagaStep[] {
    return this.steps
  }

  async execute(
    executeFn: (step: SagaStep) => Promise<{ success: boolean; reason: string }>,
    compensateFn: (step: SagaStep) => Promise<{ success: boolean; reason: string }>,
  ): Promise<SagaResult> {
    const completed: string[] = []
    const compensated: string[] = []
    const failed: string[] = []
    const manualIntervention: string[] = []

    for (const step of this.steps) {
      const result = await executeFn(step)
      if (result.success) {
        completed.push(step.stepId)
      } else {
        for (let i = completed.length - 1; i >= 0; i--) {
          const prevStep = this.steps[i]
          if (!prevStep) continue
          if (prevStep.reversible) {
            let compResult = await compensateFn(prevStep)
            if (!compResult.success) {
              compResult = await compensateFn(prevStep)
            }
            if (compResult.success) {
              compensated.push(prevStep.stepId)
            } else {
              failed.push(prevStep.stepId)
            }
          } else {
            manualIntervention.push(prevStep.stepId)
          }
        }
        failed.push(step.stepId)
        break
      }
    }

    return { completed, compensated, failed, manualIntervention }
  }

  clear(): void {
    this.steps = []
  }
}
