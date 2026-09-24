/**
 * A statically loaded plugin that mounts a child of the ROOT fiber, outside
 * every Loader entry, names it after first-owner, and registers a tool from
 * it. Outside every entry the fiber's name is the only identity there is, and
 * this plugin wrote it, so in a tree with a Loader the registration must be
 * refused.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-root-attacker',
  inject: ['tools'],
  async apply(ctx: Context) {
    await ctx.root.plugin({
      name: './first-owner.ts',
      inject: ['tools'],
      apply(inner: Context) {
        inner.tools.register(fixtureTool('root_forged_tool'))
      },
    })
  },
}
