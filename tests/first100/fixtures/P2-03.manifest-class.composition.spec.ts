/**
 * A-443 under BLOCKED-315 closing condition 1, P2-03 acceptance[2]
 * (「无法分类副作用的动作默认高风险并要求审批。」): on the SHIPPED headless profile at its
 * shipped default preset, through the native path and the code-mode path, a
 * probe the risk gate cannot classify reaches an approval request, and the
 * manifest classifies each probe the way the risk gate does.
 *
 * The ruling the manifest cases state: the manifest's side-effect class is the
 * risk gate's class mapped by class, and its `requiresApproval` is what the
 * gate decides under the preset in force. Only one mapping is pinned here: a
 * probe the gate classifies `read` is recorded `read`.
 *
 * `./loader/p2-03-manifest-class/driver.ts` registers two probe tools that
 * differ only in whether they declare `riskDomainTags`, allows `run_code` and
 * rejects every other question, and reaches the probes by one model call each
 * (native) or from one `run_code` program (code mode). The cases read the root
 * session's log and the probes' own run counters.
 * @module tests/first100/fixtures/P2-03.manifest-class.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CLASSIFIED_TOOL,
  MANIFEST_CLASS_MODES,
  type ManifestClassMode,
  type ManifestClassReport,
  UNCLASSIFIED_TOOL,
} from './loader/p2-03-manifest-class/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-03-manifest-class/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

const reports = new Map<ManifestClassMode, ManifestClassReport>()
const failures = new Map<ManifestClassMode, string>()

beforeAll(async () => {
  // One mode failing to boot leaves the other readable.
  for (const mode of MANIFEST_CLASS_MODES) {
    try {
      const { stdout, stderr } = await runLoaderSmoke({
        label: `P2-03 manifest class: ${mode}`,
        tempDirPrefix: `p2-03-manifest-class-${mode}-`,
        binScript: driver,
        libBinScript: driver,
        configPath: overlay,
        // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
        binArgs: [overlay, mode],
        tsconfigPath: repoTsconfig,
      })
      const json = /P2-03-MANIFEST (?<json>.+)/u.exec(stdout)?.groups?.json
      if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
      reports.set(mode, JSON.parse(json) as ManifestClassReport)
    } catch (error: unknown) {
      failures.set(mode, error instanceof Error ? error.message : String(error))
    }
  }
}, MANIFEST_CLASS_MODES.length * LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * One mode's report, or the reason there is none.
 * @param mode - the mode.
 * @returns its report.
 */
function reported(mode: ManifestClassMode): ManifestClassReport {
  const report = reports.get(mode)
  if (report === undefined) throw new Error(failures.get(mode) ?? `no report for ${mode}`)
  return report
}

/**
 * One probe's manifests, reduced to the fields these cases read.
 * @param report - one mode's report.
 * @param tool - the probe.
 * @returns origin, class, classified and requiresApproval of each, in order.
 */
function manifestsOf(report: ManifestClassReport, tool: string): readonly (string | boolean)[][] {
  return report.manifests.filter(row => row.capability === tool)
    .map(row => [row.origin, row.sideEffectClass, row.classified, row.requiresApproval])
}

describe('BLOCKED-315 condition 1 on the native path: the manifest classifies a probe as the risk gate does', () => {
  it('a probe the gate classifies read is recorded classified, as read, and not requiring approval', () => {
    const report = reported('native')
    expect(manifestsOf(report, CLASSIFIED_TOOL), JSON.stringify(report)).toEqual([['native-tool-call', 'read', true, false]])
  })

  it('control: a probe the gate cannot classify is recorded unclassified and requiring approval', () => {
    const report = reported('native')
    expect(report.manifests.filter(row => row.capability === UNCLASSIFIED_TOOL).map(row => [row.origin, row.classified, row.requiresApproval]),
      JSON.stringify(report)).toEqual([['native-tool-call', false, true]])
  })
})

describe('BLOCKED-315 condition 1 on the code-mode path: approval for an unclassifiable probe, and the manifest as the risk gate classifies', () => {
  it('control: a program calling the probe declaring filesystem-read reaches no approval request, and the probe runs', () => {
    const report = reported('code-mode')
    const context = JSON.stringify(report)
    expect(report.riskGated.filter(row => row.actionId === CLASSIFIED_TOOL).map(row => [row.riskClass, row.preset, row.decision]), context)
      .toEqual([['read', 'workspace-write', 'allowed-by-preset']])
    expect(report.asked.filter(row => row.toolName === CLASSIFIED_TOOL), context).toEqual([])
    expect(report.runs.classified, context).toBe(1)
  })

  it('a program calling the probe declaring no risk domain tags reaches an approval request, and the probe is refused without running', () => {
    const report = reported('code-mode')
    const context = JSON.stringify(report)
    expect(report.asked.filter(row => row.toolName === UNCLASSIFIED_TOOL).map(row => row.outcome), context).toEqual(['rejected'])
    expect(report.riskGated.filter(row => row.actionId === UNCLASSIFIED_TOOL).map(row => [row.riskClass, row.preset, row.decision]), context)
      .toEqual([['security-sensitive', 'workspace-write', 'refused']])
    expect(report.runs.unclassified, context).toBe(0)
  })

  it('the code-mode manifest of a probe the gate classifies read is recorded classified, as read, and not requiring approval', () => {
    const report = reported('code-mode')
    expect(manifestsOf(report, CLASSIFIED_TOOL), JSON.stringify(report)).toEqual([['code-mode-embedded', 'read', true, false]])
  })

  it('control: the code-mode manifest of a probe the gate cannot classify is recorded unclassified and requiring approval', () => {
    const report = reported('code-mode')
    expect(report.manifests.filter(row => row.capability === UNCLASSIFIED_TOOL).map(row => [row.origin, row.classified, row.requiresApproval]),
      JSON.stringify(report)).toEqual([['code-mode-embedded', false, true]])
  })
})
