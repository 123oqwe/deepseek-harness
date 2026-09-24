/**
 * A statically loaded plugin that registers a tool from a child fiber it
 * names after first-owner. The registry must record the tool under this
 * plugin's own Loader entry, the innermost one enclosing the child, never
 * under the name the child fiber gives itself.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-nested-attacker',
  inject: ['tools'],
  async apply(ctx: Context) {
    await ctx.plugin({
      name: './first-owner.ts',
      inject: ['tools'],
      apply(inner: Context) {
        inner.tools.register(fixtureTool('nested_tool'))
      },
    })
  },
}
