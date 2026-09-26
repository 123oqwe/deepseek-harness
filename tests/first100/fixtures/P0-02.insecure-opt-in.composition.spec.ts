/**
 * B-672, the P0-02 red first (the P0-02 row of the acceptance locks,
 * BLOCKED-306, C19 §2): only an explicit development profile accepts
 * `DSH_TRUST_KERNEL_INSECURE`, on real `dsh --profile` launches.
 *
 * Every case launches the real `dsh` bin through the shared launcher against
 * its own `DSH_HOME`. The shipped-profile cases add one `--patch` overlay that
 * inserts `apps/cli/tests/fixtures/mount-sentinel.ts`, which writes a marker
 * file when it mounts and then fails the mount, so every template ends quickly
 * and the marker says whether any config-tree entry mounted. `web` listens on
 * a port the system picks, and `headless` is given a task, because its
 * startup rejects a launch without one while it mounts, before the sentinel
 * would. Stdin stays open, so no stdio server ends on end-of-input first.
 *
 * The development profile declares `dsh.profile.development: true` in its own
 * `package.json`, the declaration the delegate ruled for C19 §2. It composes
 * the base and headless bundles with `apps/cli/tests/fixtures/recording-llm.ts`
 * as its only model route, which records every model request and whether a
 * kernel was pinned in the launched tree. How the model is told that it runs
 * insecure is the fix's wording; the case asks for one request string that
 * names both the Trust Kernel and the insecure mode.
 *
 * Red today on the five shipped-profile refusals, which boot, and on the
 * development profile's model-visible statement. The controls are green today
 * and after the fix.
 * @module tests/first100/fixtures/P0-02.insecure-opt-in.composition
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { insecureBootWarning } from '../../../apps/cli/tests/fixtures/kernel-pinned-headless.ts'
import {
  KERNEL_OBSERVATION_FILE,
  MODEL_INPUT_FILE,
  PROBE_FILE,
  PROBE_TEXT,
  RECORDING_ROUTE,
} from '../../../apps/cli/tests/fixtures/recording-llm.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BIN_SCRIPT = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const TSCONFIG = join(REPOSITORY_ROOT, 'tsconfig.json')
const SENTINEL = join(REPOSITORY_ROOT, 'apps/cli/tests/fixtures/mount-sentinel.ts')
const RECORDING_PLUGIN = join(REPOSITORY_ROOT, 'apps/cli/tests/fixtures/recording-llm.ts')

/** The launch deadline, the same as the loader smoke's. */
const PROCESS_TIMEOUT_MS = 30_000

/** The development profile the acceptance[3] cases launch. */
const DEV_PROFILE = 'p0-02-dev'

/** Arguments a shipped template needs after the launcher's own, so its startup mounts. */
const APP_ARGS: Readonly<Record<string, readonly string[]>> = {
  web: ['--port', '0'],
  headless: ['name your route'],
}

/** How one sentinel launch ended. */
interface SentinelLaunch {
  readonly exitCode: number | undefined
  /** Whether the sentinel's marker file exists, that is, whether a config-tree entry mounted. */
  readonly mounted: boolean
  readonly stderr: string
}

/**
 * Launch one shipped profile once with the mount sentinel overlaid.
 * @param profile - the shipped profile name.
 * @param insecureOptIn - the `DSH_TRUST_KERNEL_INSECURE` value; empty means off.
 * @returns how the launch ended; no exit code when it was killed at the deadline.
 */
async function launchWithSentinel(profile: string, insecureOptIn: string): Promise<SentinelLaunch> {
  const cwd = await mkdtemp(join(tmpdir(), 'p0-02-opt-in-'))
  try {
    const marker = join(cwd, 'entry-mounted')
    const overlay = join(cwd, 'mount-sentinel.patch.yml')
    writeFileSync(overlay, [
      '- insert:',
      '    - id: p0-02-mount-sentinel',
      `      name: '${SENTINEL}'`,
      '      config:',
      `        marker: '${marker}'`,
      '',
    ].join('\n'))
    const command = resolveExampleLaunch({
      srcBin: BIN_SCRIPT,
      configArgs: ['--profile', profile, '--patch', overlay, ...APP_ARGS[profile] ?? []],
      tsconfigPath: TSCONFIG,
      env: {
        DSH_HOME: join(cwd, '.dsh'),
        DSH_AGENTS_HOME: join(cwd, '.agents'),
        DSH_TELEMETRY_DISABLED: '1',
        DSH_TRUST_KERNEL_INSECURE: insecureOptIn,
      },
    })
    const result = await execa(command.command, command.args, {
      cwd,
      env: command.env,
      timeout: PROCESS_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
      stripFinalNewline: false,
    })
    return { exitCode: result.exitCode, mounted: existsSync(marker), stderr: result.stderr }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

/**
 * The failure detail a sentinel launch's assertions carry.
 * @param run - the launch.
 * @returns its exit code and the tail of its stderr.
 */
function sentinelDetail(run: SentinelLaunch): string {
  return `exit ${String(run.exitCode)}, mounted ${String(run.mounted)}\nstderr tail:\n${run.stderr.slice(-1500)}`
}

/**
 * Build the development profile: the base and headless bundles, the recording
 * route in place of the shipped DeepSeek route, and the file its turn reads.
 * @param cwd - the launch's isolated working directory.
 */
function stageDevProfile(cwd: string): void {
  const dir = join(cwd, '.dsh', 'profiles', DEV_PROFILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${DEV_PROFILE}`,
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
        patchReload: 'startup',
        development: true,
      },
    },
  }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- id: llm-deepseek',
    '  disabled: true',
    '',
    '- id: session-persistence-jsonl',
    '  config:',
    "    root: './.sessions'",
    '',
    '- insert:',
    '    - id: p0-02-recording-llm',
    `      name: '${RECORDING_PLUGIN}'`,
    '',
  ].join('\n'))
  writeFileSync(join(cwd, PROBE_FILE), `${PROBE_TEXT}\n`)
}

/**
 * Read a file the launch should have written, or a marker naming its absence.
 * @param path - the file.
 * @returns its text, or `ABSENT: <reason>`.
 */
function readWritten(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    // ENOENT and every other read failure alike: the assertions name the file.
    return `ABSENT: ${String(error)}`
  }
}

/** What one development-profile launch left behind. */
interface DevLaunch {
  readonly stderr: string
  /** The recorded model requests, one JSON object per line. */
  readonly inputs: string
  /** Whether the recording route saw a pinned kernel, as JSON. */
  readonly observation: string
}

/**
 * Launch the development profile once; the launch must exit 0.
 * @param insecureOptIn - the `DSH_TRUST_KERNEL_INSECURE` value; empty means off.
 * @returns its stderr and the two files the recording route wrote.
 */
async function launchDevProfile(insecureOptIn: string): Promise<DevLaunch> {
  let inputs = ''
  let observation = ''
  const result = await runLoaderSmoke({
    label: `p0-02-dev-${insecureOptIn === '' ? 'pinned' : 'insecure'}`,
    tempDirPrefix: 'dsh-p0-02-dev-',
    binScript: BIN_SCRIPT,
    configPath: '',
    binArgs: ['--profile', DEV_PROFILE, '--model', `${RECORDING_ROUTE}:model-one`, `read ${PROBE_FILE}`],
    tsconfigPath: TSCONFIG,
    env: { DSH_TRUST_KERNEL_INSECURE: insecureOptIn, DSH_TELEMETRY_DISABLED: '1' },
    prepare: stageDevProfile,
    inspect: (cwd) => {
      inputs = readWritten(join(cwd, MODEL_INPUT_FILE))
      observation = readWritten(join(cwd, KERNEL_OBSERVATION_FILE))
    },
  })
  return { stderr: result.stderr, inputs, observation }
}

/**
 * Every string anywhere inside a parsed JSON value.
 * @param value - the value.
 * @returns its string leaves.
 */
function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringLeaves)
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves)
  return []
}

/**
 * Whether one recorded request string tells the model it runs without the
 * Trust Kernel's protection.
 * @param inputs - the recorded requests, one JSON object per line.
 * @returns true when a string names both the Trust Kernel and the insecure mode.
 */
function tellsModelInsecure(inputs: string): boolean {
  const records = inputs.trimEnd().split('\n').filter(line => line !== '').map(line => JSON.parse(line) as unknown)
  return records.flatMap(stringLeaves).some(text => /trust kernel/iu.test(text) && /insecure/iu.test(text))
}

describe('P0-02 on real `dsh --profile` launches: only an explicit development profile accepts DSH_TRUST_KERNEL_INSECURE (B-672)', () => {
  it.each(Object.keys(PROFILE_TEMPLATES))('acceptance[2]: the shipped %s profile launched with DSH_TRUST_KERNEL_INSECURE set refuses to start before any config-tree entry mounts', async (profile) => {
    const run = await launchWithSentinel(profile, '1')
    const exit = run.exitCode === undefined ? 'killed' : run.exitCode === 0 ? 'zero' : 'nonzero'
    expect({ exit, mounted: run.mounted }, sentinelDetail(run)).toEqual({ exit: 'nonzero', mounted: false })
    expect(run.stderr, sentinelDetail(run)).toContain('DSH_TRUST_KERNEL_INSECURE')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.each(Object.keys(PROFILE_TEMPLATES))('control: the shipped %s profile launched with DSH_TRUST_KERNEL_INSECURE empty pins its kernel and mounts the sentinel entry', async (profile) => {
    const run = await launchWithSentinel(profile, '')
    expect(run.mounted, sentinelDetail(run)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('acceptance[3]: an explicit development profile launched with DSH_TRUST_KERNEL_INSECURE set starts without a kernel, warns on stderr, and tells the model it runs insecure', async () => {
    const run = await launchDevProfile('1')
    const detail = `stderr tail:\n${run.stderr.slice(-1500)}`
    expect(run.observation, detail).not.toMatch(/^ABSENT: /u)
    expect(JSON.parse(run.observation), detail).toEqual({ trustKernelPinned: false })
    expect(run.stderr).toContain(insecureBootWarning())
    expect(run.inputs, detail).not.toMatch(/^ABSENT: /u)
    expect(tellsModelInsecure(run.inputs), run.inputs.slice(-3000)).toBe(true)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: the same development profile launched with DSH_TRUST_KERNEL_INSECURE empty pins its kernel, prints no warning, and tells the model nothing of the kind', async () => {
    const run = await launchDevProfile('')
    const detail = `stderr tail:\n${run.stderr.slice(-1500)}`
    expect(run.observation, detail).not.toMatch(/^ABSENT: /u)
    expect(JSON.parse(run.observation), detail).toEqual({ trustKernelPinned: true })
    expect(run.stderr).not.toContain(insecureBootWarning())
    expect(run.inputs, detail).not.toMatch(/^ABSENT: /u)
    expect(tellsModelInsecure(run.inputs)).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
