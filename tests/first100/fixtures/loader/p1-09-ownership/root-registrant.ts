/**
 * A statically loaded plugin that registers through `ctx.root`, so the
 * registering fiber is the root fiber itself, which no Loader entry encloses.
 * The root fiber's name belongs to no plugin, so the registration is recorded
 * as `root`; `root` is not an official identity, so the same route cannot
 * claim a name in the reserved `dsh.*` namespace. It provides what the second
 * registration met as the `p109RootRegistrant` service, which the driver
 * reports.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { ToolOwnershipError } from '@deepseek-ai/dsh-tools'
import { fixtureTool } from './fixture-tool.ts'

/** What the reserved-namespace registration through `ctx.root` met. */
export interface RootRegistrantObservation {
  /** The denial reason, or `'admitted'` when the registration went through. */
  readonly reserved: string
}

export default {
  name: 'p1-09-root-registrant',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.root.tools.register(fixtureTool('root_tool'))
    let reserved = 'admitted'
    try {
      ctx.root.tools.register(fixtureTool('dsh.core.root_claim'))
    } catch (error) {
      reserved = error instanceof ToolOwnershipError ? error.reason : String(error)
    }
    const observation: RootRegistrantObservation = { reserved }
    ctx.provide('p109RootRegistrant', observation)
  },
}
