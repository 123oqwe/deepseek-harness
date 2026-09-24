/**
 * BLOCKED-334 (P4-07 acceptance[0], P2-12 must[2]) on the shipped headless
 * composition: a tool call the risk gate asked an operator about must not run
 * once approved if, while the operator was asked, the Run was fenced or an
 * emergency stop was raised, and its result must say which.
 *
 * `./loader/p4-07-ask-window/driver.ts` boots the SHIPPED headless profile
 * with the Trust Kernel pinned and runs one turn in which the model calls a
 * probe tool that declares no risk domain tags, so the risk gate asks about
 * it. Before approving, the operator does nothing (`control`), lets another
 * worker take the Run's lease over after it expires (`fence`), or raises
 * `pause-new-actions` (`stop`). Each describe runs the three on one dispatch
 * path: native, or code mode, where the model's `run_code` program makes the
 * probe call and returns the refusal's message.
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-07-ask-window/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-07-ask-window/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the operator read and did at the approval, as far as these cases read it. */
interface Approval {
  readonly action: { readonly acquired?: unknown }
  readonly after: { readonly mayWrite?: unknown; readonly stopGate?: unknown }
}

/** What the driver reported, as far as these cases read it. */
interface Report {
  readonly probeRan: boolean
  readonly toolResults: readonly string[]
  readonly atApproval: readonly Approval[]
}

/**
 * Run the driver once.
 * @param mode - what the operator does before approving.
 * @param path - the dispatch path.
 * @returns the driver's report.
 */
async function observe(mode: 'control' | 'fence' | 'stop', path: 'native' | 'ptc'): Promise<Report> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `BLOCKED-334 observation: ${mode} on ${path}`,
    tempDirPrefix: `p4-07-ask-window-${mode}-${path}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode, path],
    tsconfigPath: repoTsconfig,
  })
  const json = /P4-07-ASK (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} ${path} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as Report
}

for (const path of ['native', 'ptc'] as const) {
  describe(`BLOCKED-334 on the ${path === 'native' ? 'native' : 'code-mode'} path: an approved call whose Run was fenced or stopped while the operator was asked`, () => {
    const reports = new Map<string, Report>()
    beforeAll(async () => {
      for (const mode of ['control', 'fence', 'stop'] as const) reports.set(mode, await observe(mode, path))
    }, 3 * LOADER_SMOKE_TEST_TIMEOUT_MS)

    it('control: with nothing happening during the ask the call runs, and the fence and the stop take hold before the operator answers', () => {
      expect(reports.get('control')?.probeRan).toBe(true)
      expect(reports.get('fence')?.atApproval[0]?.action.acquired).toBe(true)
      expect(reports.get('fence')?.atApproval[0]?.after.mayWrite).toBe(false)
      expect(reports.get('stop')?.atApproval[0]?.after.stopGate).toBe('stopped')
    })

    it('fence: once the operator approves, the call does not run', () => {
      expect(reports.get('fence')?.probeRan).toBe(false)
    })

    it('fence: the call\'s result says the Run was fenced', () => {
      const results = reports.get('fence')?.toolResults ?? []
      expect(results.some(result => /fenced|another host took it over/iu.test(result)), JSON.stringify(results)).toBe(true)
    })

    it('stop: once the operator approves, the call does not run', () => {
      expect(reports.get('stop')?.probeRan).toBe(false)
    })

    it('stop: the call\'s result says an emergency stop is in force', () => {
      const results = reports.get('stop')?.toolResults ?? []
      expect(results.some(result => /stopped|emergency stop/iu.test(result)), JSON.stringify(results)).toBe(true)
    })
  })
}
