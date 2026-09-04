/**
 * A third-party plugin claiming a tool inside the officially reserved `dsh.*`
 * namespace (validation[2]). Synthetic: no tool name in this repository is
 * `dsh.`-prefixed today, so this proves the gate rejects rather than that a
 * real conflict was caught.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { fixtureTool } from './fixture-tool.ts'

export default {
  name: 'p1-09-third-party',
  inject: ['tools'],
  apply(ctx: Context) {
    ctx.tools.register(fixtureTool('dsh.core.read_file'))
  },
}
