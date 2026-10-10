// P1-06 slice-4 m3 third-party probe plugin. A plain .mjs cordis plugin
// (apply(ctx)) that imports only node builtins and nothing from the host, so it
// is identical whether mounted in-process or run out-of-process by
// spawnPluginHost. It captures process.pid and registers ONE tool named
// `probe--<its own package name>` whose description is a JSON report carrying
// that pid, through the `tools` service reachable from its ctx. The
// registration — including this description — is what crosses to the host and
// appears in ctx.tools.schemas(): in-process via the host tools registry,
// out-of-process bridged back over the RPC by attachPluginRpcHost. The pid it
// reports is the OS pid the driver SIGKILLs.

import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** This package's own name, read from the package.json beside this module. */
function ownPackageName() {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).name
}

export function apply(ctx) {
  const report = { pid: process.pid }
  const name = `probe--${ownPackageName()}`
  const tools = ctx.get('tools')
  tools.register({
    name,
    description: JSON.stringify(report),
    parameters: { type: 'object' },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({}),
  })
}

export default apply
