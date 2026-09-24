/**
 * Epic P3-10 acceptance[0] on the shipped path: a fork bomb and a memory
 * balloon, run by the real `bash` tool in the factory `headless` composition,
 * are held by the ceiling the deployment states on its `execution-worlds` row,
 * and the same two commands end differently when no ceiling is stated.
 *
 * The main assertion is the tool outcome, the text the model receives, because
 * that is what a ceiling changes for an agent. The composition is the shipped
 * layers plus a deployment overlay (`loader/p3-10-world-ceiling/`); no fixture
 * mounts a provider. A cgroup count the command reads is printed, never
 * asserted: it says how the range was built, not whether the ceiling held.
 *
 * A deployment that states a ceiling refuses the command, and runs nothing,
 * when the session runs in `danger-full-access`, where no world is bound
 * (delegate ruling B-479).
 *
 * The ceiling cases run only where this machine's subprocess runtime holds
 * both dimensions, asked the way
 * `packages/subprocess/subprocess-local/tests/limits.spec.ts` asks, and say
 * why when they skip.
 */

import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { erroredTurns, LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { beforeAll, describe, expect, it } from 'vitest'

const fixtures = new URL('./loader/p3-10-world-ceiling/', import.meta.url)
const driver = fileURLToPath(new URL('driver.ts', fixtures))
const limitedOverlay = fileURLToPath(new URL('limited.patch.yml', fixtures))
/** Each boot: the deployment overlay and the launch environment. */
const runs = {
  limited: { overlay: limitedOverlay, env: {} },
  control: { overlay: fileURLToPath(new URL('control.patch.yml', fixtures)), env: {} },
  'full-access': { overlay: limitedOverlay, env: { DSH_PERMISSION_MODE: 'danger-full-access' } },
} as const
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One bash call's result, as the model received it. */
interface CallResult {
  readonly text: string
  readonly isError: boolean
}

/** What one boot left in its session log. */
interface Outcome {
  /** Each bash call's result, by tool call id. */
  readonly results: ReadonlyMap<string, CallResult>
  /** The provider the session's world was bound to, if one was. */
  readonly provider: string | undefined
}

/** The fields of a `tool/result` message this spec reads. */
interface ToolResultMessage {
  readonly content: readonly {
    readonly toolCallId: string
    readonly content: readonly { readonly type: string; readonly text?: string }[]
    readonly isError: boolean
  }[]
}

/**
 * Boot the shipped headless profile for one run and read its session log.
 * @param run - which overlay and environment to boot.
 * @returns the tool results and the bound provider.
 */
async function boot(run: keyof typeof runs): Promise<Outcome> {
  const results = new Map<string, CallResult>()
  let provider: string | undefined
  const { stderr } = await runLoaderSmoke({
    label: `p3-10 world ceiling: ${run}`,
    tempDirPrefix: `p3-10-world-ceiling-${run}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: runs[run].overlay,
    tsconfigPath: repoTsconfig,
    env: runs[run].env,
    inspect: async (cwd) => {
      const root = join(cwd, '.sessions')
      const logs = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
      expect(logs).toHaveLength(1)
      const lines = (await readFile(join(root, logs[0] as string), 'utf8')).trimEnd().split('\n')
      const events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      expect(erroredTurns(events), `${run}: the boot ended in an error turn`).toEqual([])
      for (const event of events) {
        const type: string = event.type
        if (type === 'action/world-bound') provider = (event.data as { provider: string }).provider
        if (type !== 'tool/result') continue
        for (const part of (event.data as { message: ToolResultMessage }).message.content) {
          results.set(part.toolCallId, { text: part.content.map(block => block.text ?? '').join(''), isError: part.isError })
        }
      }
    },
  })
  expect(stderr).not.toContain('UNHANDLED')
  return { results, provider }
}

/** One boot per run, shared by every case that reads it. */
const booted = new Map<keyof typeof runs, Promise<Outcome>>()
function outcome(run: keyof typeof runs): Promise<Outcome> {
  let pending = booted.get(run)
  if (pending === undefined) {
    pending = boot(run)
    booted.set(run, pending)
  }
  return pending
}

/** The fork bomb's own report, from the text its bash call returned. */
function forkReport(result: CallResult | undefined): { attempts: number; started: number; refused: number; pidsCurrent: string } {
  const line = /FORK (\{.*\})/u.exec(result?.text ?? '')
  if (line === null) throw new Error(`the fork bomb reported nothing:\n${JSON.stringify(result)}`)
  return JSON.parse(line[1] as string) as { attempts: number; started: number; refused: number; pidsCurrent: string }
}

/** A tool outcome the bash tool renders for a command the kernel killed. */
const KILLED = /\[killed by signal: SIGKILL\]|\[exit code: 137\]/u

describe('P3-10 acceptance[0] — the shipped headless profile holds the ceiling a deployment states', () => {
  let held: readonly string[] = []

  beforeAll(async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    try {
      held = ctx.subprocess.enforceableLimits()
    } finally {
      await fiber.dispose()
    }
  })

  /** Skip, saying why, unless this machine's runtime holds processes and memory. */
  function requireHeld(skip: (note: string) => void): void {
    if (held.includes('processes') && held.includes('memory')) return
    const note = `this machine's subprocess runtime holds [${held.join(', ')}], not processes and memory (platform ${process.platform})`
    console.log(`[p3-10 world ceiling] skipped: ${note}`)
    skip(note)
  }

  it('binds the session to the fenced provider only when the deployment states a ceiling', async ({ skip }) => {
    requireHeld(skip)
    expect((await outcome('limited')).provider).toBe('fenced')
    expect((await outcome('control')).provider).toBe('local')
  }, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('holds a fork bomb to 64 live processes, where the control starts every child', async ({ skip }) => {
    requireHeld(skip)
    const limited = forkReport((await outcome('limited')).results.get('fork-bomb'))
    const control = forkReport((await outcome('control')).results.get('fork-bomb'))
    console.log(`[p3-10 world ceiling] fork bomb: limited=${JSON.stringify(limited)} control=${JSON.stringify(control)}`)
    expect(limited.attempts).toBe(128)
    expect(limited.started + limited.refused).toBe(128)
    expect(limited.refused).toBeGreaterThan(0)
    expect(limited.started).toBeLessThanOrEqual(64)
    expect(control).toMatchObject({ attempts: 128, started: 128, refused: 0 })
  }, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('kills a memory balloon at 256 MiB, where the control holds all 768 MiB', async ({ skip }) => {
    requireHeld(skip)
    const limited = (await outcome('limited')).results.get('balloon')?.text ?? ''
    const control = (await outcome('control')).results.get('balloon')?.text ?? ''
    console.log(`[p3-10 world ceiling] balloon: limited=${JSON.stringify(limited)} control=${JSON.stringify(control)}`)
    expect(limited).not.toContain('BALLOON allocated')
    expect(limited).toMatch(KILLED)
    expect(control).toContain('BALLOON allocated 768')
    expect(control).not.toMatch(KILLED)
  }, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)

  it.skipIf(process.platform === 'win32')('REFUSES both commands in danger-full-access when the deployment states a ceiling, and runs neither', async () => {
    const refused = await outcome('full-access')
    expect(refused.provider).toBeUndefined()
    for (const id of ['fork-bomb', 'balloon']) {
      const result = refused.results.get(id)
      expect(result?.isError, id).toBe(true)
      expect(result?.text, id).toContain('memoryBytes 268435456, maxProcesses 64')
      expect(result?.text, id).toContain('danger-full-access')
      expect(result?.text, id).not.toMatch(/FORK|BALLOON/u)
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  // DIAG — never merge: reads what killed the limited balloon, and fails on purpose
  // so the whole reading lands in the report's failure message untruncated.
  it('DIAG — never merge: what killed the limited balloon', async () => {
    const run = (command: string, args: readonly string[]): string => {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 20_000 })
      return `exit=${String(result.status)} signal=${String(result.signal)}\n${result.stdout}${result.stderr === '' ? '' : `\nSTDERR ${result.stderr}`}`
    }
    const pick = (text: string, pattern: RegExp, keep: number): string[] =>
      text.split('\n').filter(line => pattern.test(line)).slice(-keep)
    const limited = await outcome('limited')
    const control = await outcome('control')
    const diag = {
      held,
      limited: Object.fromEntries(limited.results),
      control: Object.fromEntries(control.results),
      kernel: pick(run('sudo', ['-n', 'dmesg', '--ctime']), /exit=|oom|killed process|memory cgroup|out of memory/iu, 40),
      userJournal: pick(run('journalctl', ['--user', '--no-pager', '-o', 'short-precise', '-n', '2000']), /exit=|STDERR|dsh-subprocess|oom|OOM/u, 120),
      systemJournal: pick(run('sudo', ['-n', 'journalctl', '--no-pager', '-o', 'short-precise', '-n', '5000']), /exit=|STDERR|dsh-subprocess|oom/iu, 120),
      manager: run('systemctl', ['--user', 'show', '-p', 'Version', '-p', 'DefaultOOMPolicy', '-p', 'DefaultMemoryAccounting']),
      oomd: run('systemctl', ['is-active', 'systemd-oomd']),
      bash: run('bash', ['--version']).split('\n').slice(0, 2),
      kernelRelease: run('uname', ['-r']),
    }
    throw new Error(`P3-10 DIAG ${JSON.stringify(diag, null, 2)}`)
  }, 2 * LOADER_SMOKE_TEST_TIMEOUT_MS)
})
