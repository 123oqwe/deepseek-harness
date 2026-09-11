/**
 * Refusal of a write-back run whose built artifacts are older than their source.
 *
 * A refresh or record run writes back whatever the scenario emitted, so an
 * event the run did not emit is deleted from the corpus rather than preserved.
 * Lanes that spawn a shipped profile (`dsh --profile sdk`, `--profile acp`, the
 * headless bin) execute built `lib/`, not `src/`, so a `lib/` tree predating a
 * source change makes those runs emit the OLD behaviour — and the write-back
 * records that as the truth, silently.
 *
 * This is not hypothetical. `f4cb4beee8` refreshed the corpus while
 * `packages/run/run/lib/` predated P4-02 U's
 * `session.append('run/task-profile', …)`, and deleted all 34 `run/task-profile`
 * events from `snapshots/sdk/`. The same run ADDED 90 of them to
 * `snapshots/session/`, whose lane launches from source through tsx. Only the
 * lane running built artifacts lost them, and nothing failed at the time: the
 * damage surfaced on a later full-corpus replay.
 *
 * Replay is deliberately not guarded. Replay compares and never writes, so a
 * stale `lib/` there produces a loud diff instead of silent corpus damage.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One workspace package whose built output is older than its source. */
export interface StalePackage {
  /** Workspace-relative package directory, as `packages/<group>/<name>`. */
  readonly directory: string
  /** Newest mtime under `src/`, in epoch milliseconds. */
  readonly sourceMs: number
  /** Newest mtime under `lib/`, in epoch milliseconds. */
  readonly builtMs: number
}

/** Newest mtime anywhere under one directory, or 0 when it does not exist. */
function newestMtimeMs(directory: string): number {
  if (!existsSync(directory)) return 0
  let newest = 0
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const { mtimeMs } = statSync(path)
      if (mtimeMs > newest) newest = mtimeMs
    }
  }
  walk(directory)
  return newest
}

/**
 * Every workspace package whose `lib/` is older than its `src/`.
 *
 * Compared per package rather than tree-wide because a partial build is the
 * common case: one package rebuilt, its dependency not. Packages without both
 * directories are skipped — a package that publishes no `lib/` cannot be stale.
 * @param packagesRoot - the workspace `packages/` directory.
 * @returns one entry per stale package, in directory order; empty when the build is current.
 */
export function stalePackages(packagesRoot: string): StalePackage[] {
  const stale: StalePackage[] = []
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupDirectory = join(packagesRoot, group.name)
    for (const entry of readdirSync(groupDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = join(groupDirectory, entry.name)
      const source = join(directory, 'src')
      const built = join(directory, 'lib')
      if (!existsSync(source) || !existsSync(built)) continue
      const sourceMs = newestMtimeMs(source)
      const builtMs = newestMtimeMs(built)
      if (sourceMs > builtMs) {
        stale.push({ directory: `packages/${group.name}/${entry.name}`, sourceMs, builtMs })
      }
    }
  }
  return stale
}

/**
 * Refuse a write-back run when any workspace package's build is out of date.
 *
 * Call this from a lane that spawns a shipped profile, before the first
 * scenario runs, and only when the mode writes back. The whole workspace is
 * checked rather than the lane's own packages because the artifact that broke
 * the SDK corpus belonged to `packages/run/run`, which no SDK scenario names:
 * a spawned profile loads the plugin graph, so any stale package in it can
 * change what the run emits.
 * @param packagesRoot - the workspace `packages/` directory.
 * @param mode - the snapshot mode this run was started in.
 * @throws Error naming the stale packages when `mode` writes back and the build is behind.
 */
export function assertBuiltArtifactsCurrent(packagesRoot: string, mode: string): void {
  if (mode !== 'refresh' && mode !== 'record') return
  const stale = stalePackages(packagesRoot)
  if (stale.length === 0) return
  const named = stale.map(entry => `  ${entry.directory}`).join('\n')
  throw new Error(
    `refusing to ${mode} the corpus: ${String(stale.length)} package(s) have a lib/ older than their src/.\n`
    + 'This lane spawns a shipped profile, which runs built lib/, so the run would emit the OLD behaviour and '
    + 'the write-back would record that as the truth — deleting events rather than failing. Run `pnpm run build` first.\n'
    + named,
  )
}
