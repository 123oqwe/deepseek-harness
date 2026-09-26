/**
 * B-668, the P2-06 red first (BLOCKED-318): acceptance[0] as C19 narrowed it,
 * acceptance[1] and acceptance[2], on the shipped headless profile.
 *
 * `./loader/p2-06-approval-precondition/driver.ts` boots the SHIPPED headless
 * profile over the originator cases' overlay with a keyless scripted model and
 * a probe tool that declares the file it acts on in `presentCall().locations`
 * and no risk domain tags, so the risk gate asks about every call. The
 * operator tells the calls apart by the action id each approval is bound to,
 * and allows the first ask about each call after leaving its file alone,
 * rewriting it, or creating it. `native` calls the probe directly, once per
 * file; `code-mode` calls it from one `run_code` program on the unchanged file
 * and then on the changed one. This file creates the working directory both
 * modes share and writes the files that exist before the asks.
 *
 * Red today on the three changed-file cases: both dispatch paths bind an
 * approval with no precondition, so the re-verification before execution does
 * not see the file. Red today as well on the code-mode display case (B-670):
 * a sub-call's approval request carries no display. The rest are green today
 * and after the fix.
 * @module tests/first100/fixtures/P2-06.approval-precondition.composition
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  actionIdOf,
  type FileKind,
  PRECONDITION_MODES,
  type PreconditionMode,
  type PreconditionReport,
  probeFile,
  SECRET,
} from './loader/p2-06-approval-precondition/shared.ts'

/** The six fields must[0] requires a decider to see, as `ApprovalDisplay` declares them, sorted. */
const DISPLAY_FIELDS = ['arguments', 'expectedDiff', 'expiresAtMs', 'manifestDigest', 'resource', 'riskClass']

const driver = fileURLToPath(new URL('./loader/p2-06-approval-precondition/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/**
 * Run the driver once.
 * @param mode - the dispatch path.
 * @param workspace - the working directory both modes share.
 * @returns the driver's report.
 */
async function run(mode: PreconditionMode, workspace: string): Promise<PreconditionReport> {
  const { stdout, stderr } = await runLoaderSmoke({
    label: `P2-06 approval precondition: ${mode}`,
    tempDirPrefix: `p2-06-approval-precondition-${mode}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay, mode, workspace],
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-06-PRECONDITION (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  return JSON.parse(json) as PreconditionReport
}

/**
 * The runs of the probe's body on one declared file.
 * @param report - one mode's report.
 * @param mode - that mode.
 * @param kind - which file.
 * @returns the runs, empty when the body never ran on it.
 */
function runsOn(report: PreconditionReport | undefined, mode: PreconditionMode, kind: FileKind): readonly { readonly callId: string; readonly file: string }[] {
  return report?.runs.filter(entry => entry.file === probeFile(mode, kind)) ?? []
}

/**
 * Whether the operator was asked about the probe call on one declared file.
 * @param report - one mode's report.
 * @param mode - that mode.
 * @param kind - which file.
 * @returns true when at least one ask was bound to that call's action id.
 */
function askedAbout(report: PreconditionReport | undefined, mode: PreconditionMode, kind: FileKind): boolean {
  return report?.asked.some(entry => entry.actionId === actionIdOf(mode, kind)) ?? false
}

/**
 * The approvals an action id finds, and the decision of the one it finds.
 * @param report - one mode's report.
 * @param actionId - the id of an action that ran.
 * @returns how many `approval/bound` events name the id, and the outcome when exactly one does.
 */
function approvalOf(report: PreconditionReport | undefined, actionId: string | undefined): { bound: number; outcome: string | null } {
  const bound = report?.bound.filter(entry => entry.actionId === actionId) ?? []
  const only = bound.length === 1 ? bound[0] : undefined
  return { bound: bound.length, outcome: only === undefined ? null : report?.decided[only.id] ?? null }
}

describe('P2-06 on the shipped headless profile: an approval bound to the file its action declares (BLOCKED-318)', () => {
  let workspace: string | undefined
  const reports = new Map<PreconditionMode, PreconditionReport>()
  beforeAll(async () => {
    const shared = await mkdtemp(join(tmpdir(), 'p2-06-approval-precondition-workspace-'))
    workspace = shared
    for (const mode of PRECONDITION_MODES) {
      for (const kind of ['unchanged', 'changed'] as const) await writeFile(join(shared, probeFile(mode, kind)), `${kind}: as it was when the approval was asked\n`)
    }
    for (const mode of PRECONDITION_MODES) reports.set(mode, await run(mode, shared))
  }, PRECONDITION_MODES.length * LOADER_SMOKE_TEST_TIMEOUT_MS)
  afterAll(async () => {
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  })

  it('control (native): an approved call whose declared file is unchanged runs once, and its approval is found by the call\'s action id (acceptance[2])', () => {
    const report = reports.get('native')
    const runs = runsOn(report, 'native', 'unchanged')
    expect(runs, JSON.stringify(report)).toHaveLength(1)
    expect(approvalOf(report, runs[0]?.callId), JSON.stringify(report)).toEqual({ bound: 1, outcome: 'allowed-once' })
  })

  it('acceptance[0] (native): an approved call whose declared file changed after the ask does not run', () => {
    const report = reports.get('native')
    expect(askedAbout(report, 'native', 'changed'), JSON.stringify(report)).toBe(true)
    expect(runsOn(report, 'native', 'changed'), JSON.stringify(report)).toEqual([])
    expect(report?.results.find(result => result.callId === actionIdOf('native', 'changed'))?.isError, JSON.stringify(report)).toBe(true)
  })

  it('acceptance[0] (native): an approved call whose declared file did not exist at the ask and exists at execution does not run', () => {
    const report = reports.get('native')
    expect(askedAbout(report, 'native', 'created'), JSON.stringify(report)).toBe(true)
    expect(runsOn(report, 'native', 'created'), JSON.stringify(report)).toEqual([])
    expect(report?.results.find(result => result.callId === actionIdOf('native', 'created'))?.isError, JSON.stringify(report)).toBe(true)
  })

  it('acceptance[1] (native): the approval request shows the call\'s arguments redacted, without the secret value', () => {
    const report = reports.get('native')
    const shown = report?.asked.map(entry => entry.arguments) ?? []
    expect(shown.length, JSON.stringify(report)).toBeGreaterThan(0)
    for (const text of shown) {
      expect(text, JSON.stringify(report)).not.toBeNull()
      expect(text ?? '', JSON.stringify(report)).not.toContain(SECRET)
      expect(text ?? '', JSON.stringify(report)).toContain('<redacted>')
    }
  })

  it('control (code-mode): an approved sub-call whose declared file is unchanged runs once, and its approval is found by the sub-call\'s action id (acceptance[2])', () => {
    const report = reports.get('code-mode')
    const runs = runsOn(report, 'code-mode', 'unchanged')
    expect(runs, JSON.stringify(report)).toHaveLength(1)
    expect(approvalOf(report, runs[0]?.callId), JSON.stringify(report)).toEqual({ bound: 1, outcome: 'allowed-once' })
  })

  it('acceptance[0] (code-mode): an approved sub-call whose declared file changed after the ask does not run', () => {
    const report = reports.get('code-mode')
    expect(askedAbout(report, 'code-mode', 'changed'), JSON.stringify(report)).toBe(true)
    expect(runsOn(report, 'code-mode', 'changed'), JSON.stringify(report)).toEqual([])
  })

  it('control (native): a call\'s approval request shows the six display fields must[0] names', () => {
    const report = reports.get('native')
    const fields = report?.asked.map(entry => entry.displayFields) ?? []
    expect(fields.length, JSON.stringify(report)).toBeGreaterThan(0)
    for (const names of fields) expect(names, JSON.stringify(report)).toEqual(DISPLAY_FIELDS)
  })

  it('must[0] and acceptance[1] (code-mode): a sub-call\'s approval request shows the same six display fields, its arguments redacted and without the secret value', () => {
    const report = reports.get('code-mode')
    const asked = report?.asked ?? []
    expect(asked.length, JSON.stringify(report)).toBeGreaterThan(0)
    for (const entry of asked) {
      expect(entry.displayFields, JSON.stringify(report)).toEqual(DISPLAY_FIELDS)
      expect(entry.arguments ?? '', JSON.stringify(report)).not.toContain(SECRET)
      expect(entry.arguments ?? '', JSON.stringify(report)).toContain('<redacted>')
    }
  })
})
