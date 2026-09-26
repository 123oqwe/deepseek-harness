/**
 * P2-05 acceptance[0] (「同一 ActionManifest 无论由 tool、workflow、SDK、plugin 或
 * subagent 发起，都通过同一个 PEP。」) on the shipped headless composition, for
 * the originators the shipped product can drive: the root agent's own model
 * call, a child the shipped `subagent` tool delegates to, and a child a
 * workflow script's `agent()` call starts through the shipped `workflow` tool.
 *
 * `./loader/p2-05-originators/driver.ts` boots the SHIPPED headless profile
 * once per originator with the Trust Kernel pinned and an audit sink, and a
 * keyless scripted model whose `read` of one file is the action each case
 * reads. A case holds when that call appended exactly one manifest, in the
 * session the originator implies, and the kernel audited exactly one decision
 * for it, a permit, before the tool read the file.
 *
 * Not driven here, and why: code mode (PTC) is shipped but switched on only by
 * the process-wide `DSH_TOOLS_MODE`; an SDK client can only `session/prompt`
 * (`packages/sdk/server/src/server.ts:515-519`), so its actions are the session
 * agent's own calls; and `plugin-rpc` has no producer in the shipped source.
 * @module tests/first100/fixtures/P2-05.originators.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHILD_READ_CALL, ORIGINATOR_MODES, type OriginatorMode, READ_LINE, ROOT_READ_CALL } from './loader/p2-05-originators/shared.ts'

const driver = fileURLToPath(new URL('./loader/p2-05-originators/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p2-05-originators/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One appended manifest, with the origin of the session that appended it. */
interface ManifestRow {
  readonly actionId: string
  readonly origin: string
  readonly capability: string
  readonly session: string
}

/** What the driver reported for one boot. */
interface Report {
  readonly mode: OriginatorMode
  readonly manifests: readonly ManifestRow[]
  readonly decisions: readonly { readonly actionId: unknown; readonly origin: unknown; readonly effect: unknown }[]
  readonly toolResults: readonly { readonly session: string; readonly text: string }[]
}

const reports = new Map<OriginatorMode, Report>()

beforeAll(async () => {
  for (const mode of ORIGINATOR_MODES) {
    const { stdout, stderr } = await runLoaderSmoke({
      label: `P2-05 originators: ${mode}`,
      tempDirPrefix: `p2-05-originators-${mode}-`,
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [overlay, mode],
      tsconfigPath: repoTsconfig,
    })
    const json = /P2-05-ORIGINATORS (?<json>.+)/u.exec(stdout)?.groups?.json
    if (json === undefined) throw new Error(`the ${mode} driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
    reports.set(mode, JSON.parse(json) as Report)
  }
}, ORIGINATOR_MODES.length * LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * Assert one originator's `read` passed the enforcement point once and then ran.
 * @param mode - the originator.
 * @param callId - the `read` call's id.
 * @param session - the origin of the session expected to dispatch it.
 */
function expectOnePepPass(mode: OriginatorMode, callId: string, session: 'root' | 'subagent'): void {
  const report = reports.get(mode)
  const context = JSON.stringify(report)
  const manifests = report?.manifests.filter(manifest => manifest.actionId === callId) ?? []
  expect(manifests.map(manifest => ({ capability: manifest.capability, session: manifest.session })), context)
    .toEqual([{ capability: 'read', session }])
  expect(report?.decisions.filter(decision => decision.actionId === callId).map(decision => decision.effect), context)
    .toEqual(['permit'])
  expect(report?.toolResults.some(result => result.session === session && result.text.includes(READ_LINE)), context).toBe(true)
}

describe('P2-05 acceptance[0]: every originator the shipped headless profile drives passes one enforcement point', () => {
  it('the root agent\'s own read appends one manifest and is decided once before it runs', () => {
    expectOnePepPass('native', ROOT_READ_CALL, 'root')
  })

  it('a child the shipped subagent tool delegates to has its read manifested and decided once before it runs', () => {
    expectOnePepPass('subagent', CHILD_READ_CALL, 'subagent')
  })

  it('a child a workflow script\'s agent() call starts has its read manifested and decided once before it runs', () => {
    expectOnePepPass('workflow', CHILD_READ_CALL, 'subagent')
  })
})
