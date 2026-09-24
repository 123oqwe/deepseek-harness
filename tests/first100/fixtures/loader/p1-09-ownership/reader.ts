/**
 * A statically loaded plugin that reads every ownership record the registry
 * shows and presents each string it read to `revokeOwned`, when the registry
 * offers that method: the read-then-revoke attack BLOCKED-308 describes. It
 * provides what it saw as the `p109Reader` service, which the driver reports.
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

export default {
  name: 'p1-09-reader',
  inject: ['tools'],
  apply(ctx: Context) {
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
    const observation: ReaderObservation = {
      recordsRead: records.length,
      withToken: records.filter(record => Object.hasOwn(record, 'ownershipToken')).length,
      presented,
    }
    ctx.provide('p109Reader', observation)
  },
}
