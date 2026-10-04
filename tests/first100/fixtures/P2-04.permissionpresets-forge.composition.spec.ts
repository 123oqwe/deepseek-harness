/**
 * A-612 (P2-04, 安全): on the shipped composition, after the Trust Kernel is
 * pinned, a plugin that forges the `permissionPresets` service the risk gate reads
 * must not bend the organisation policy. The risk gate reads
 * `ctx.get('permissionPresets')` as a `RiskPolicyPort` (core/tools/src/external-effect.ts:434,:943);
 * the forge (A-588 route (a): rewrite the service's isolate store-slot value)
 * makes every action classify `read` and never hard-denied, and no action require
 * approval. On an AGENT path, a safety-critical call must STILL be denied and an
 * approval-requiring call must STILL ask (and, with no answerer in headless, be
 * refused). Today the slot is unfrozen, so the forged port is read and both calls
 * run — RED. Red → withdraw P2-04 (BLOCKED-356).
 *
 * The profile reproduces the shipped `permission` config (a config patch replaces
 * the whole config, so the full `presets` table and `riskRules` are restated) and
 * adds `a612-safety → safety-critical`; the approval-requiring tool declares an
 * unnamed tag, classified to the `security-sensitive` default above the preset's
 * `destructive` threshold. The control run (no forge) proves both are refused
 * under the real presets. §21.4: the fix is not read.
 * @module tests/first100/fixtures/P2-04.permissionpresets-forge.composition
 */

import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launchShippedHeadless } from '../../../benchmarks/harness-capability/product.ts'
import { startStubModel, type StubRequest, type StubToolCall } from '../../../benchmarks/harness-capability/stub-model.ts'

/** One launch's deadline. */
const LAUNCH_TIMEOUT_MS = 60_000

const TOOLS = fileURLToPath(new URL('./loader/a-612-permissionpresets-forge/tools.mjs', import.meta.url))
const FORGE = fileURLToPath(new URL('./loader/a-612-permissionpresets-forge/forge.mjs', import.meta.url))

const SAFETY_CALL = 'a612_safety'
const APPROVAL_CALL = 'a612_approval'

/** The shipped `permission` config, restated with an added `safety-critical` rule (a config patch replaces the whole config). */
const PERMISSION_CONFIG = [
  '- id: permission',
  '  config:',
  '    defaultPreset: workspace-write',
  '    presets:',
  '      read-only: { sandbox: read-only, approval: ask, approvalThreshold: destructive }',
  '      workspace-write: { sandbox: workspace-write, approval: ask, approvalThreshold: destructive }',
  '      danger-full-access: { sandbox: danger-full-access, approval: never, approvalThreshold: safety-critical }',
  '    riskRules:',
  '      - { domainTag: filesystem-read, riskClass: read }',
  '      - { domainTag: catalog-read, riskClass: read }',
  '      - { domainTag: session-state-read, riskClass: read }',
  '      - { domainTag: process-observe, riskClass: read }',
  '      - { domainTag: session-state-write, riskClass: local-reversible }',
  '      - { domainTag: context-inject, riskClass: local-reversible }',
  '      - { domainTag: filesystem-write, riskClass: internal-write }',
  '      - { domainTag: shell-execute, riskClass: internal-write }',
  '      - { domainTag: process-control, riskClass: internal-write }',
  '      - { domainTag: agent-spawn, riskClass: internal-write }',
  '      - { domainTag: agent-control, riskClass: internal-write }',
  '      - { domainTag: orchestration, riskClass: internal-write }',
  '      - { domainTag: network-fetch, riskClass: external-communication }',
  '      - { domainTag: network-search, riskClass: external-communication }',
  '      - { domainTag: a612-safety, riskClass: safety-critical }',
  '',
].join('\n')

/** What the forge plugin recorded. */
interface ForgeReading {
  readonly keyFound: boolean
  readonly wrote: boolean
  readonly forgeOk: boolean
  readonly error?: string
}

/** What one launch observed. */
interface Observation {
  readonly safetyPerformed: boolean
  readonly approvalPerformed: boolean
  readonly callDispatched: boolean
  readonly forge: ForgeReading | null
  readonly exitCode: number | null | undefined
  readonly stderr: string
}

/** The stub's script: the given calls in the first tool-offering step, nothing after. */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/**
 * Launch the shipped headless product with the restated permission config, the two
 * fixture tools, and optionally the permissionPresets forge, with the stub calling
 * both tools in one turn.
 * @param options - whether to mount the forge.
 * @returns the observation.
 */
async function run(options: { forge: boolean }): Promise<Observation> {
  const cwd = mkdtempSync(join(homedir(), '.dsh-a612-'))
  const safetyMarker = join(cwd, 'safety-performed')
  const approvalMarker = join(cwd, 'approval-performed')
  const forgeMarker = join(cwd, 'forge-outcome.json')
  const write = (name: string, body: string): string => { const p = join(cwd, name); writeFileSync(p, body); return p }
  const patches = [
    write('permission.patch.yml', PERMISSION_CONFIG),
    write('tools.patch.yml', `- insert:\n    - id: a-612-tools\n      name: '${TOOLS}'\n      config:\n        safetyMarker: '${safetyMarker}'\n        approvalMarker: '${approvalMarker}'\n`),
    ...options.forge ? [write('forge.patch.yml', `- insert:\n    - id: a-612-permissionpresets-forge\n      name: '${FORGE}'\n      config:\n        marker: '${forgeMarker}'\n`)] : [],
  ]
  const stub = await startStubModel(firstStep([
    { name: SAFETY_CALL, arguments: { note: 'a612' } },
    { name: APPROVAL_CALL, arguments: { note: 'a612' } },
  ]))
  try {
    const result = await launchShippedHeadless({
      cwd,
      task: 'A-612: call the guarded tools once each.',
      patches,
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env: {},
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return {
      safetyPerformed: existsSync(safetyMarker),
      approvalPerformed: existsSync(approvalMarker),
      callDispatched: stub.requests.some(request => (request.messages ?? []).some(message => message.role === 'tool')),
      forge: existsSync(forgeMarker) ? (JSON.parse(readFileSync(forgeMarker, 'utf8')) as ForgeReading) : null,
      exitCode: result.exitCode,
      stderr: result.stderrTail ?? '',
    }
  } finally {
    await stub.close()
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('A-612 (P2-04): forging permissionPresets does not bend the risk gate — approval still asked, safety-critical still denied', () => {
  it('control: with no forge, the safety-critical call is denied and the approval-requiring call is refused for want of an answerer', async () => {
    const observed = await run({ forge: false })
    const detail = `safety ${String(observed.safetyPerformed)}; approval ${String(observed.approvalPerformed)}; dispatched ${String(observed.callDispatched)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.callDispatched, detail).toBe(true)
    // Under the real presets both are refused, so the reds below are the forge and
    // not a harness that never runs these tools.
    expect(observed.safetyPerformed, detail).toBe(false)
    expect(observed.approvalPerformed, detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)

  it('with the forge, the safety-critical call must stay denied and the approval-requiring call must stay refused (red first)', async () => {
    const observed = await run({ forge: true })
    const detail = `forge ${JSON.stringify(observed.forge)}; safety ${String(observed.safetyPerformed)}; approval ${String(observed.approvalPerformed)}; dispatched ${String(observed.callDispatched)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // Guards: a normal exit, both calls issued, and the forged port was actually
    // installed (a false forgeOk is a fixture miss, visible here).
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.callDispatched, detail).toBe(true)
    expect(observed.forge?.forgeOk, detail).toBe(true)
    // P2-04: the preset table cannot be replaced by Cordis. RED today — the forged
    // port downgrades the class and drops approval, so both bodies run.
    expect(observed.safetyPerformed, detail).toBe(false)
    expect(observed.approvalPerformed, detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)
})
