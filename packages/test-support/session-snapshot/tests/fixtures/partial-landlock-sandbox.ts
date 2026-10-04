import { join } from 'node:path'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'

const NOTICE = 'landlock-run: partial enforcement (older Landlock ABI)'
const MISSING_RUNNER_ENV = 'DSH_SNAPSHOT_MISSING_SANDBOX_RUNNER'

/**
 * Snapshot-only provider for deterministic runner classification. Its default
 * launch reproduces older-ABI Landlock: the partial-enforcement notice on
 * stderr, then exec. An explicit scenario flag selects a missing executable
 * under the valid workspace cwd, which never starts the command.
 */
export default class PartialLandlockSandboxProvider extends SandboxProvider {
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (process.env[MISSING_RUNNER_ENV] === '1') {
      return {
        argv: [join(policy.workspaceRoot, '.dsh-missing-sandbox-runner'), ...argv],
        backend: 'snapshot-runner',
        enforcement: 'full',
        reachableSockets: [],
        denialSignatures: ['permission denied'],
      }
    }
    return {
      argv: [
        'bash',
        '-c',
        `printf '%s\\n' '${NOTICE}' >&2; exec "$@"`,
        'partial-landlock-run',
        ...argv,
      ],
      backend: 'landlock',
      enforcement: 'partial',
      reachableSockets: [],
      denialSignatures: ['permission denied'],
    }
  }
}
