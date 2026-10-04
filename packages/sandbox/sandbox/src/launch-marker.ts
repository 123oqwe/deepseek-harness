/**
 * The launch marker: the one fact, outside the command's own output, that a
 * confined command started (Epic P3-03 U2). A host-side `/bin/sh` opens a
 * status file on descriptor 9 and execs the runner; a `/bin/sh` inside the
 * sandbox writes the marker to descriptor 9, closes it, and execs the command.
 * The marker is therefore written after confinement is in place and before the
 * command's first instruction, and the command can neither remove it nor write
 * one: it holds no descriptor to the file and cannot open it, because the file
 * lies under the harness home, which no confined mode lets a command write.
 * Marker present: the command ran, and any failure is its own. Marker absent:
 * the runner failed before starting it. Each runner must exec the argv after
 * its own options. Windows has no POSIX shell for the wrappers, so there the
 * marker is unmarked: it wraps nothing and reports every run started, and only
 * a spawn failure identifies a runner failure.
 * @module @deepseek-ai/dsh-sandbox/launch-marker
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'

/** The host-side wrapper: open the status file on descriptor 9, then exec the runner. */
const RUNNER_WRAPPER = 'exec 9>"$1" || exit 126; shift; exec "$@"'

/** The wrapper inside the sandbox: write the marker, close descriptor 9, then exec the command. */
const COMMAND_WRAPPER = 'printf launched >&9 && exec 9>&- && exec "$@"'

/** What the wrapper inside the sandbox writes. */
const LAUNCHED = 'launched'

/**
 * The status directory and wrappers of one confined run. Open it before the
 * provider wraps the command, so the harness home exists when the provider
 * decides which of its paths to keep read-only; release it once the process
 * has settled.
 */
export class LaunchMarker {
  /**
   * @param dir - the private status directory; undefined for an unmarked run.
   */
  private constructor(private readonly dir: string | undefined) {}

  /**
   * Create a private status directory under `$DSH_HOME/cache/launch`, or an
   * unmarked marker on Windows.
   * @returns the marker for one run.
   */
  static open(): LaunchMarker {
    /* v8 ignore next -- one arm per platform: the coverage lane runs on Linux; the Windows unit leg takes this one. */
    if (process.platform === 'win32') return LaunchMarker.unmarked()
    const parent = dshCachePath('launch')
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    return new LaunchMarker(mkdtempSync(join(parent, 'run-')))
  }

  /**
   * A marker for a host with no POSIX shell: it wraps nothing and reports
   * every run started, so only a spawn failure identifies a runner failure.
   * @returns the unmarked marker.
   */
  static unmarked(): LaunchMarker {
    return new LaunchMarker(undefined)
  }

  /** The status file the host-side wrapper opens on descriptor 9; undefined when unmarked. */
  get path(): string | undefined {
    return this.dir === undefined ? undefined : join(this.dir, 'status')
  }

  /**
   * The argv to hand the provider in place of the command's own.
   * @param argv - the command.
   * @returns the in-sandbox wrapper, then the command; the command alone when unmarked.
   */
  command(argv: readonly string[]): string[] {
    return this.dir === undefined ? [...argv] : ['/bin/sh', '-c', COMMAND_WRAPPER, 'dsh-launched', ...argv]
  }

  /**
   * The argv to spawn in place of the provider's.
   * @param argv - the provider's confined argv.
   * @returns the host-side wrapper, then the runner; the runner alone when unmarked.
   */
  runner(argv: readonly string[]): string[] {
    const path = this.path
    return path === undefined ? [...argv] : ['/bin/sh', '-c', RUNNER_WRAPPER, 'dsh-launch-status', path, ...argv]
  }

  /**
   * Whether the command inside the sandbox started. Read after the process settles.
   * @returns true when the marker is in the status file, and always when unmarked.
   */
  started(): boolean {
    const path = this.path
    if (path === undefined) return true
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error: unknown) {
      // The host-side wrapper never created the file, so nothing started.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
    return text === LAUNCHED
  }

  /** Remove the status directory; nothing to remove when unmarked. */
  release(): void {
    if (this.dir !== undefined) rmSync(this.dir, { recursive: true, force: true })
  }
}
