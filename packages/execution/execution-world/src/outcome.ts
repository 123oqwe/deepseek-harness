import type { ExecutionOutcome } from './errors.ts'

export interface OutcomePackage {
  readonly outcome: ExecutionOutcome
  readonly rawOutput: string
  readonly controlStatus: string
  readonly separated: boolean
}

export function packageOutcome(outcome: ExecutionOutcome, rawOutput: string, controlStatus: string): OutcomePackage {
  return {
    outcome,
    rawOutput,
    controlStatus,
    separated: true,
  }
}

export function getOutcomeFromPackage(pkg: OutcomePackage): ExecutionOutcome {
  return pkg.outcome
}

export function getRawOutputFromPackage(pkg: OutcomePackage): string {
  return pkg.rawOutput
}
