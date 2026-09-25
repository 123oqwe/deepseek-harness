/**
 * BLOCKED-322 closing condition 1 on the shipped headless launch: the launch
 * resolves at least one declared feature gate.
 *
 * One launch of `apps/cli/src/bin.ts --profile headless`, the path that
 * provides `featureGates` (`runProfile`), with
 * `./loader/p0-05-feature-gates/probe-plugin.ts` inserted by `--patch`; the
 * probe writes what the launch provides when it is applied. The model URL is
 * unreachable, so how the task ends is not read.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
const probePlugin = fileURLToPath(new URL('./loader/p0-05-feature-gates/probe-plugin.ts', import.meta.url))

/** Deadline for the launch. */
const LAUNCH_TIMEOUT_MS = 120_000

/** What the probe recorded. */
interface Probe {
  readonly provided: boolean
  readonly gates: readonly { readonly id: unknown; readonly state: unknown }[] | null
}

const probes: Probe[] = []
const homes: string[] = []

beforeAll(async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'dsh-a402-'))
  homes.push(dshHome)
  const out = join(dshHome, 'a402-feature-gates.json')
  const patch = join(dshHome, 'a402.patch.yml')
  writeFileSync(patch, `- insert:\n    - id: a402-feature-gate-probe\n      name: '${pathToFileURL(probePlugin).href}'\n`)
  const result = await execa(process.execPath, ['--import', 'tsx/esm', binScript, '--profile', 'headless', '--patch', patch, 'A-402: say ok.'], {
    cwd: repoRoot,
    env: {
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: 'a402-keyless',
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
      A402_OUT: out,
    },
    timeout: LAUNCH_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    reject: false,
  })
  if (!existsSync(out)) throw new Error(`the probe wrote nothing (exit ${String(result.exitCode)}); stderr tail:\n${result.stderr.slice(-800)}`)
  probes.push(JSON.parse(readFileSync(out, 'utf8')) as Probe)
}, LAUNCH_TIMEOUT_MS + 15_000)

afterAll(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('BLOCKED-322 condition 1: the shipped headless launch resolves a declared feature gate', () => {
  it('control: the launch provides featureGates, and the probe read a list of gates', () => {
    expect(probes[0]?.provided).toBe(true)
    expect(Array.isArray(probes[0]?.gates)).toBe(true)
  })

  it('resolves at least one feature gate, each to off, shadow or enforce', () => {
    const gates = probes[0]?.gates ?? []
    expect(gates.length, JSON.stringify(gates)).toBeGreaterThan(0)
    for (const gate of gates) expect(['off', 'shadow', 'enforce'], JSON.stringify(gate)).toContain(gate.state)
  })
})
