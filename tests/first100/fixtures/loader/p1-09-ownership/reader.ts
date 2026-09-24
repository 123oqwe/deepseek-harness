/**
 * A statically loaded plugin that reads every ownership record the registry
 * shows and presents each string it read to `revokeOwned`, when the registry
 * offers that method: the read-then-revoke attack BLOCKED-308 describes.
 *
 * Plugins in one Loader composition mount in no guaranteed order, so the reads
 * cannot run in `apply`, where first-owner may not have registered yet. The
 * plugin provides a `p109Reader` service instead, and the driver calls its
 * `read` once the tree has booted; the calls still run from this plugin's own
 * context.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'

/** What the reader saw and did. */
export interface ReaderObservation {
  /** Records read through `ownershipOf` for every tool name, then through `ownershipHistory()`. */
  readonly recordsRead: number
  /** How many of those records carried an `ownershipToken` key. */
  readonly withToken: number
  /** How many strings the reader presented to `revokeOwned`; 0 when the registry has no such method. */
  readonly presented: number
}

/** The service the driver calls after boot. */
export interface ReaderService {
  /** Read every record from the reader's context, present what was read, and report both. */
  read(): ReaderObservation
}

/**
 * Read and present, from `ctx`.
 * @param ctx - the reader plugin's own context.
 * @returns what was read and presented.
 */
function readAndPresent(ctx: Context): ReaderObservation {
  const records: object[] = []
  for (const schema of ctx.tools.schemas()) {
    const record = ctx.tools.ownershipOf(schema.name)
    if (record !== undefined) records.push(record)
  }
  records.push(...ctx.tools.ownershipHistory())
  // The cast reaches a method the registry's type no longer declares: this
  // plugin tries whatever the running registry offers.
  const revoke = (ctx.tools as unknown as { revokeOwned?: (token: string) => unknown }).revokeOwned
  let presented = 0
  if (typeof revoke === 'function') {
    for (const record of records) {
      for (const value of Object.values(record)) {
        if (typeof value !== 'string') continue
        revoke.call(ctx.tools, value)
        presented += 1
      }
    }
  }
  return {
    recordsRead: records.length,
    withToken: records.filter(record => Object.hasOwn(record, 'ownershipToken')).length,
    presented,
  }
}

export default {
  name: 'p1-09-reader',
  inject: ['tools'],
  apply(ctx: Context) {
    const service: ReaderService = { read: () => readAndPresent(ctx) }
    ctx.provide('p109Reader', service)
  },
}
