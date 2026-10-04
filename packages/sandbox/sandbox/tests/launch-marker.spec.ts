/**
 * The launch marker (Epic P3-03 U2) with a real `/bin/sh` and fake runners: a
 * runner that execs its argv starts the command and the marker is written,
 * whatever the command then does; a runner that exits first leaves none; the
 * command cannot write it, because descriptor 9 is closed before it starts.
 * Keeping the status file out of the command's reach is the sandbox's part,
 * measured on real backends. `$DSH_HOME` points at a temp directory.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LaunchMarker } from '@deepseek-ai/dsh-sandbox'

const dshHome = mkdtempSync(join(tmpdir(), 'dsh-launch-marker-home-'))

beforeAll(() => {
  vi.stubEnv('DSH_HOME', dshHome)
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(dshHome, { recursive: true, force: true })
})

/** A fake runner that execs the argv after its own `--`. */
const PASSTHROUGH = ['/bin/sh', '-c', 'while [ "$1" != "--" ]; do shift; done; shift; exec "$@"', 'passthrough-runner', '--']

/** A fake runner that refuses before starting anything. */
const REFUSING = ['/bin/sh', '-c', 'printf "fake-runner: refused\\n" >&2; exit 1', 'refusing-runner', '--']

/**
 * A marked run's status file.
 * @param marker - an opened marker.
 * @returns its status file's path.
 */
function statusPath(marker: LaunchMarker): string {
  const path = marker.path
  if (path === undefined) throw new Error('an opened marker has a status file')
  return path
}

/**
 * Spawn `command` behind the marker's two wrappers and `runner`.
 * @param marker - the run's marker.
 * @param runner - the fake runner, ending in its `--`.
 * @param command - a `/bin/sh -c` script.
 * @returns the spawn result.
 */
function run(marker: LaunchMarker, runner: readonly string[], command: string): SpawnSyncReturns<string> {
  const argv = marker.runner([...runner, ...marker.command(['/bin/sh', '-c', command])])
  expect(argv[0]).toBe('/bin/sh')
  return spawnSync('/bin/sh', argv.slice(1), { encoding: 'utf8', timeout: 10_000 })
}

describe('LaunchMarker (Epic P3-03 U2)', () => {
  it.each([
    ['a clean exit', 'exit 0'],
    ['a forged runner failure', "printf 'bwrap: Can not mount tmpfs\\n' >&2; exit 1"],
    ['a signal death', 'kill -9 $$'],
  ])('is written when the runner starts the command, whatever the command does: %s', (_label, command) => {
    const marker = LaunchMarker.open()
    try {
      run(marker, PASSTHROUGH, command)
      expect(marker.started()).toBe(true)
    } finally {
      marker.release()
    }
  })

  it('is absent when the runner exits before starting the command', () => {
    const marker = LaunchMarker.open()
    try {
      const result = run(marker, REFUSING, 'exit 0')
      expect([result.status, result.stderr]).toEqual([1, 'fake-runner: refused\n'])
      expect(marker.started()).toBe(false)
    } finally {
      marker.release()
    }
  })

  it('is absent when nothing was spawned', () => {
    const marker = LaunchMarker.open()
    try {
      expect(marker.started()).toBe(false)
    } finally {
      marker.release()
    }
  })

  it('cannot be written by the command: descriptor 9 is closed before it starts', () => {
    const marker = LaunchMarker.open()
    try {
      const result = run(marker, PASSTHROUGH, 'printf forged >&9')
      expect(result.status).not.toBe(0)
      expect(readFileSync(statusPath(marker), 'utf8')).toBe('launched')
    } finally {
      marker.release()
    }
  })

  it('keeps each run in its own private directory under $DSH_HOME/cache/launch and removes it on release', () => {
    const marker = LaunchMarker.open()
    const dir = dirname(statusPath(marker))
    expect(dirname(dir)).toBe(join(dshHome, 'cache', 'launch'))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    marker.release()
    expect(existsSync(dir)).toBe(false)
  })

  it('rethrows a status read that fails for any reason other than a missing file', () => {
    const marker = LaunchMarker.open()
    try {
      mkdirSync(statusPath(marker))
      expect(() => marker.started()).toThrow(expect.objectContaining({ code: 'EISDIR' }))
    } finally {
      marker.release()
    }
  })

  it('unmarked (no POSIX shell): wraps nothing, has no status file, reports every run started, and releases nothing', () => {
    const marker = LaunchMarker.unmarked()
    expect([marker.command(['pwsh', '-c', 'x']), marker.runner(['runner', '--', 'pwsh']), marker.path, marker.started()])
      .toEqual([['pwsh', '-c', 'x'], ['runner', '--', 'pwsh'], undefined, true])
    marker.release()
    expect(marker.started()).toBe(true)
  })
})
