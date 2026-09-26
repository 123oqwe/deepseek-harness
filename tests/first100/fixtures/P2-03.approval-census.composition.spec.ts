/**
 * A-440's census under P2-03 acceptance[2] (「无法分类副作用的动作默认高风险并要求审批。」):
 * on each shipped template it boots, at the shipped default preset, what the
 * risk gate decides today for every tool the root agent can see, under every
 * preset the table carries.
 *
 * The ruling it measures against: a manifest's side-effect class is to be the
 * risk gate's own classification, so a tool the gate classifies gains no
 * approval and only one the gate cannot classify is asked about. The cases
 * assert the facts that reading rests on. The whole census, the unclassifiable
 * tools included, goes into each case's `meta.census`, which the JSON report
 * carries; nothing here asserts which tools are unclassifiable.
 *
 * `./loader/p2-03-approval-census/driver.ts` boots one template per process
 * and executes no tool: each decision is computed with the two calls
 * `gateActionRisk` makes, not observed from a call.
 * @module tests/first100/fixtures/P2-03.approval-census.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { CENSUS_TEMPLATES, type CensusReport, type CensusTemplate } from './loader/p2-03-approval-census/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-03-approval-census/driver.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The overlay each template boots under, each reused from the observation that wrote it. */
const OVERLAYS: Readonly<Record<CensusTemplate, string>> = {
  headless: fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url)),
  'sdk-minimal': fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url)),
}

const reports = new Map<CensusTemplate, CensusReport>()
const failures = new Map<CensusTemplate, string>()

beforeAll(async () => {
  // One template failing to boot leaves the other's census readable.
  for (const template of CENSUS_TEMPLATES) {
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: `P2-03 approval census: ${template}`,
        tempDirPrefix: `p2-03-approval-census-${template}-`,
        binScript: driver,
        libBinScript: driver,
        configPath: OVERLAYS[template],
        // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
        binArgs: [OVERLAYS[template], template],
        tsconfigPath: repoTsconfig,
      })
      const json = /P2-03-CENSUS (?<json>.+)/u.exec(stdout)?.groups?.json
      if (json === undefined) throw new Error(`the ${template} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
      reports.set(template, JSON.parse(json) as CensusReport)
    } catch (error: unknown) {
      failures.set(template, error instanceof Error ? error.message : String(error))
    }
  }
}, CENSUS_TEMPLATES.length * LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * One template's census, or the reason there is none.
 * @param template - the template.
 * @returns its report.
 */
function census(template: CensusTemplate): CensusReport {
  const report = reports.get(template)
  if (report === undefined) throw new Error(failures.get(template) ?? `no census for ${template}`)
  return report
}

describe('P2-03 acceptance[2]: what the risk gate decides today on the shipped templates, per tool and preset', () => {
  it('headless boots with the shipped preset table, runs its root agent under workspace-write, and shows more than ten tools', ({ task }) => {
    const report = census('headless')
    Object.assign(task.meta, { census: report })
    expect(report.presetsMounted).toBe(true)
    expect(report.presetNames).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
    expect(report.presetInForce).toBe('workspace-write')
    expect(report.tools.length, JSON.stringify(report.tools.map(tool => tool.name))).toBeGreaterThan(10)
  })

  it('on headless, no tool the risk gate classifies by a policy rule is asked about or refused under any shipped preset', () => {
    const report = census('headless')
    const classified = report.tools.filter(tool => tool.classification?.ground === 'policy-rule')
    expect(classified.length, JSON.stringify(report.tools)).toBeGreaterThan(0)
    const gated = classified.flatMap(tool => Object.entries(tool.decisions)
      .filter(([, decision]) => decision !== 'allowed-by-preset')
      .map(([preset, decision]) => `${tool.name}@${preset}: ${decision}`))
    expect(gated).toEqual([])
  })

  it('sdk-minimal mounts no permission presets, so the risk gate decides nothing for any of its tools', ({ task }) => {
    const report = census('sdk-minimal')
    Object.assign(task.meta, { census: report })
    expect(report.presetsMounted).toBe(false)
    expect(report.tools.length).toBeGreaterThan(0)
  })
})
