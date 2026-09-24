/**
 * Names the P4-05 waiting-state driver and its scripted model share. The
 * model is mounted by the Loader and the driver imports it nowhere, so the
 * adapter reaches the driver through a global property.
 * @module tests/first100/fixtures/loader/p4-05-waiting/shared
 */

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

/** The route the overlay's `main` agent names. */
export const PROVIDER = 'p4-05-waiting-mock'

/** The third-party tool the driver registers and the model calls; it declares no risk domain tags. */
export const THIRD_PARTY_TOOL = 'p4_05_third_party'

/** The global the scripted model publishes its adapter on; the driver counts the requests it received. */
export interface AdapterGlobal {
  __P4_05_WAITING_ADAPTER__?: { readonly requests: readonly GenerateOptions[] }
}
