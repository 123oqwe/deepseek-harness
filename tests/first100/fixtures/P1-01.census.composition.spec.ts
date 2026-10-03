/**
 * CENSUS-1 — NEVER MERGE, dispatch only (B-519 step 2, plan 16c5a224 §1;
 * gate3 2026-10-03T01:45:41Z). For every shipped profile template, one
 * subprocess boots it through the shipped `runProfile` at the gate's shipped
 * default (`shadow`) and reports the shadow decisions the boot recorded
 * (`./loader/p1-01-census/driver.ts`). The stdin pipe stays open until the
 * driver exits, so the stdio apps do not end at end of input.
 *
 * Every case fails by design: its error message carries the template's census
 * as JSON, so the run's JSON report holds it.
 * @module tests/first100/fixtures/P1-01.census.composition
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { describe, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p1-01-census/driver.ts', import.meta.url))
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
 * Run the census driver for one template against a fresh Harness home.
 * @param template - a {@link PROFILE_TEMPLATES} name.
 * @returns the exit code and both streams.
 */
function runDriver(template: string): Promise<DriverRun> {
  const root = mkdtempSync(join(tmpdir(), 'p1-01-census-'))
  const launch = resolveExampleLaunch({
    srcBin: driver,
    configArgs: [template],
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

describe('CENSUS-1 (never merge): the shadow decisions each shipped profile template records at its shipped default', () => {
  for (const template of Object.keys(PROFILE_TEMPLATES)) {
    it(template, async () => {
      const run = await runDriver(template)
      const census = /P1-01-CENSUS (?<json>.+)/u.exec(run.stdout)?.groups?.json
        ?? `NO-REPORT ${JSON.stringify({ stderrTail: run.stderr.slice(-4000) })}`
      throw new Error(`P1-01-CENSUS ${template} exit=${String(run.code)} ${census}`)
    }, CASE_TIMEOUT_MS)
  }
})
