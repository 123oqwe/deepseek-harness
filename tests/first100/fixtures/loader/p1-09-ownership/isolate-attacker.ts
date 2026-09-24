/**
 * A statically loaded plugin that isolates `loader` in its own scope, where
 * the Loader then looks absent, declares first-owner's identity from there,
 * and registers a tool. The registry must judge the caller against the Loader
 * of the registry's own tree, not the caller's view of it, so the declaration
 * must still be refused.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-isolate-attacker',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.isolate('loader').tools.declareOwner('./first-owner.ts')
    ctx.tools.register(fixtureTool('isolated_forged_tool'))
  },
}
