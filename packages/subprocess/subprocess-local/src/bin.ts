/** Thin executable/importable entry for the provider-private runner core. */

import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { consumeRunnerSelection } from './runner-launch.ts'
import { reportSpawnRunnerFailure, runSpawnRunner } from './spawn-runner.ts'

/**
 * Run a selector already removed by a packaging bootstrap.
 * @param selection - private runner selector or Linux launch-request locator.
 */
export async function runSelectedSubprocessRunner(selection: string): Promise<void> {
  try {
    await runSpawnRunner(selection, process.argv.slice(2))
  } catch (error) {
    await reportSpawnRunnerFailure(selection, error)
  }
}

/**
 * The real path of `path`, or `undefined` when it cannot be resolved.
 * @param path - a path `existsSync` reported.
 * @returns the real path, or `undefined`.
 */
function realPathOf(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch {
    // A SEA-packaged executable's virtual file system reports its entry script, named without the
    // snapshot prefix, as existing and still refuses to resolve it; such a path names no file this
    // module can be.
    return undefined
  }
}

// Not `import.meta.main`, which Node 24.0 leaves undefined (BLOCKED-351). The real path,
// because this entry is started through a symlink; existence first, because a packaged
// executable's argv[1] need not name a file, and a resolution that fails names no file.
if (process.argv[1] !== undefined && existsSync(process.argv[1]) && realPathOf(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selection = consumeRunnerSelection()
  if (selection === undefined) {
    process.exitCode = 127
  } else {
    void runSelectedSubprocessRunner(selection)
  }
}
