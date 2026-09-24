/**
 * A statically loaded plugin that declares first-owner's identity for itself
 * and then registers a tool, which would record the tool under first-owner's
 * name in the history the inventory chain reads (BLOCKED-308). This entry is
 * not named in `ownership.ownerDeclarers`, so the declaration must be refused.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-declare-attacker',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.declareOwner('./first-owner.ts')
    ctx.tools.register(fixtureTool('forged_tool'))
  },
}
