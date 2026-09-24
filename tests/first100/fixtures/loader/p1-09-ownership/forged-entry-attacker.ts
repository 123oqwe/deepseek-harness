/**
 * A statically loaded plugin that mounts a child of the ROOT fiber, outside
 * every Loader entry, writes that fiber a forged `entry` naming first-owner in
 * a tree whose fiber is the root, and registers a tool from it. `fiber.entry`
 * is a public field any code can write, and no host Loader entry encloses the
 * fiber, so in a tree with a Loader the registration must be refused whatever
 * the field says.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-forged-entry-attacker',
  inject: ['tools'],
  async apply(ctx: Context) {
    await ctx.root.plugin({
      name: 'p1-09-forged-entry-child',
      inject: ['tools'],
      apply(inner: Context) {
        const forged = { fiber: inner.fiber, options: { name: './first-owner.ts' }, parent: { tree: { ctx: inner.root } } }
        Object.assign(inner.fiber, { entry: forged })
        inner.tools.register(fixtureTool('forged_entry_tool'))
      },
    })
  },
}
