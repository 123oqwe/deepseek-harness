/**
 * A-391's measurement on the shipped headless composition: does a plugin's
 * `ctx.logger` output reach stderr or any file an operator could read. A
 * measurement, not an acceptance case: the only assertion is that the driver
 * reported; the readings go into `task.meta.a391`, which the JSON reporter
 * carries.
 *
 * `../fixtures/loader/logger-visibility/driver.ts` logs a marked warn and error
 * through the root context's logger and makes `capability-token-file` log
 * "got no token" by leaving its store unwritable for the session's first
 * issuance. This file then looks for either text on stderr, on stdout outside
 * the driver's own report line, and in every text file under the run's
 * working directory.
 * @module tests/first100/measure/logger-visibility
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('../fixtures/loader/logger-visibility/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../fixtures/loader/logger-visibility/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The texts looked for: the driver's marker and `capability-token-file`'s failed-issuance line. */
const SOUGHT = /A391-LOGGER-MARKER|got no token/u

/** Largest file the working-directory scan reads. */
const SCAN_LIMIT_BYTES = 8 * 1024 * 1024

/**
 * Every line holding a sought text in the text files under a directory. Files
 * holding a NUL byte and files over {@link SCAN_LIMIT_BYTES} are skipped.
 * @param root - the run's working directory.
 * @returns the lines, each prefixed with its file's path relative to `root`.
 */
async function soughtLinesUnder(root: string): Promise<string[]> {
  const lines: string[] = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if ((await stat(path)).size > SCAN_LIMIT_BYTES) continue
    const content = await readFile(path)
    if (content.includes(0)) continue
    for (const line of content.toString('utf8').split('\n')) {
      if (SOUGHT.test(line)) lines.push(`${relative(root, path)}: ${line.slice(0, 600)}`)
    }
  }
  return lines
}

describe('A-391 measurement: plugin logger output on the shipped headless profile', () => {
  it('records where the marked lines and the failed-issuance line can be read', async ({ task }) => {
    const fileLines: string[] = []
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'A-391 logger-visibility measurement',
      tempDirPrefix: 'logger-visibility-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => { fileLines.push(...await soughtLinesUnder(cwd)) },
    })
    const json = /A391-LOGGER (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    const report = JSON.parse(json) as Record<string, unknown>
    Object.assign(task.meta, {
      a391: {
        report,
        stderrLines: stderr.split('\n').filter(line => SOUGHT.test(line)).map(line => line.slice(0, 600)),
        stdoutLines: stdout.split('\n').filter(line => !line.startsWith('A391-LOGGER ') && SOUGHT.test(line)).map(line => line.slice(0, 600)),
        fileLines,
      },
    })
    expect(report.exporters).toBeTypeOf('object')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
