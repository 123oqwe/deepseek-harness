/**
 * A-394's measurement for BLOCKED-336 closing condition 3: where the ACP, SDK
 * and Web hosts send a plugin's `ctx.logger` warn and error, and whether an
 * operator can see them. A measurement, not an acceptance case: the only
 * assertion is that the marker plugin ran twice; the readings go into
 * `task.meta.a394`, which the JSON reporter carries.
 *
 * Each case launches `apps/cli/src/bin.ts` for one shipped host with
 * `../fixtures/loader/logger-visibility-hosts/marker-plugin.ts` inserted by
 * `--patch`, a temporary `DSH_HOME`, a placeholder key and an unreachable
 * model URL, and stdin left open with no request sent. Once the plugin's
 * second pair is logged it waits a second more, then stops the process with
 * SIGTERM (SIGKILL after a grace period), and looks for the marker on stdout,
 * on stderr, in every text file under `DSH_HOME`, and in every `.log` file
 * whose absolute path stderr printed.
 * @module tests/first100/measure/logger-visibility-hosts
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const markerPlugin = fileURLToPath(new URL('../fixtures/loader/logger-visibility-hosts/marker-plugin.ts', import.meta.url))

/** The text every marked line carries. */
const MARKER = /A394-LOGGER-MARKER/u
/** Deadline for one host process. */
const HOST_TIMEOUT_MS = 150_000
/** Longest wait for the plugin's second pair. */
const SENTINEL_WAIT_MS = 90_000
/** How long to wait after the second pair before stopping the host. */
const SETTLE_MS = 1_000
/** How long a SIGTERM may take before SIGKILL. */
const TERM_GRACE_MS = 10_000
/** Largest file the scan reads. */
const SCAN_LIMIT_BYTES = 8 * 1024 * 1024

/** The argv after `bin.ts` for each host, before the patch. */
const HOSTS = {
  acp: (patch: string): string[] => ['--profile', 'acp', '--patch', patch],
  sdk: (patch: string): string[] => ['--profile', 'sdk', '--patch', patch],
  web: (patch: string): string[] => ['web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'],
} as const

/** One line of a file, and where the file is. */
interface FileLine {
  readonly path: string
  readonly line: string
}

/**
 * Every marked line in the text files under a directory. Files holding a NUL
 * byte and files over {@link SCAN_LIMIT_BYTES} are skipped.
 * @param root - the directory.
 * @returns the lines with their files' paths relative to `root`.
 */
async function markedLinesUnder(root: string): Promise<FileLine[]> {
  const lines: FileLine[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if ((await stat(path)).size > SCAN_LIMIT_BYTES) continue
    const content = await readFile(path)
    if (content.includes(0)) continue
    for (const line of content.toString('utf8').split('\n')) {
      if (MARKER.test(line)) lines.push({ path: relative(root, path), line: line.slice(0, 400) })
    }
  }
  return lines
}

/**
 * Launch one host with the marker plugin and read where the marked lines went.
 * @param host - the shipped host.
 * @returns the reading.
 */
async function observe(host: keyof typeof HOSTS): Promise<Record<string, unknown>> {
  const dshHome = await mkdtemp(join(tmpdir(), `dsh-a394-${host}-`))
  try {
    const sentinel = join(dshHome, 'a394-sentinel.jsonl')
    const patch = join(dshHome, 'a394.patch.yml')
    await writeFile(patch, `- insert:\n    - id: a394-logger-marker\n      name: '${pathToFileURL(markerPlugin).href}'\n`)
    const child = execa(process.execPath, ['--import', 'tsx/esm', binScript, ...HOSTS[host](patch)], {
      cwd: repoRoot,
      env: {
        DSH_HOME: dshHome,
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: 'a394-keyless',
        DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
        A394_SENTINEL: sentinel,
      },
      timeout: HOST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const exit = { done: false }
    void child.finally(() => { exit.done = true })
    /**
     * The phases the sentinel has recorded so far.
     * @returns each recorded line, parsed.
     */
    const phases = async (): Promise<{ readonly phase?: unknown; readonly exporters?: unknown }[]> => {
      if (!existsSync(sentinel)) return []
      return (await readFile(sentinel, 'utf8')).split('\n').filter(line => line !== '')
        .map(line => JSON.parse(line) as { readonly phase?: unknown; readonly exporters?: unknown })
    }
    const deadline = Date.now() + SENTINEL_WAIT_MS
    while (!exit.done && Date.now() < deadline && !(await phases()).some(entry => entry.phase === 'late')) await delay(50)
    if (!exit.done) {
      await delay(SETTLE_MS)
      child.kill('SIGTERM')
      const escalate = setTimeout(() => { child.kill('SIGKILL') }, TERM_GRACE_MS)
      await child
      clearTimeout(escalate)
    }
    const result = await child
    const namedLogs = [...new Set([...stderr.matchAll(/(\/[^\s'"]+\.log)\b/gu)].map(match => match[1] ?? ''))].filter(path => path !== '')
    const namedLogLines: FileLine[] = []
    for (const path of namedLogs) {
      if (!existsSync(path) || (await stat(path)).size > SCAN_LIMIT_BYTES) continue
      for (const line of (await readFile(path, 'utf8')).split('\n')) {
        if (MARKER.test(line)) namedLogLines.push({ path, line: line.slice(0, 400) })
      }
    }
    return {
      host,
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      sentinel: await phases(),
      stdoutMarkedLines: stdout.split('\n').filter(line => MARKER.test(line)).map(line => line.slice(0, 400)),
      stderrMarkedLines: stderr.split('\n').filter(line => MARKER.test(line)).map(line => line.slice(0, 400)),
      homeMarkedLines: await markedLinesUnder(dshHome),
      namedLogs,
      namedLogLines,
      stdoutBytes: stdout.length,
      stderrTail: stderr.slice(-800),
    }
  } finally {
    await rm(dshHome, { recursive: true, force: true })
  }
}

describe('A-394 measurement: where the shipped ACP, SDK and Web hosts send a plugin logger warn and error', () => {
  for (const host of ['acp', 'sdk', 'web'] as const) {
    it(`records the ${host} host`, async ({ task }) => {
      const reading = await observe(host)
      Object.assign(task.meta, { a394: reading })
      const phases = (reading.sentinel as readonly { readonly phase?: unknown }[]).map(entry => entry.phase)
      expect(phases, String(reading.stderrTail)).toContain('late')
    }, HOST_TIMEOUT_MS + 30_000)
  }
})
