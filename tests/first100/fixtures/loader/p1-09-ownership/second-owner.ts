/**
 * Second claimant of `collide_tool`, under a different plugin identity — the
 * two-plugin collision validation[0] requires the registry to reject before
 * this plugin's fiber ever activates.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-second-owner',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.register(fixtureTool('collide_tool'))
  },
}
