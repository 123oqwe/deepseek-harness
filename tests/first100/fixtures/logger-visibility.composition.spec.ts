/**
 * BLOCKED-336 on the shipped headless composition: by default, what a plugin
 * writes through `ctx.logger` reaches an operator-visible channel, and
 * machine-readable stdout stays clean.
 *
 * `./loader/logger-visibility/driver.ts` logs a marked error through the root
 * context's logger and makes `capability-token-file` log "got no token" by
 * leaving its store unwritable for the session's first issuance. The cases
 * look for both lines on stderr, and in the text files under the run's
 * working directory (which holds `DSH_HOME`) whose name the process printed on
 * stderr, the way a log file named at startup would be.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/logger-visibility/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/logger-visibility/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The marked error the driver logs through the root context's logger. */
const MARKED_ERROR = /A391-LOGGER-MARKER: an error/u
/** The first argument of `capability-token-file`'s log line for a failed issuance. */
const NO_TOKEN = /got no token/u
/** The driver's own report line on stdout. */
const REPORT_PREFIX = 'A391-LOGGER '

/** Largest file the working-directory scan reads. */
const SCAN_LIMIT_BYTES = 8 * 1024 * 1024

/** One line of a text file the run left, and the file's path relative to the working directory. */
interface FileLine {
  readonly path: string
  readonly line: string
}

/** What one run left behind, as far as these cases read it. */
interface Observation {
  readonly stdout: string
  readonly stderr: string
  readonly fileLines: readonly FileLine[]
  readonly report: {
    readonly toolResults?: readonly string[]
    readonly buffered?: readonly { readonly type?: unknown; readonly first?: unknown }[]
  }
}

/**
 * Every line holding one of the two sought texts in the text files under a
 * directory. Files holding a NUL byte and files over {@link SCAN_LIMIT_BYTES}
 * are skipped.
 * @param root - the run's working directory.
 * @returns the lines with their files' relative paths.
 */
async function soughtLinesUnder(root: string): Promise<FileLine[]> {
  const lines: FileLine[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if ((await stat(path)).size > SCAN_LIMIT_BYTES) continue
    const content = await readFile(path)
    if (content.includes(0)) continue
    for (const line of content.toString('utf8').split('\n')) {
      if (MARKED_ERROR.test(line) || NO_TOKEN.test(line)) lines.push({ path: relative(root, path), line })
    }
  }
  return lines
}

/**
 * Whether a text reached an operator-visible channel: stderr, or a file the
 * process named on stderr.
 * @param observation - what the run left behind.
 * @param text - the sought text.
 * @returns whether it was found there.
 */
function visible(observation: Observation, text: RegExp): boolean {
  if (observation.stderr.split('\n').some(line => text.test(line))) return true
  return observation.fileLines.some(({ path, line }) => text.test(line) && observation.stderr.includes(basename(path)))
}

describe('BLOCKED-336: plugin logger output on the shipped headless profile reaches an operator by default, and stdout stays clean', () => {
  const observations: Observation[] = []
  beforeAll(async () => {
    const fileLines: FileLine[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'BLOCKED-336 observation: logger visibility',
      tempDirPrefix: 'logger-visibility-case-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => { fileLines.push(...await soughtLinesUnder(cwd)) },
    })
    const json = /A391-LOGGER (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    observations.push({ stdout, stderr, fileLines, report: JSON.parse(json) as Observation['report'] })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: capability-token-file really logged a failed issuance, and both lines reached the logger', () => {
    const report = observations[0]?.report
    expect(report?.toolResults?.some(result => result.includes('issuance failed')), JSON.stringify(report?.toolResults)).toBe(true)
    const firsts = (report?.buffered ?? []).map(message => String(message.first))
    expect(firsts.some(first => MARKED_ERROR.test(first)), JSON.stringify(firsts)).toBe(true)
    expect(firsts.some(first => NO_TOKEN.test(first)), JSON.stringify(firsts)).toBe(true)
  })

  it('the marked error reaches stderr or a log file named on stderr', () => {
    const observation = observations[0]
    expect(observation !== undefined && visible(observation, MARKED_ERROR), JSON.stringify(observation?.fileLines)).toBe(true)
  })

  it('the failed-issuance line reaches stderr or a log file named on stderr', () => {
    const observation = observations[0]
    expect(observation !== undefined && visible(observation, NO_TOKEN), JSON.stringify(observation?.fileLines)).toBe(true)
  })

  it('stdout carries no logger output: apart from the driver report, no stdout line holds either line', () => {
    const lines = (observations[0]?.stdout ?? '').split('\n').filter(line => !line.startsWith(REPORT_PREFIX))
    expect(lines.filter(line => MARKED_ERROR.test(line) || NO_TOKEN.test(line))).toEqual([])
  })
})
