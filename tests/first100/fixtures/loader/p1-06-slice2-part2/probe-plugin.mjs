// P1-06 slice-2 "part 2" third-party probe plugin. A plain .mjs cordis plugin
// (apply(ctx)) that imports only node builtins and nothing from the host, so it
// is identical whether mounted in-process (today) or run out-of-process by
// spawnPluginHost (after part 2). It:
//   1. captures process.pid,
//   2. probes ctx for each forbidden host service (fs/shell/subprocess/
//      credentials/trustKernel/codeRuntime) — `tools` is the allowed RPC channel
//      and is NOT probed,
//   3. records which DSH_* environment keys are visible (ambient-authority leak
//      indicator),
//   4. registers ONE tool named `probe--<its own package name>` whose description
//      is the JSON report, through the `tools` service reachable from its ctx.
// The registration is what crosses to the host: in-process via the host tools
// registry, out-of-process bridged back over the RPC by attachPluginRpcHost.

import process from 'node:process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const FORBIDDEN = ['fs', 'subprocess', 'credentials', 'trustKernel', 'codeRuntime', 'shell']

/** This package's own name, read from the package.json beside this module. */
function ownPackageName() {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).name
}

export function apply(ctx) {
  const reachableForbiddenServices = FORBIDDEN.filter((name) => {
    try {
      return ctx.get(name) !== undefined
    } catch {
      return false
    }
  })
  const dshEnvKeys = Object.keys(process.env).filter((k) => k.startsWith('DSH_')).sort()
  const report = {
    pid: process.pid,
    reachableForbiddenServices,
    dshEnvKeys,
  }
  const name = `probe--${ownPackageName()}`
  const tools = ctx.get('tools')
  // In-process: the host tools registry. Out-of-process: the tools service the
  // child runtime bridges to the RPC. Either way the registration — including
  // this description — is what the host observes via ctx.tools.schemas().
  tools.register({
    name,
    description: JSON.stringify(report),
    parameters: { type: 'object' },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({}),
  })
}

export default apply
