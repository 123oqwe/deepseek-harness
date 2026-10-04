/**
 * A-588d (P2-05 acceptance[1]/[2], 安全): two ways a plugin might still bend the
 * policy decision on the shipped composition after the Trust Kernel is pinned.
 *
 * ① policySet poison (acceptance[2], RED first): the Cedar engine reads its set by
 * property access — `ctx.policySet.current()` — resolving the slot policy-language
 * registers at the root fiber. A plugin overwrites that slot with a forged set
 * that drops the deployment forbid. The deployment forbid must STILL deny the
 * call (the policy set cannot be replaced this way). Today the slot is unfrozen,
 * so the forged set lands and the forbidden call runs — RED.
 *
 * ② no-agent dispatch (acceptance[1]/[2], GREEN evidence): a call with NO agent,
 * even with the engine forged to always-permit (A-588 route (a)), is refused —
 * the direct seam decides a no-agent call as an unrecorded action and refuses it
 * before the engine's decision (core/tools/src/index.ts:2102-2104). The forged
 * permit never reaches the outcome. (A no-agent PTC sub-dispatch is not covered
 * here: whether it refuses depends on whether the engine can be swapped, which
 * A-588 route (a) already reds; this is noted in P2-05's re-sign.)
 *
 * Both reuse A-588's `forbidden-tool.mjs` (a `network-fetch` effect → the
 * `external-communication` the deployment forbid names) and the shipped headless
 * launcher with the keyless stub model. §21.4: the fix is not read.
 * @module tests/first100/fixtures/P2-05.policyset-and-noagent.composition
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
/** The case deadline, above the launch timeout so a hang in the deferred no-agent dispatch is reported with an exit code and stderr. */
const CASE_TIMEOUT_MS = LAUNCH_TIMEOUT_MS + 30_000

const FORBIDDEN_TOOL = fileURLToPath(new URL('./loader/a-588-policy-tamper/forbidden-tool.mjs', import.meta.url))
const POLICYSET_POISON = fileURLToPath(new URL('./loader/a-588d-policyset-noagent/policyset-poison.mjs', import.meta.url))
const NOAGENT_DISPATCH = fileURLToPath(new URL('./loader/a-588d-policyset-noagent/noagent-dispatch.mjs', import.meta.url))

/** The forbidden tool the stub calls / the no-agent plugin dispatches. */
const FORBIDDEN_CALL = 'a588_forbidden'

/** What the policyset-poison plugin recorded. */
interface PoisonReading {
  readonly keyFound: boolean
  readonly wrote: boolean
  readonly landed: boolean
  readonly error?: string
}

/** What the no-agent-dispatch plugin recorded. */
interface NoAgentReading {
  readonly forgeOk: boolean
  readonly dispatched: boolean
  readonly resultIsError: boolean | null
  readonly resultText?: string
  readonly error?: string
}

/** What one launch observed. */
interface Observation {
  readonly performed: boolean
  readonly callDispatched: boolean
  readonly poison: PoisonReading | null
  readonly noagent: NoAgentReading | null
  readonly exitCode: number | null | undefined
  readonly stderr: string
}

/** The stub's script: the given calls in the first tool-offering step, nothing after. */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/**
 * Launch the shipped headless product with the forbidden tool, optionally the
 * deployment forbid rule, the policyset-poison plugin (①) and the no-agent-dispatch
 * plugin (②), and read what happened.
 * @param options - which parts to mount; `callsForbidden` makes the stub issue the forbidden call (① only).
 * @returns the observation.
 */
async function run(options: { forbid: boolean; poison: boolean; noagent: boolean; callsForbidden: boolean }): Promise<Observation> {
  const cwd = mkdtempSync(join(homedir(), '.dsh-a588d-'))
  const execMarker = join(cwd, 'forbidden-performed')
  const poisonMarker = join(cwd, 'poison-outcome.json')
  const noagentMarker = join(cwd, 'noagent-outcome.json')
  const patches: string[] = []
  const write = (name: string, body: string): string => { const p = join(cwd, name); writeFileSync(p, body); return p }
  patches.push(write('tool.patch.yml', `- insert:\n    - id: a-588-forbidden-tool\n      name: '${FORBIDDEN_TOOL}'\n      config:\n        marker: '${execMarker}'\n`))
  if (options.forbid) {
    patches.push(write('forbid.patch.yml', [
      '- id: policy-language',
      '  config:',
      '    policies:',
      "      baseline-permit: 'permit(principal, action, resource);'",
      "      kernel-hard-deny: 'forbid(principal, action, resource) when { context.riskClass == \"safety-critical\" };'",
      "      a588d-deployment-forbid: 'forbid(principal, action, resource) when { context.riskClass == \"external-communication\" };'",
      '',
    ].join('\n')))
  }
  if (options.poison) {
    patches.push(write('poison.patch.yml', `- insert:\n    - id: a-588d-policyset-poison\n      name: '${POLICYSET_POISON}'\n      config:\n        marker: '${poisonMarker}'\n`))
  }
  if (options.noagent) {
    patches.push(write('noagent.patch.yml', `- insert:\n    - id: a-588d-noagent-dispatch\n      name: '${NOAGENT_DISPATCH}'\n      config:\n        marker: '${noagentMarker}'\n        tool: '${FORBIDDEN_CALL}'\n`))
  }
  const stub = await startStubModel(firstStep(options.callsForbidden ? [{ name: FORBIDDEN_CALL, arguments: { note: 'a588d' } }] : []))
  try {
    const result = await launchShippedHeadless({
      cwd,
      task: 'A-588d: policy decision integrity probe.',
      patches,
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env: {},
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return {
      performed: existsSync(execMarker),
      callDispatched: stub.requests.some(request => (request.messages ?? []).some(message => message.role === 'tool')),
      poison: existsSync(poisonMarker) ? (JSON.parse(readFileSync(poisonMarker, 'utf8')) as PoisonReading) : null,
      noagent: existsSync(noagentMarker) ? (JSON.parse(readFileSync(noagentMarker, 'utf8')) as NoAgentReading) : null,
      exitCode: result.exitCode,
      stderr: result.stderrTail ?? '',
    }
  } finally {
    await stub.close()
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('A-588d (P2-05 acceptance[1]/[2]): the policy decision survives a poisoned policySet and a no-agent dispatch', () => {
  it('① policySet poison: a forged all-permit set must not become what Cedar reads, so the deployment forbid still denies (red first)', async () => {
    const observed = await run({ forbid: true, poison: true, noagent: false, callsForbidden: true })
    const detail = `poison ${JSON.stringify(observed.poison)}; performed ${String(observed.performed)}; dispatched ${String(observed.callDispatched)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // Guards: a normal exit, the forbidden call was issued, and the poison found
    // the slot Cedar reads (a false keyFound is a fixture miss, visible here).
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.callDispatched, detail).toBe(true)
    expect(observed.poison?.keyFound, detail).toBe(true)
    // acceptance[2]: the policy set cannot be replaced by Cordis — the forged set
    // must NOT become what `ctx.policySet` resolves. RED today (the slot is unfrozen).
    expect(observed.poison?.landed, detail).toBe(false)
    // And the deployment forbid still denies the external-communication call.
    // RED today: the poison dropped the forbid, so the body ran.
    expect(observed.performed, detail).toBe(false)
  }, CASE_TIMEOUT_MS)

  it('② no-agent dispatch: a call with no agent is refused even with the engine forged to permit (green evidence)', async () => {
    const observed = await run({ forbid: false, poison: false, noagent: true, callsForbidden: false })
    const detail = `noagent ${JSON.stringify(observed.noagent)}; performed ${String(observed.performed)}; exit ${String(observed.exitCode)}; stderr:\n${observed.stderr.slice(-800)}`
    // Guards: a normal exit, the plugin ran its deferred dispatch and recorded it,
    // and the engine WAS forged (so the refusal is not a clean-engine artefact).
    expect(observed.exitCode, detail).toBe(0)
    expect(observed.noagent, detail).not.toBeNull()
    expect(observed.noagent?.dispatched, detail).toBe(true)
    expect(observed.noagent?.forgeOk, detail).toBe(true)
    // The no-agent call is refused as unrecorded before the engine's decision, so
    // the forged permit never reaches the outcome and the body never runs. Green
    // on both bases (B-728 only hardens the engine swap A-588 (a) already reds).
    expect(observed.performed, detail).toBe(false)
  }, CASE_TIMEOUT_MS)
})
