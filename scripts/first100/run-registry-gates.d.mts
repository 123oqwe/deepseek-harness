/**
 * Types for `run-registry-gates.mjs`: the gate runner's memory guard and exit code.
 */

/** How one gate that was due to run ended. */
export type GateOutcome = 'PASS' | 'FAIL' | 'CANNOT_RUN' | 'KILLED' | 'NOT_RUN'

/** One gate's result. */
export interface GateResult {
  gate: string
  outcome: GateOutcome
  /** `exit <n>` for FAIL, the refusal reason for CANNOT_RUN, the signal name for KILLED. */
  detail?: string
}

/**
 * Free memory as a whole percentage of the machine's memory.
 * @returns the percentage, or `undefined` when this platform has neither source or it cannot be read.
 */
export function readFreeMemoryPercent(): number | undefined

/**
 * Whether a gate may start, given one reading of free memory.
 * @param freePercent - free memory as a whole percentage, or `undefined` when it could not be read.
 * @param minFreePercent - the refusal threshold.
 * @returns `{ run: true }`, or `{ run: false, reason }` naming both numbers.
 */
export function memoryVerdict(freePercent: number | undefined, minFreePercent: number): { run: true } | { run: false; reason: string }

/**
 * The gate set's exit code.
 * @param results - one result per gate that was due to run.
 * @returns 1 when any gate failed, otherwise 2 when any gate could not run, was killed or was not run, otherwise 0.
 */
export function gateSetExitCode(results: readonly GateResult[]): 0 | 1 | 2

/**
 * Whether an outcome stops the set rather than being one gate's verdict.
 * @param outcome - the outcome just recorded for a gate.
 * @returns `true` for `CANNOT_RUN` and `KILLED`.
 */
export function stopsTheSet(outcome: GateOutcome): boolean
