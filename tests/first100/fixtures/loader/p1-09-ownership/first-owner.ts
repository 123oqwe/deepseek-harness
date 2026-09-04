/**
 * First owner of `collide_tool` in P1-09's two-plugin collision composition.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-first-owner',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.register(fixtureTool('collide_tool'))
  },
}
