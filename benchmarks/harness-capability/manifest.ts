/**
 * The Harness capability benchmark's manifest (`manifest.yml`, Epic P0-08):
 * where the recordings are, how a replay is composed, how long a product run
 * may take, the price table token cost is computed from, and each lane's
 * trials, scenarios and not-applicable metrics.
 * @module benchmarks/harness-capability/manifest
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

/** One model's prices, in the table's currency per million tokens. */
export interface ModelPrice {
  readonly inputCacheHit: number
  readonly inputCacheMiss: number
  readonly output: number
}

/** The price table `token_cost` is computed from. */
export interface PriceTable {
  /** Where the prices were read. */
  readonly source: string
  /** The date they were read, `YYYY-MM-DD`. */
  readonly retrievedAt: string
  readonly currency: string
  /** Which of the source's rates the table holds. */
  readonly rate: string
  /** How a model the source does not name is priced, when the table assumes it. */
  readonly assumption?: string
  readonly models: Readonly<Record<string, ModelPrice>>
}

/** One lane as the manifest declares it. */
export interface ManifestLane {
  readonly name: string
  /** How many trials the lane runs. */
  readonly trials?: number
  /** The recorded scenarios a keyless lane draws its trials from. */
  readonly scenarios?: readonly string[]
  /** Each standard metric the lane cannot compute, with the reason. */
  readonly notApplicable?: Readonly<Record<string, string>>
}

/** The parsed manifest. */
export interface Manifest {
  readonly schemaVersion: number
  /** The recorded headless sessions, relative to the repository root. */
  readonly recordings: string
  /** The directory whose `cordis.yml`, `cordis.snapshot.yml` and `model.cordis.yml` compose a replay, relative to the repository root. */
  readonly composition: string
  /** How long one product run may take before it is killed and judged failed. */
  readonly trialTimeoutMs: number
  readonly pricing: PriceTable
  readonly lanes: readonly ManifestLane[]
}

/**
 * Read the benchmark manifest.
 * @param root - the directory holding `manifest.yml`; this module's own by default.
 * @returns the manifest.
 * @throws when the file does not declare schema version 2.
 */
export function readManifest(root: string = dirname(fileURLToPath(import.meta.url))): Manifest {
  const manifest = yaml.load(readFileSync(join(root, 'manifest.yml'), 'utf8')) as Manifest
  if (manifest.schemaVersion !== 2) throw new Error(`benchmark manifest.yml must declare schemaVersion 2, got ${String(manifest.schemaVersion)}`)
  return manifest
}
