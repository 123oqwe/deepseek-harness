/**
 * BLOCKED-336 under the delegate's fix (A): on every shipped host, what a
 * plugin writes through `ctx.logger` reaches stderr by default as whole lines
 * that start with `dsh: `, never inside a reasoning segment the headless
 * runner is streaming, and machine-readable stdout stays clean.
 *
 * Each host is a real process: `apps/cli/src/bin.ts` under tsx with
 * `./loader/logger-stderr/marker-plugin.ts` inserted by `--patch`, a temporary
 * `DSH_HOME` and a placeholder key. Headless runs one task against the
 * scripted model server. Its first answer calls `read`; the test makes the
 * capability-token store's directory read-only when that request arrives, so
 * the session's token cannot be recorded and `capability-token-file` logs
 * "got no token". Its second answer streams reasoning in two deltas, and the
 * marker plugin logs a pair when the second arrives. ACP, SDK and Web start
 * with no request and are stopped once the plugin's late pair is logged, as
 * A-394 measured them.
 *
 * The Web host is the shipped `web` profile with one added overlay that
 * disables its `modules` (client-modules) and `client-hmr` rows. Those two
 * rows compose the browser plugin bundles: client-modules reads each
 * `dsh.client` package's built `lib/client.js` at construction and throws
 * `MissingClientBundleError` when it is absent, and client-hmr injects
 * `clientModules`. This corpus lane runs the suite before the official client
 * build (that build is `if: narrow_build` in first100-exact-sha.yml), so the
 * bundles do not exist; without the overlay the real web host's boot audit
 * (`assertEntriesActivated`) rejects the FAILED client-modules fiber and the
 * process exits 1 before the late pair is logged. The overlay removes only the
 * browser-asset composition — the whole real server stack (webserver, gateway,
 * connection, session and workspace controllers) still boots and runs the
 * marker plugin, so what reaches this real process's stdout and stderr is
 * unchanged. Only the Web host adds it; nothing else consumes `clientModules`.
 * Not covered: with those two rows off the Web host composes and serves no
 * browser bundle, so this file observes the Web host only with its browser-asset
 * composition disabled, never the bundle route or index injection.
 * @module tests/first100/fixtures/logger-stderr.hosts.composition
 */

import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { execa } from 'execa'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  LOGGER_MARKER,
  markedLine,
  type MarkerPhase,
  PAIR_TEXTS,
  REASONING_CHUNK_SIZE,
  REASONING_TEXT,
} from './loader/logger-stderr/shared.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const markerPlugin = fileURLToPath(new URL('./loader/logger-stderr/marker-plugin.ts', import.meta.url))

/** Deadline for one host process. */
const HOST_TIMEOUT_MS = 150_000
/** Longest wait for a server host's late pair. */
const SENTINEL_WAIT_MS = 90_000
/** How long to wait after the late pair before stopping a server host. */
const SETTLE_MS = 1_000
/** How long a SIGTERM may take before SIGKILL. */
const TERM_GRACE_MS = 10_000
/** The line the headless runner opens each reasoning segment with. */
const REASONING_HEADER = 'dsh: reasoning:'
/** Text only the scripted reasoning carries. */
const REASONING_WORD = 'A393-REASONING'
/** The final answer the scripted model gives on headless. */
const FINAL_ANSWER = 'A393 final answer'
/** The first argument of `capability-token-file`'s log line for a failed issuance. */
const NO_TOKEN = 'got no token'

/** The argv after `bin.ts` for each server host, given the assembled `--patch` arguments. */
const SERVER_HOSTS = {
  acp: (patchArgs: readonly string[]): string[] => ['--profile', 'acp', ...patchArgs],
  sdk: (patchArgs: readonly string[]): string[] => ['--profile', 'sdk', ...patchArgs],
  web: (patchArgs: readonly string[]): string[] => ['web', ...patchArgs, '--host', '127.0.0.1', '--port', '0', '--no-open'],
} as const

/** A shipped host started with no request. */
type ServerHost = keyof typeof SERVER_HOSTS

/** What one host process left. */
interface HostRun {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** The phases the marker plugin recorded, in order. */
  readonly phases: readonly string[]
  /** Every request body the scripted model server received, serialized; empty for a server host. */
  readonly requestBodies: readonly string[]
}

/**
 * Write the patch that inserts the marker plugin.
 * @param home - the run's `DSH_HOME`.
 * @returns the patch path.
 */
async function writeMarkerPatch(home: string): Promise<string> {
  const patch = join(home, 'a393.patch.yml')
  await writeFile(patch, `- insert:\n    - id: a393-logger-marker\n      name: '${pathToFileURL(markerPlugin).href}'\n`)
  return patch
}

/**
 * Write the Web-only overlay that disables the browser-bundle composition, so
 * the shipped `web` profile boots when no built client bundle exists (this
 * corpus lane runs before the official client build). `modules`
 * (client-modules) is the sole reader of each `dsh.client` package's
 * `lib/client.js`; `client-hmr` is disabled with it because it injects
 * `clientModules`. Nothing else consumes that service, so the rest of the real
 * web server stack boots unchanged.
 * @param home - the run's `DSH_HOME`.
 * @returns the patch path.
 */
async function writeWebBundleOffPatch(home: string): Promise<string> {
  const patch = join(home, 'a393-web-bundle-off.patch.yml')
  await writeFile(patch, '- id: modules\n  disabled: true\n\n- id: client-hmr\n  disabled: true\n')
  return patch
}

/**
 * The phases the sentinel file has recorded so far.
 * @param sentinel - the sentinel path.
 * @returns each recorded phase, in order.
 */
async function phasesIn(sentinel: string): Promise<string[]> {
  if (!existsSync(sentinel)) return []
  return (await readFile(sentinel, 'utf8')).split('\n').filter(line => line !== '')
}

/**
 * The environment a host runs under.
 * @param home - the run's `DSH_HOME`.
 * @param sentinel - the marker plugin's sentinel path.
 * @param baseUrl - the model URL.
 * @returns the variables to set.
 */
function hostEnv(home: string, sentinel: string, baseUrl: string): NodeJS.ProcessEnv {
  return {
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    DEEPSEEK_API_KEY: 'a393-keyless',
    DEEPSEEK_BASE_URL: baseUrl,
    A393_SENTINEL: sentinel,
  }
}

/**
 * Run one headless task against the scripted model server.
 * @returns what the process left.
 */
async function runHeadless(): Promise<HostRun> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-a393-headless-'))
  // The shipped `capability-tokens` row stores under `dshHomePath('capability-tokens')`.
  const tokenDirectory = join(home, 'capability-tokens')
  await mkdir(tokenDirectory, { recursive: true })
  const server = await startMockLlmServer({
    sequence: ['tool_call_success', 'reasoning_success'],
    repeatLast: true,
    toolName: 'read',
    toolArguments: JSON.stringify({ file_path: 'package.json' }),
    reasoningText: REASONING_TEXT,
    chunkSize: REASONING_CHUNK_SIZE,
    successText: FINAL_ANSWER,
    onEvent: (event) => {
      // From the first request on, the session's first token can no longer be recorded.
      if (event.type !== 'request' || event.attempt !== 1) return
      for (const file of readdirSync(tokenDirectory)) chmodSync(join(tokenDirectory, file), 0o400)
      chmodSync(tokenDirectory, 0o500)
    },
  })
  try {
    const sentinel = join(home, 'a393-sentinel.txt')
    const patch = await writeMarkerPatch(home)
    const task = 'A-393: read package.json once, then answer.'
    const result = await execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'headless', '--patch', patch, task], {
      cwd: repoRoot,
      env: hostEnv(home, sentinel, server.baseURL),
      timeout: HOST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
    })
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      phases: await phasesIn(sentinel),
      requestBodies: server.requests.map(request => JSON.stringify(request.body)),
    }
  } finally {
    await server.close()
    await chmod(tokenDirectory, 0o700)
    await rm(home, { recursive: true, force: true })
  }
}

/**
 * Start one server host with no request, and stop it once the marker plugin's late pair is logged.
 * @param host - the shipped host.
 * @returns what the process left.
 */
async function runServerHost(host: ServerHost): Promise<HostRun> {
  const home = await mkdtemp(join(tmpdir(), `dsh-a393-${host}-`))
  try {
    const sentinel = join(home, 'a393-sentinel.txt')
    const patchArgs = ['--patch', await writeMarkerPatch(home)]
    if (host === 'web') patchArgs.push('--patch', await writeWebBundleOffPatch(home))
    const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, ...SERVER_HOSTS[host](patchArgs)], {
      cwd: repoRoot,
      env: hostEnv(home, sentinel, 'http://127.0.0.1:9'),
      timeout: HOST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const exit = { done: false }
    void child.finally(() => { exit.done = true })
    const deadline = Date.now() + SENTINEL_WAIT_MS
    while (!exit.done && Date.now() < deadline && !(await phasesIn(sentinel)).includes('late')) await delay(50)
    if (!exit.done) {
      await delay(SETTLE_MS)
      child.kill('SIGTERM')
      const escalate = setTimeout(() => { child.kill('SIGKILL') }, TERM_GRACE_MS)
      await child
      clearTimeout(escalate)
    }
    const result = await child
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      phases: await phasesIn(sentinel),
      requestBodies: [],
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

/**
 * The marked lines of the given phases that stderr does not carry as a whole line starting with `dsh: `.
 * @param stderr - the process's stderr.
 * @param phases - the phases whose pairs are expected.
 * @returns the missing lines' texts.
 */
function missingOnStderr(stderr: string, phases: readonly MarkerPhase[]): string[] {
  const lines = stderr.split('\n')
  return phases.flatMap(phase => PAIR_TEXTS.map(text => markedLine(phase, text)))
    .filter(expected => !lines.some(line => line.startsWith('dsh: ') && line.includes(expected)))
}

/**
 * Where a marked line lands inside a reasoning segment: it shares a line with
 * other output, or reasoning text follows it before a new segment header does.
 * @param stderr - the process's stderr.
 * @returns one description per violation.
 */
function interruptedSegments(stderr: string): string[] {
  const lines = stderr.split('\n')
  return lines.flatMap((line, index) => {
    if (!line.includes(LOGGER_MARKER)) return []
    const problems: string[] = []
    if (!line.startsWith('dsh: ') || line.includes(REASONING_WORD)) problems.push(`line ${index} shares a line with other output: ${line}`)
    const next = lines.slice(index + 1).find(later => later === REASONING_HEADER || later.includes(REASONING_WORD))
    if (next !== undefined && next !== REASONING_HEADER) problems.push(`line ${index} is followed by reasoning with no new header: ${line}`)
    return problems
  })
}

describe('BLOCKED-336 fix (A) on headless: plugin logger lines reach stderr as whole dsh: lines outside reasoning segments', () => {
  let run: HostRun | undefined
  beforeAll(async () => { run = await runHeadless() }, HOST_TIMEOUT_MS + 30_000)

  /**
   * The headless run, or the reason there is none.
   * @returns the run.
   */
  function reading(): HostRun {
    if (run === undefined) throw new Error('the headless run left nothing')
    return run
  }

  it('control: the marker plugin logged its apply and reasoning pairs, and the session token issuance really failed', () => {
    const { phases, requestBodies, stderr } = reading()
    expect(phases, stderr.slice(-1500)).toEqual(expect.arrayContaining(['apply', 'reasoning']))
    expect(requestBodies.some(body => body.includes('issuance failed')), requestBodies.join('\n').slice(-1500)).toBe(true)
  })

  it('the apply and reasoning pairs reach stderr, each as a line starting with dsh: ', () => {
    const { stderr } = reading()
    expect(missingOnStderr(stderr, ['apply', 'reasoning']), stderr.slice(-1500)).toEqual([])
  })

  it('the failed-issuance line of capability-token-file reaches stderr as a line starting with dsh: ', () => {
    const { stderr } = reading()
    expect(stderr.split('\n').some(line => line.startsWith('dsh: ') && line.includes(NO_TOKEN)), stderr.slice(-1500)).toBe(true)
  })

  it('no plugin logger line lands inside a reasoning segment', () => {
    const { stderr } = reading()
    expect(stderr.split('\n').some(line => line.includes(markedLine('reasoning', PAIR_TEXTS[0]))), stderr.slice(-1500)).toBe(true)
    expect(interruptedSegments(stderr), stderr.slice(-1500)).toEqual([])
  })

  it('stdout carries only the final answer', () => {
    const { stdout, stderr } = reading()
    expect(stdout.split('\n').filter(line => line !== ''), stderr.slice(-1500)).toEqual([FINAL_ANSWER])
  })
})

for (const host of ['acp', 'sdk', 'web'] as const) {
  describe(`BLOCKED-336 fix (A) on ${host}: plugin logger lines reach stderr as whole dsh: lines`, () => {
    let run: HostRun | undefined
    beforeAll(async () => { run = await runServerHost(host) }, HOST_TIMEOUT_MS + 30_000)

    /**
     * This host's run, or the reason there is none.
     * @returns the run.
     */
    function reading(): HostRun {
      if (run === undefined) throw new Error(`the ${host} run left nothing`)
      return run
    }

    it(`control: the marker plugin logged its apply and late pairs on ${host}`, () => {
      const { phases, stderr, exitCode } = reading()
      expect(phases, `exit ${String(exitCode)}; ${stderr.slice(-1500)}`).toEqual(expect.arrayContaining(['apply', 'late']))
    })

    it(`the apply and late pairs reach ${host} stderr, each as a line starting with dsh: `, () => {
      const { stderr } = reading()
      expect(missingOnStderr(stderr, ['apply', 'late']), stderr.slice(-1500)).toEqual([])
    })

    it(`${host} stdout carries no plugin logger line`, () => {
      const { stdout } = reading()
      expect(stdout.split('\n').filter(line => line.includes(LOGGER_MARKER))).toEqual([])
    })
  })
}
