/**
 * A-611 (B-729 red first) under P4-09: on the SHIPPED headless composition, the
 * model is NOT shown how to use a saved workflow. `./loader/a-611-workflow-tool-visibility/driver.ts`
 * boots the profile with a trust anchor pinned, registers a SIGNED saved
 * definition from `$DSH_HOME/workflows`, and captures the keyless model request.
 *
 * ① The captured `workflow` tool description does not document the
 *    `workflow(nameOrRef, args)` nested-run interface, and the request (system
 *    prompt + tool schemas) does not list the registered definition's name and
 *    digest — so the model can neither discover nor invoke a saved workflow. RED
 *    today; B-729 is the fix that surfaces both.
 * ② Control: a script sent through the `workflow` tool calls
 *    `workflow({ name, digest }, {})` and runs the nested saved definition, which
 *    returns its value — the interface works, it is only undocumented. GREEN.
 *
 * §21.4: the fix is not read.
 * @module tests/first100/fixtures/P4-09.workflow-tool-visibility.composition
 */

import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { REPORT_PREFIX, type VisibilityReport } from './loader/a-611-workflow-tool-visibility/shared.ts'

/** One driver run boots a profile and runs a real nested workflow on a worker thread. */
const RUN_TIMEOUT_MS = 180_000

const driver = fileURLToPath(new URL('./loader/a-611-workflow-tool-visibility/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/a-611-workflow-tool-visibility/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

let report: VisibilityReport

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P4-09 workflow tool visibility',
    tempDirPrefix: 'p4-09-wf-vis-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
    binArgs: [overlay],
    tsconfigPath: repoTsconfig,
    processTimeoutMs: RUN_TIMEOUT_MS,
  })
  const json = new RegExp(`${REPORT_PREFIX} (?<json>.+)`, 'u').exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-1500)}`)
  report = JSON.parse(json) as VisibilityReport
}, RUN_TIMEOUT_MS + 30_000)

describe('P4-09 (A-611, B-729 red first): the model is shown the workflow nested-run interface and the registered signed definitions', () => {
  it('guard: the workflow tool was offered and the nested interface works when a script uses it', () => {
    // A trusted saved definition is registered and runs nested, so the reds below
    // are "the model is not told", not "the interface is missing or the def never registered".
    expect({ toolOffered: report.toolOffered, nestedRan: report.nestedRan }, JSON.stringify(report))
      .toEqual({ toolOffered: true, nestedRan: true })
  })

  it('the workflow tool description documents workflow(nameOrRef, args) and the request lists the signed definition name + digest (today neither — RED)', () => {
    // ① The model-facing description must document the nested-run interface.
    expect(report.descriptionMentionsNestedInterface, JSON.stringify(report)).toBe(true)
    // ① The registered signed definitions must be listed to the model (name + digest).
    expect(report.requestListsDefinition, JSON.stringify(report)).toBe(true)
  })
})
