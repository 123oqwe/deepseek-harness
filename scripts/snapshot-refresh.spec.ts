/**
 * The three things `a; b` got wrong, and that this script exists to get right.
 * @module scripts/snapshot-refresh.spec
 */

import type { SpawnSyncReturns } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { refreshSnapshots, type RunChild } from './snapshot-refresh.ts'

/** One recorded child: what was started, with which arguments and environment. */
interface StartedChild {
  command: string
  args: readonly string[]
  env?: NodeJS.ProcessEnv
}

/**
 * A runner that records its calls and answers each with a given status.
 * @param statuses - exit status per call, in order.
 * @returns the runner and the list it appends to.
 */
function recordingRunner(statuses: readonly number[]): { run: RunChild; started: StartedChild[] } {
  const started: StartedChild[] = []
  const run: RunChild = (command, args, env) => {
    started.push({ command, args, ...env === undefined ? {} : { env } })
    return { status: statuses[started.length - 1] ?? 0 } as SpawnSyncReturns<Buffer>
  }
  return { run, started }
}

describe('snapshot refresh', () => {
  it('reports the refresh, not the migrator that follows it', () => {
    // The whole defect: `vitest ...; tsx migrate ...` exits with the
    // migrator's status, so a refresh that failed every scenario exited 0 and
    // an empty patch could not be told from a run that produced nothing.
    const { run, started } = recordingRunner([1, 0])

    expect(refreshSnapshots([], run)).toBe(1)
    expect(started.map(child => child.command)).toEqual(['vitest', 'tsx'])
  })

  it('runs the migrator even when the refresh failed', () => {
    // Deliberate, and the reason this is not `&&`: a partial refresh has
    // already rewritten other scenarios' fixture layouts, and the migrator is
    // what puts them back. Skipping it would trade a wrong exit code for a
    // damaged tree.
    const { run, started } = recordingRunner([1, 0])

    refreshSnapshots([], run)
    expect(started[1]).toMatchObject({ command: 'tsx', args: ['scripts/migrate-packed-session-fixtures.ts'] })
  })

  it('forwards a caller\'s arguments to vitest rather than to the migrator', () => {
    // A package manager appends script arguments to the END of the command
    // string, so under the old shape `-t text-turn` reached the migrator and
    // the refresh ran over the whole corpus.
    const { run, started } = recordingRunner([0, 0])

    refreshSnapshots(['snapshots/sdk/sdk.snapshot.ts', '-t', 'text-turn'], run)
    expect(started[0]?.args).toEqual([
      'run',
      '--config',
      'vitest.snapshot.config.ts',
      'snapshots/sdk/sdk.snapshot.ts',
      '-t',
      'text-turn',
    ])
    expect(started[1]?.args).toEqual(['scripts/migrate-packed-session-fixtures.ts'])
  })

  it('drops the separator a package manager forwards ahead of the filter', () => {
    // `pnpm run test:snapshot:refresh -- -t text-turn` hands this script
    // `['--', '-t', 'text-turn']`. Forwarding the `--` makes vitest read `-t`
    // and `text-turn` as file paths, match nothing, and say nothing.
    const { run, started } = recordingRunner([0, 0])

    refreshSnapshots(['--', '-t', 'text-turn'], run)
    expect(started[0]?.args).toEqual(['run', '--config', 'vitest.snapshot.config.ts', '-t', 'text-turn'])
  })

  it('drops only a LEADING separator, not one a caller meant for vitest', () => {
    const { run, started } = recordingRunner([0, 0])

    refreshSnapshots(['-t', 'text-turn', '--', 'snapshots/sdk'], run)
    expect(started[0]?.args).toEqual([
      'run',
      '--config',
      'vitest.snapshot.config.ts',
      '-t',
      'text-turn',
      '--',
      'snapshots/sdk',
    ])
  })

  it('selects refresh mode for the refresh child only', () => {
    const { run, started } = recordingRunner([0, 0])

    refreshSnapshots([], run)
    expect(started[0]?.env?.DSH_SNAPSHOT).toBe('refresh')
    expect(started[1]?.env).toBeUndefined()
  })

  it('reports the migrator when the refresh passed', () => {
    const { run } = recordingRunner([0, 2])

    expect(refreshSnapshots([], run)).toBe(2)
  })

  it('reads a signalled child as a failure rather than as a pass', () => {
    // `status` is null when a signal ended the child, and `null ?? 1` is the
    // difference between "killed" and "succeeded".
    const run: RunChild = () => ({ status: null } as SpawnSyncReturns<Buffer>)

    expect(refreshSnapshots([], run)).toBe(1)
  })
})
