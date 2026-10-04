/**
 * CENSUS-3 — NEVER MERGE, dispatch only (4i1b step 3; gate3
 * 2026-10-04T05:54:49Z Q3). For every group of published packages users mount
 * by a patch row, one subprocess boots the group's shipped template through the
 * shipped `runProfile` at the gate's shipped default (`shadow`), with the group
 * mounted by one more patch layer, and reports the shadow decisions the boot
 * recorded (`./loader/p1-01-census3/driver.ts`). Each package carries an empty
 * placeholder Manifest v2 in this commit, so the post-mount comparison lists
 * everything it registered. The stdin pipe stays open until the driver exits,
 * so the stdio apps do not end at end of input.
 *
 * Every case fails by design: its error message carries the group's census as
 * JSON, so the run's JSON report holds it.
 * @module tests/first100/fixtures/P1-01.census3.composition
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { describe, it } from 'vitest'
import { GROUPS } from './loader/p1-01-census3/groups.ts'

const driver = fileURLToPath(new URL('./loader/p1-01-census3/driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** Case deadline; the driver is killed ten seconds before it. */
const CASE_TIMEOUT_MS = 180_000

/** One driver run's exit code and output. */
interface DriverRun {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run the census driver for one group against a fresh Harness home.
 * @param group - a {@link GROUPS} name.
 * @returns the exit code and both streams.
 */
function runDriver(group: string): Promise<DriverRun> {
  const root = mkdtempSync(join(tmpdir(), 'p1-01-census3-'))
  const launch = resolveExampleLaunch({
    srcBin: driver,
    configArgs: [group],
    mode: 'src',
    tsconfigPath,
    env: { DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents') },
  })
  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, CASE_TIMEOUT_MS - 10_000)
    child.on('close', (code) => {
      clearTimeout(deadline)
      rmSync(root, { recursive: true, force: true })
      resolve({ code, stdout, stderr })
    })
  })
}

describe('CENSUS-3 (never merge): what each patch-mounted published package registers, under an empty placeholder manifest', () => {
  for (const group of Object.keys(GROUPS)) {
    it(group, async () => {
      const run = await runDriver(group)
      const census = /P1-01-CENSUS3 (?<json>.+)/u.exec(run.stdout)?.groups?.json
        ?? `NO-REPORT ${JSON.stringify({ stderrTail: run.stderr.slice(-4000) })}`
      throw new Error(`P1-01-CENSUS3 ${group} exit=${String(run.code)} ${census}`)
    }, CASE_TIMEOUT_MS)
  }
})
