/**
 * A second plugin taking over `collide_tool` through the EXPLICIT replace
 * entry point (must[2]), which acceptance[1] then requires the Inventory to
 * show as a replaced/replacing chain. A plain `register()` of the same name
 * stays a collision even under `allowReplace: true`.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-replacer',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.replace(fixtureTool('collide_tool'))
  },
}
