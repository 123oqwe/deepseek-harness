/**
 * Launch one factory profile in-process through `runProfile`, with the
 * arguments `apps/cli/src/bin.ts` passes, against a fresh Harness home.
 *
 * The composition is the factory one: `loadProfile` initializes the missing
 * profile from `PROFILE_TEMPLATES`. The launch adds one `--patch` overlay that
 * inserts `mount-sentinel.ts`, whose marker file exists afterwards exactly
 * when a config-tree entry mounted. The launch environment is read from an
 * empty working directory, so no `.env` file of the checkout takes part.
 *
 * `runProfile` reads `DSH_HOME` and `DSH_TRUST_KERNEL_INSECURE` from
 * `process.env` and adds `SIGTERM`, `SIGINT` and `unhandledRejection`
 * listeners to the process. {@link useInProcessLaunch} registers hooks that
 * restore the two variables, remove the listeners a case added, and delete the
 * case's temporary root, so a case that fails or times out does not leak into
 * the next one.
 * @module apps/cli/tests/fixtures/in-process-launch
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach } from 'vitest'
import { loadLayeredEnv, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '../../src/profile-boot.ts'

/**
 * Case deadline for one in-process launch. It covers the first case's cold
 * transform of the launcher's module graph, and a launch that mounts the whole
 * factory tree before the sentinel stops it.
 */
export const IN_PROCESS_LAUNCH_TIMEOUT_MS = 60_000

const SENTINEL = fileURLToPath(new URL('./mount-sentinel.ts', import.meta.url))
const RESTORED_ENV = ['DSH_HOME', 'DSH_TRUST_KERNEL_INSECURE'] as const
const OBSERVED_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const

/** What one in-process launch left behind. */
export interface InProcessLaunchResult {
  /** What `runProfile` rejected with, or `undefined` when it resolved. */
  readonly error: unknown
  /** Whether the mount sentinel wrote its marker, i.e. whether a config-tree entry mounted. */
  readonly entryMounted: boolean
  /** `dsh.profile.bundles` of the profile manifest the launch initialized. */
  readonly manifestBundles: unknown
}

/** Launch `profile` with `DSH_TRUST_KERNEL_INSECURE` set to `insecureOptIn`, or unset when it is `undefined`. */
export type InProcessLaunch = (profile: string, insecureOptIn: string | undefined) => Promise<InProcessLaunchResult>

/**
 * Register the per-case isolation hooks and return the launcher. Call once at
 * the top level of a spec file.
 * @returns the in-process launcher.
 */
export function useInProcessLaunch(): InProcessLaunch {
  const emitter: NodeJS.EventEmitter = process
  const roots: string[] = []
  let savedEnv = new Map<string, string | undefined>()
  let savedListeners = new Map<string, readonly unknown[]>()

  beforeEach(() => {
    savedEnv = new Map(RESTORED_ENV.map((name): [string, string | undefined] => [name, process.env[name]]))
    savedListeners = new Map(OBSERVED_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
  })

  afterEach(() => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    for (const [event, before] of savedListeners) {
      for (const listener of emitter.listeners(event)) {
        if (!before.includes(listener)) emitter.off(event, listener as (...args: unknown[]) => void)
      }
    }
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  return async (profile, insecureOptIn) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-p0-02-launch-'))
    roots.push(root)
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    mkdirSync(cwd)
    const marker = join(root, 'entry-mounted')
    const overlay = join(root, 'mount-sentinel.patch.yml')
    writeFileSync(overlay, [
      '- insert:',
      '    - id: p0-02-mount-sentinel',
      `      name: '${SENTINEL}'`,
      '      config:',
      `        marker: '${marker}'`,
      '',
    ].join('\n'))
    process.env.DSH_HOME = home
    if (insecureOptIn === undefined) delete process.env.DSH_TRUST_KERNEL_INSECURE
    else process.env.DSH_TRUST_KERNEL_INSECURE = insecureOptIn
    const error = await runProfile({
      environment: loadLayeredEnv('dsh', cwd),
      profile,
      fromDefaultProfile: undefined,
      patchFiles: [overlay],
      args: [],
    }).then(
      async ({ ctx }) => {
        await ctx.fiber.dispose()
        return undefined
      },
      (rejection: unknown) => rejection,
    )
    const manifest = JSON.parse(readFileSync(join(resolveProfileDir(profile, home), 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    return { error, entryMounted: existsSync(marker), manifestBundles: manifest.dsh?.profile?.bundles }
  }
}
