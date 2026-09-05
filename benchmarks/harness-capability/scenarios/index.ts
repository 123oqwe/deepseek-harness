/**
 * The scenario set the benchmark runs (Epic P0-08).
 * @module benchmarks/harness-capability/scenarios
 */

import type { Scenario } from '../runner.ts'
import { codeWorld } from './code-world.ts'
import { crashWorld } from './crash-world.ts'
import { externalWriteWorld } from './external-write-world.ts'
import { researchWorld } from './research-world.ts'

/** Every scenario, across the lanes that need no external model. */
export const SCENARIOS: readonly Scenario[] = [codeWorld, researchWorld, externalWriteWorld, crashWorld]
