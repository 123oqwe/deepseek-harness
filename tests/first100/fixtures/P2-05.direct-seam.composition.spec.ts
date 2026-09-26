/**
 * BLOCKED-294 under P2-05 acceptance[0] (「同一 ActionManifest 无论由 tool、
 * workflow、SDK、plugin 或 subagent 发起，都通过同一个 PEP。」): the public
 * `ToolRuntime.execute` seam, which the Cordis tutorial teaches plugins to call
 * directly, must append a manifest and pass the enforcement point like the
 * agent loop's own call does.
 *
 * `./loader/p2-05-direct-seam/driver.ts` boots the SHIPPED headless profile
 * once, with the Trust Kernel pinned and an audit sink, and reads one file
 * three ways: through the model (the control, which shows this probe reads a
 * manifest and a decision when they exist), through a direct
 * `ctx.tools.execute` on behalf of the root agent, and through a direct call
 * with no agent, as `docs/cordis-tutorial/07-into-the-harness.md` makes it.
 * Whether a direct call's tool body then runs is reported, not asserted.
 * @module tests/first100/fixtures/P2-05.direct-seam.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { DIRECT_AGENT_CALL, DIRECT_PLAIN_CALL, NATIVE_CALL } from './loader/p2-05-direct-seam/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-05-direct-seam/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver reported. */
interface Report {
  readonly manifests: readonly { readonly actionId: string; readonly capability: string }[]
  readonly decisions: readonly { readonly actionId: unknown; readonly effect: unknown }[]
  readonly direct: readonly { readonly callId: string; readonly isError?: boolean; readonly text?: string; readonly thrown?: string }[]
}

let report: Report | undefined

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P2-05 direct seam',
    tempDirPrefix: 'p2-05-direct-seam-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P2-05-DIRECT (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  report = JSON.parse(json) as Report
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The manifests the session appended for one call id.
 * @param callId - the call id.
 * @returns their capabilities, in order.
 */
function manifestsFor(callId: string): readonly string[] {
  return report?.manifests.filter(manifest => manifest.actionId === callId).map(manifest => manifest.capability) ?? []
}

/**
 * The decisions the kernel audited for one call id.
 * @param callId - the call id.
 * @returns their effects, in order.
 */
function decisionsFor(callId: string): readonly unknown[] {
  return report?.decisions.filter(decision => decision.actionId === callId).map(decision => decision.effect) ?? []
}

describe('BLOCKED-294: the public ToolRuntime.execute seam passes the one enforcement point', () => {
  it('control: the model\'s own read appends one manifest and is decided once, so this probe reads both', () => {
    expect(manifestsFor(NATIVE_CALL), JSON.stringify(report)).toEqual(['read'])
    expect(decisionsFor(NATIVE_CALL), JSON.stringify(report)).toEqual(['permit'])
  })

  it('a plugin calling the seam directly on behalf of an agent appends one manifest to that agent\'s session and is decided once', () => {
    expect(manifestsFor(DIRECT_AGENT_CALL), JSON.stringify(report)).toEqual(['read'])
    expect(decisionsFor(DIRECT_AGENT_CALL), JSON.stringify(report)).toHaveLength(1)
  })

  it('a plugin calling the seam directly with no agent, as the tutorial teaches, is decided once', () => {
    expect(decisionsFor(DIRECT_PLAIN_CALL), JSON.stringify(report)).toHaveLength(1)
  })
})
