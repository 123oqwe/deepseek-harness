#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Run the public dsh command-line interface.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const invocation = parseDshArgs(process.argv.slice(2), readVersion())

  switch (invocation.mode) {
    case 'profile': {
      const { runProfile } = await import('./profile-boot.ts')
      await runProfile({
        environment: loadLayeredEnv('dsh'),
        profile: invocation.profile,
        fromDefaultProfile: invocation.fromDefaultProfile,
        patchFiles: invocation.patches,
        args: invocation.args,
      })
      break
    }
    case 'plugin': {
      const { runPlugin } = await import('./plugin.ts')
      process.exit(await runPlugin(invocation.profile, invocation.args))
      break
    }
    case 'plugin-verify': {
      const { runPluginVerify } = await import('./plugin.ts')
      process.exit(runPluginVerify(invocation.fixture))
      break
    }
    case 'dump-config': {
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    case 'memory': {
      const { runMemoryReview } = await import('./memory-review.ts')
      await runMemoryReview(invocation.profile, invocation.patches, invocation.args)
      break
    }
    case 'audit': {
      const { runAudit } = await import('./audit.ts')
      await runAudit(invocation.profile, invocation.patches, invocation.args)
      break
    }
    default:
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
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
// MUTATION M-688-1″ (never merge): the entry runs only where import.meta.main is true.
if (
  import.meta.main
  && process.argv[1] !== undefined && existsSync(process.argv[1]) && realPathOf(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli()
}
