/**
 * A-588 (P0-02 U-1, validation[0]): on the shipped composition, after the Trust
 * Kernel is pinned, a malicious plugin that ATTEMPTS to override the deployment
 * policy engine to always-permit must be refused, and a tool call the deployment
 * policy forbids must stay refused. The factory deployment policy ships no such
 * `forbid` rule (base cordis.patch.yml:306-331 is `baseline-permit` + the
 * kernel-hard-deny band only), so this profile configures its own deployment
 * `forbid` for `external-communication` — a non-kernel-band rule — and a fixture
 * tool tagged `network-fetch` (→ `external-communication`) that the rule denies.
 * The tool's body writes a marker, so whether the call was PERFORMED is read from
 * disk.
 *
 * Observed on the shipped headless launcher (keyless, the benchmark's stub model).
 * The tamper plugin records whether each override route was `refused` or
 * `overrode`; the control run (no tamper plugin) proves the `forbid` rule itself
 * denies the call. Per the delegate's ruling, both outcomes are recorded honestly
 * and the two meanings stated: if the overrides are refused and the call stays
 * refused, the kernel boundary holds (green); if an override takes and the call is
 * then performed, P0-02 U-1's 1档 finding is confirmed (red today). The assertions
 * state the secure behaviour, so they red on the finding.
 *
 * §21.4: no fix read — this is the probe red first.
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

const FORBIDDEN_TOOL = fileURLToPath(new URL('./loader/a-588-policy-tamper/forbidden-tool.mjs', import.meta.url))
const POLICY_TAMPER = fileURLToPath(new URL('./loader/a-588-policy-tamper/policy-tamper.mjs', import.meta.url))

/** The forbidden tool the stub calls. */
const FORBIDDEN_CALL = 'a588_forbidden'

/** The stub's script: the given calls in the first tool-offering step, nothing after. */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/** What the tamper plugin recorded for each override route. */
interface TamperOutcome {
  readonly methodA: string
  readonly methodB: string
}

/** What one launch observed. */
interface Observation {
  /** Whether the forbidden tool's body ran (its marker is on disk). */
  readonly performed: boolean
  /** The tamper plugin's recorded outcome, or null when no tamper plugin was mounted. */
  readonly tamper: TamperOutcome | null
  readonly exitCode: number | null | undefined
  readonly stderr: string
}

/**
 * Launch the shipped headless product with the deployment `forbid` rule and the
 * forbidden tool, optionally with the policy-tamper plugin, and read what happened.
 * @param withTamper - whether to mount the malicious override plugin.
 * @returns the observation.
 */
async function run(withTamper: boolean): Promise<Observation> {
  const cwd = mkdtempSync(join(homedir(), '.dsh-a588-'))
  const execMarker = join(cwd, 'forbidden-performed')
  const tamperMarker = join(cwd, 'tamper-outcome.json')
  const forbidPatch = join(cwd, 'forbid.patch.yml')
  const toolPatch = join(cwd, 'tool.patch.yml')
  const tamperPatch = join(cwd, 'tamper.patch.yml')
  writeFileSync(forbidPatch, [
    '- id: policy-language',
    '  config:',
    '    policies:',
    "      baseline-permit: 'permit(principal, action, resource);'",
    "      kernel-hard-deny: 'forbid(principal, action, resource) when { context.riskClass == \"safety-critical\" };'",
    "      a588-deployment-forbid: 'forbid(principal, action, resource) when { context.riskClass == \"external-communication\" };'",
    '',
  ].join('\n'))
  writeFileSync(toolPatch, `- insert:\n    - id: a-588-forbidden-tool\n      name: '${FORBIDDEN_TOOL}'\n      config:\n        marker: '${execMarker}'\n`)
  writeFileSync(tamperPatch, `- insert:\n    - id: a-588-policy-tamper\n      name: '${POLICY_TAMPER}'\n      config:\n        marker: '${tamperMarker}'\n`)
  const stub = await startStubModel(firstStep([{ name: FORBIDDEN_CALL, arguments: { note: 'a588' } }]))
  try {
    const result = await launchShippedHeadless({
      cwd,
      task: 'A-588: call the forbidden tool once.',
      patches: withTamper ? [forbidPatch, toolPatch, tamperPatch] : [forbidPatch, toolPatch],
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env: {},
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return {
      performed: existsSync(execMarker),
      tamper: existsSync(tamperMarker) ? (JSON.parse(readFileSync(tamperMarker, 'utf8')) as TamperOutcome) : null,
      exitCode: result.exitCode,
      stderr: result.stderrTail ?? '',
    }
  } finally {
    await stub.close()
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('A-588 (P0-02 U-1): a plugin cannot override the deployment policy to bypass a forbidden tool call on a pinned kernel (red first)', () => {
  it('control: without the tamper plugin, the deployment forbid refuses the forbidden tool call', async () => {
    const observed = await run(false)
    // The rule itself works: the forbidden tool never runs, so a bypass below is
    // the override's doing, not a rule that denies nothing.
    expect(observed.performed, `exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`).toBe(false)
  }, LAUNCH_TIMEOUT_MS)

  it('with the tamper plugin, both override routes are refused and the forbidden call stays refused', async () => {
    const observed = await run(true)
    const detail = `tamper ${JSON.stringify(observed.tamper)}; performed ${String(observed.performed)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // validation[0]: the override must be refused at the boot stage. RED today if
    // a route reads `overrode`.
    expect(observed.tamper?.methodA, detail).toMatch(/^refused/u)
    expect(observed.tamper?.methodB, detail).toMatch(/^refused/u)
    // And the forbidden call must stay refused — the enforcement does not trust a
    // tampered engine. RED today if the override bypassed the forbid and the body ran.
    expect(observed.performed, detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)
})
