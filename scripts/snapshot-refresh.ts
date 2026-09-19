/**
 * `pnpm run test:snapshot:refresh` — refresh the recorded corpus, then repair
 * the fixture layouts the refresh rewrote, and report the refresh's own result.
 *
 * A script rather than two commands joined by `;`, because that shape got both
 * halves wrong. The exit status of `a; b` is `b`'s, so a refresh that failed
 * every scenario still exited 0 and an empty patch could not be told from a
 * failed run. And a package manager appends a caller's arguments to the END of
 * the script string, so `pnpm run test:snapshot:refresh -- -t <name>` handed
 * `-t <name>` to the migrator and refreshed the WHOLE corpus — the documented
 * single-scenario recipe never filtered anything. The manager also forwards
 * the `--` separator itself, which vitest reads as "everything after this is a
 * path", so the separator is dropped here rather than passed on.
 *
 * The migrator still runs after a failed refresh, and that is deliberate: a
 * partial refresh leaves other scenarios' fixture layouts rewritten, and the
 * migrator is what puts them back. Skipping it on failure would trade a wrong
 * exit code for a damaged tree.
 *
 * `vitest` and `tsx` are bare names, resolved from the `node_modules/.bin`
 * entry a package-manager script run puts on PATH — the same assumption the
 * two bare commands this replaces already made.
 *
 * @module scripts/snapshot-refresh
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Non-zero status of a child, or 1 when a signal ended it. */
function statusOf(result: SpawnSyncReturns<Buffer>): number {
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

/** How this script starts a child; the seam a spec substitutes. */
export type RunChild = (command: string, args: readonly string[], env?: NodeJS.ProcessEnv) => SpawnSyncReturns<Buffer>

/** Start one child with its output on this process's streams. */
const runChild: RunChild = (command, args, env) =>
  spawnSync(command, [...args], { stdio: 'inherit', shell: false, ...env === undefined ? {} : { env } })

/**
 * Run the refresh and the migrator, in that order, and report the refresh.
 * @param argv - arguments to forward to vitest, so `-t` and path filters work.
 * @param run - how to start each child; the default starts real processes.
 * @returns the refresh's status, or the migrator's when the refresh passed.
 */
export function refreshSnapshots(argv: readonly string[], run: RunChild = runChild): number {
  // A package manager forwards the caller's `--` separator along with what
  // follows it, and vitest reads everything after a `--` as a positional file
  // filter -- so passing it on turns `-t text-turn` into a path that matches
  // nothing, silently, which is the same class of failure as the exit code
  // this script exists to fix. The separator ends the manager's own option
  // parsing; it is not part of the filter.
  const forwarded = argv[0] === '--' ? argv.slice(1) : argv
  const refresh = statusOf(run(
    'vitest',
    ['run', '--config', 'vitest.snapshot.config.ts', ...forwarded],
    { ...process.env, DSH_SNAPSHOT: 'refresh' },
  ))
  const migrate = statusOf(run('tsx', ['scripts/migrate-packed-session-fixtures.ts']))
  return refresh === 0 ? migrate : refresh
}

/* v8 ignore start -- the entry guard runs only when this file is the process entry. */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(refreshSnapshots(process.argv.slice(2)))
}
/* v8 ignore stop */
