/**
 * P4-05 acceptance[1] ("waiting states consume no LLM or worker resources")
 * on the shipped headless composition, with an operator's approval as the
 * wait.
 *
 * `./loader/p4-05-waiting/driver.ts` boots the SHIPPED headless profile under
 * `workspace-write` with `./loader/p4-05-waiting/base.patch.yml`, which adds a
 * keyless scripted model and mounts no approval, policy or Run row. The model
 * calls one third-party tool that declares no risk domain tags; the base
 * layer's risk gate asks an operator about it, and the driver, answering as
 * that operator, withholds its answer for a second before allowing the call.
 * It declines at once the workspace-trust question the shipped headless
 * profile asks first. One driver run serves every case in this file.
 *
 * The acceptance[1] cases read the agent while the answer is withheld and
 * after it is given. The must[0] case pins which waiting state an approval
 * wait is recorded as.
 * @module tests/first100/fixtures/P4-05.waiting.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p4-05-waiting/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p4-05-waiting/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The tool the driver registers; it declares no risk domain tags. */
const THIRD_PARTY_TOOL = 'p4_05_third_party'

/** The waiting states an approval wait may be recorded as; both hold no dispatch slot. */
const WAITING_STATES = ['waiting_tool', 'waiting_human']

/** One reading of the agent's lifecycle and of the requests the model received. */
interface Reading {
  readonly state: string | null
  readonly holdsSlot: boolean | null
  readonly stepRequests: number
  readonly sideRequests: number
}

/** One question the operator was asked. */
interface Ask {
  readonly toolName: string
  readonly atAsk: Reading
  readonly afterHold: Reading
}

/** What the driver reported. */
interface Report {
  readonly permissionMode: string | null
  readonly trustKernel: boolean
  readonly asks: readonly Ask[]
  readonly otherQuestions: readonly string[]
  readonly toolRunStates: readonly (string | null)[]
  readonly riskGated: readonly { readonly actionId: string; readonly riskClass: string; readonly preset: string; readonly decision: string }[]
  readonly policyEffects: readonly unknown[]
  readonly final: Reading
}

let pending: Promise<Report> | undefined

/**
 * Run the driver once for the whole file.
 * @returns the driver's report.
 */
function observe(): Promise<Report> {
  pending ??= runLoaderSmoke({
    label: 'P4-05 acceptance[1] waiting observation',
    tempDirPrefix: 'p4-05-waiting-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  }).then(({ stdout, stderr }) => {
    const json = /P4-05-WAIT (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    return JSON.parse(json) as Report
  })
  return pending
}

/**
 * The one question the operator withheld its answer to, about the third-party tool.
 * @param report - the driver's report.
 * @returns that question's readings.
 */
function onlyAsk(report: Report): Ask {
  expect(report.permissionMode).toBe('workspace-write')
  expect(report.trustKernel).toBe(true)
  // Any other question is the workspace-trust one, which the driver declines at once.
  expect(report.otherQuestions.filter(name => name !== 'workspace-trust')).toEqual([])
  expect(report.asks.map(ask => ask.toolName)).toEqual([THIRD_PARTY_TOOL])
  const [ask] = report.asks
  if (ask === undefined) throw new Error('the operator was asked nothing')
  return ask
}

describe('P4-05 acceptance[1]: an agent waiting on an operator\'s approval on the shipped headless profile', () => {
  let report: Report
  beforeAll(async () => {
    report = await observe()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('while the operator has not answered, the agent is in a waiting state that holds no dispatch slot, and the model receives no step request', () => {
    const { atAsk, afterHold } = onlyAsk(report)
    for (const reading of [atAsk, afterHold]) {
      expect(WAITING_STATES).toContain(reading.state)
      expect(reading.holdsSlot).toBe(false)
    }
    // The one step request is the step that called the tool.
    expect(atAsk.stepRequests).toBe(1)
    expect(afterHold.stepRequests).toBe(1)
  })

  it('once the operator allows the call, the agent is running again, the tool body runs once, and the model receives its next step request', () => {
    onlyAsk(report)
    expect(report.toolRunStates).toEqual(['running'])
    expect(report.final.stepRequests).toBe(2)
    expect(report.riskGated).toEqual([
      { actionId: THIRD_PARTY_TOOL, riskClass: 'security-sensitive', preset: 'workspace-write', decision: 'asked' },
    ])
    expect(report.policyEffects).toEqual(['permit'])
  })
})

describe('P4-05 must[0]: an approval wait on the shipped headless profile', () => {
  let report: Report
  beforeAll(async () => {
    report = await observe()
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('is labelled waiting_human, apart from a tool wait', () => {
    const { atAsk, afterHold } = onlyAsk(report)
    expect(atAsk.state).toBe('waiting_human')
    expect(afterHold.state).toBe('waiting_human')
  })
})
