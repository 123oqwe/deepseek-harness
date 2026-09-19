/**
 * BLOCKED-266, second half: what a tool call on `sdk-minimal` meets when the
 * Trust Kernel is pinned the way the real launcher pins it.
 *
 * **The first observation answered a narrower question than its name.** It
 * booted through `bootProductionProfile`, which never calls `createTrustKernel`
 * — so `ctx.get('trustKernel')` was absent, and with no kernel
 * `decideManifestedAction` returns `undefined` (`agent-loop/src/tool-calls.ts:755`),
 * which ADMITS. "Executed with no decision" was therefore a property of a
 * kernel-less composition, and the shipped launcher pins one unconditionally
 * (`apps/cli/src/profile-boot.ts:575-577`, `:638`). This case runs the other
 * composition so the register can say which answer belongs to which.
 *
 * **It records; it does not judge**, for the same reason as the first: ruling
 * on what the answer SHOULD be is the delegate's, and a case that failed on
 * either branch would be asserting a conclusion rather than producing one.
 * Lane A's read of the source expects a deny or `policy-unavailable` once a
 * kernel is present; this case does not assert that, so if the expectation is
 * wrong the record says so instead of the case hiding it.
 *
 * **It is not an always-green ornament.** It fails whenever the observation did
 * not happen or is unreadable: `observation.json` absent, malformed, missing a
 * field, `toolBodyRan` not a boolean, a `decisions` entry that is neither
 * `null` nor an object carrying an `effect`, or `bootMethod` not naming this
 * composition. Deleting the driver's `prepare` hook reddens it, because
 * `trustKernel` would then read `false`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/sdk-minimal-pep-kernel-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One policy decision as the driver read it back out of the session log. */
interface RecordedDecision {
  readonly effect: string | null
  readonly reason: string | null
}

/** Everything the driver recorded about the one tool call it drove. */
interface Observation {
  readonly profile: string
  readonly bootMethod: string
  readonly toolBodyRan: boolean
  readonly manifestEvents: number
  readonly decisions: readonly (RecordedDecision | null)[]
  readonly services: Record<string, boolean>
  readonly toolResultTexts: readonly string[]
}

describe('P2-05 acceptance[0] / BLOCKED-266: one tool call on sdk-minimal WITH the Trust Kernel pinned', () => {
  it('records what the action met once a kernel is present, so the first observation stops standing for both', async () => {
    let raw = ''
    const result = await runLoaderSmoke({
      label: 'sdk-minimal PEP observation (kernel pinned)',
      tempDirPrefix: 'sdk-minimal-pep-kernel-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        raw = await readFile(join(cwd, 'observation.json'), 'utf8').catch((error: unknown) => `ABSENT: ${String(error)}`)
      },
    })

    // No exit-code assertion: a non-zero exit THROWS out of `runLoaderSmoke`
    // (`loader-smoke/src/index.ts:171-176` carries only stdout and stderr), so
    // a boot that cannot start fails before this line. The stderr tail travels
    // in the message because "booted and wrote nothing" and "never booted"
    // read identically at an absent file.
    expect(raw, `the driver must write observation.json; without it there is no observation. stderr tail: ${result.stderr.slice(-800)}`)
      .not.toMatch(/^ABSENT: /u)

    const observation = JSON.parse(raw) as Observation
    expect(observation.profile).toBe('sdk-minimal')
    // The decisive assertion of this case as distinct from the first: it is
    // about the composition that HAS a kernel, and a record that says
    // otherwise is recording the wrong run.
    expect(observation.bootMethod).toBe('kernel-pinned')
    expect(observation.services.trustKernel, 'the prepare hook must have pinned a kernel, or this case observes the first case again').toBe(true)
    expect(typeof observation.toolBodyRan, 'the record must say whether the tool body ran').toBe('boolean')
    expect(typeof observation.manifestEvents).toBe('number')
    expect(Array.isArray(observation.decisions)).toBe(true)
    for (const decision of observation.decisions) {
      if (decision === null) continue
      expect(Object.hasOwn(decision, 'effect'), 'a recorded decision must carry its effect').toBe(true)
    }
    expect(Object.keys(observation.services).sort()).toEqual(['actionLedger', 'policy', 'policySet', 'sandboxPolicy', 'trustKernel'])

    // The observation IS this case's output. Read this line beside the first
    // one's rather than inferring either from the profile's YAML rows.
    console.log(`[BLOCKED-266] sdk-minimal PEP observation (kernel pinned): ${JSON.stringify(observation)}`)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
