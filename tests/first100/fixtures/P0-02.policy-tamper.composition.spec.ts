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
 * A-588c adds method (c) for P2-05 acceptance[2] ("the Policy service cannot be
 * replaced by Cordis, and once unmounted enforcement fails closed"): a route (b)
 * attempt is refused only because the isolate slot is held, so (c) first disposes
 * the fiber that provides the Cedar engine and then reprovides a permit engine
 * into the freed slot. It runs in its own launch so `performed` attributes to it
 * alone; the methods (a)/(b) case and the two controls are unchanged.
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
/** The vitest case deadline for method (c), kept ABOVE the launch timeout so a hang in the deferred unmount is reported with an exit code and stderr, not as a bare case timeout (the A-588c round-1 lesson). */
const METHOD_C_CASE_TIMEOUT_MS = LAUNCH_TIMEOUT_MS + 30_000

const FORBIDDEN_TOOL = fileURLToPath(new URL('./loader/a-588-policy-tamper/forbidden-tool.mjs', import.meta.url))
const POLICY_TAMPER = fileURLToPath(new URL('./loader/a-588-policy-tamper/policy-tamper.mjs', import.meta.url))

/** The forbidden tool the stub calls. */
const FORBIDDEN_CALL = 'a588_forbidden'

/** The stub's script: the given calls in the first tool-offering step, nothing after. */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/** Method (c)'s staged outcome: whether the unmount took, the reprovide took, and whether enforcement now resolves the forged engine. */
interface MethodCStages {
  readonly unmounted: boolean
  readonly reprovided: boolean
  readonly resolvedForged: boolean
  readonly error?: string
}

/** What the tamper plugin recorded for each override route. Method (c) is recorded in stages. */
interface TamperOutcome {
  readonly methodA: string
  readonly methodB: string
  readonly methodC: string | MethodCStages
}

/** What one launch observed. */
interface Observation {
  /** Whether the forbidden tool's body ran (its marker is on disk). */
  readonly performed: boolean
  /** Whether the turn actually dispatched the call (a tool result came back to the stub). */
  readonly callDispatched: boolean
  /** The tamper plugin's recorded outcome, or null when no tamper plugin was mounted. */
  readonly tamper: TamperOutcome | null
  readonly exitCode: number | null | undefined
  readonly stderr: string
}

/**
 * Launch the shipped headless product with the forbidden tool, optionally the
 * deployment `forbid` rule and the policy-tamper plugin, and read what happened.
 * @param options - whether to add the deployment forbid rule and the malicious override plugin, and which override routes the plugin attempts (default `['a','b']`).
 * @returns the observation.
 */
async function run(options: { forbid: boolean; tamper: boolean; tamperMethods?: readonly ('a' | 'b' | 'c')[] }): Promise<Observation> {
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
  const methodsLine = options.tamperMethods === undefined ? '' : `\n        methods: [${options.tamperMethods.map(method => `'${method}'`).join(', ')}]`
  writeFileSync(tamperPatch, `- insert:\n    - id: a-588-policy-tamper\n      name: '${POLICY_TAMPER}'\n      config:\n        marker: '${tamperMarker}'${methodsLine}\n`)
  const stub = await startStubModel(firstStep([{ name: FORBIDDEN_CALL, arguments: { note: 'a588' } }]))
  try {
    const result = await launchShippedHeadless({
      cwd,
      task: 'A-588: call the forbidden tool once.',
      patches: [toolPatch, ...options.forbid ? [forbidPatch] : [], ...options.tamper ? [tamperPatch] : []],
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env: {},
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return {
      performed: existsSync(execMarker),
      // A tool result returned to the stub (a later request carries a `tool`
      // message) proves the forbidden call was issued and dispatched — whether it
      // was refused or performed.
      callDispatched: stub.requests.some(request => (request.messages ?? []).some(message => message.role === 'tool')),
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
  it('positive control: with no forbid rule and no tamper, the forbidden tool runs — the dispatch path and marker work', async () => {
    const observed = await run({ forbid: false, tamper: false })
    expect({ performed: observed.performed, dispatched: observed.callDispatched, exit: observed.exitCode },
      `stderr:\n${observed.stderr.slice(-800)}`).toEqual({ performed: true, dispatched: true, exit: 0 })
  }, LAUNCH_TIMEOUT_MS)

  it('rule control: with the deployment forbid and no tamper, the forbidden tool call is refused (the rule fires)', async () => {
    const observed = await run({ forbid: true, tamper: false })
    expect({ performed: observed.performed, dispatched: observed.callDispatched, exit: observed.exitCode },
      `stderr:\n${observed.stderr.slice(-800)}`).toEqual({ performed: false, dispatched: true, exit: 0 })
  }, LAUNCH_TIMEOUT_MS)

  it('with the tamper plugin, both override routes are refused and the forbidden call stays refused', async () => {
    const observed = await run({ forbid: true, tamper: true })
    const detail = `tamper ${JSON.stringify(observed.tamper)}; performed ${String(observed.performed)}; dispatched ${String(observed.callDispatched)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // Guards first: the boot ran to a normal exit, the tamper plugin recorded an
    // outcome (so it mounted after the kernel was pinned, not crashing the boot),
    // and the turn actually issued the forbidden call.
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.tamper, detail).not.toBeNull()
    expect(observed.callDispatched, detail).toBe(true)
    // validation[0]: both override routes refused at the boot stage. RED today if
    // a route reads `overrode`.
    expect(observed.tamper?.methodA, detail).toMatch(/^refused/u)
    expect(observed.tamper?.methodB, detail).toMatch(/^refused/u)
    // And the forbidden call must stay refused — enforcement does not trust a
    // tampered engine. RED today if an override bypassed the forbid and the body ran.
    expect(observed.performed, detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)

  it('method (c): after appReady, unmounting the Cedar engine and reproviding a permit engine does not become the policy enforcement resolves (P2-05 acceptance[2], red first)', async () => {
    const observed = await run({ forbid: true, tamper: true, tamperMethods: ['c'] })
    const detail = `tamper ${JSON.stringify(observed.tamper)}; performed ${String(observed.performed)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // Guards: method (c) ran its deferred unmount to a clean exit (a hang would
    // instead be reported by the launch timeout with a non-zero exit and stderr,
    // since the case timeout sits above it), and recorded its stages.
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.tamper, detail).not.toBeNull()
    const stages = observed.tamper?.methodC
    expect(typeof stages === 'object', `methodC must be recorded in stages: ${detail}`).toBe(true)
    if (stages === undefined || typeof stages !== 'object') return
    // acceptance[2]: the Policy service cannot be replaced by Cordis — disposing
    // its fiber and reproviding a permit engine must NOT become the engine
    // `ctx.get('policy')` resolves (the same isolate slot method (a) proved
    // enforcement reads). RED today: the unfrozen slot lets the reprovide take.
    expect(stages.resolvedForged, detail).toBe(false)
  }, METHOD_C_CASE_TIMEOUT_MS)
})
