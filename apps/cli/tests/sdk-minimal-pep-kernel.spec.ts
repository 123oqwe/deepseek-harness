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
 * **It recorded rather than judged, and that has changed — the question it was
 * waiting on is answered.** While the profile mounted no policy engine, ruling
 * on what the answer SHOULD be was the delegate's, and a case failing on either
 * branch would have asserted a conclusion rather than produced one. Lane A's
 * read then expected a deny or `policy-unavailable` once a kernel was present,
 * and the observation agreed. **`e8a36fef6d` gave the profile the engine**, so
 * the expected answer is now a permit, and this case asserts it: the header's
 * old "does not assert that" was true of a profile that had no policy to state.
 *
 * **It is not an always-green ornament.** It fails whenever the observation did
 * not happen or is unreadable — `observation.json` absent, malformed, missing a
 * field, or `bootMethod` not naming this composition — and it now also fails
 * when the tool body did NOT run, or ran without the profile's own permit being
 * among the policies the audit names. Deleting the driver's `prepare` hook
 * reddens it, because `trustKernel` would then read `false`.
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
/** Everything the driver recorded about the one tool call it drove. */
interface Observation {
  readonly profile: string
  readonly bootMethod: string
  readonly toolBodyRan: boolean
  readonly manifestEvents: number
  /** Every policy id the engine matched this turn, across all decisions. */
  readonly matchedPolicyIds: readonly string[]
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
    // **A real assertion, not a type check.** `typeof … === 'boolean'` held
    // while the answer was unknown; the answer is known now. And it has to be
    // asserted BESIDE the policy id, not instead of it: `matched` containing
    // this profile's permit is also true of a turn where a `forbid` matched as
    // well and the action was refused. One says a policy spoke, the other says
    // what happened — neither implies the other.
    expect(observation.toolBodyRan, 'the profile now mounts an engine that permits, so the tool body must have run').toBe(true)
    expect(typeof observation.manifestEvents).toBe('number')
    // **P2-05 acceptance[0]'s third observation: the permit has a name.**
    // `toolBodyRan: true` says the call was not refused; it does not say a
    // policy permitted it rather than nothing objecting. This is the
    // difference, and it is the reason the profile states its permit as a
    // policy with an id of its own instead of leaning on `baseline-permit`.
    //
    // CONTAINS, not equals: a permit can match more than one policy, and a
    // deployment adding its own must not break this case — narrowing the set
    // is exactly what the `policy-set` namespace is for.
    expect(observation.matchedPolicyIds, 'the audit must name the policy that permitted the call, not merely record that one ran')
      .toContain('sdk-minimal-danger-full-access')
    // `decisions` is gone, and the loop that checked it was vacuous: every
    // entry was `null` because `action/manifest-appended` carries no
    // `decision` field, so the body never ran. `manifestEvents` above is the
    // fact this event can answer; the policy ids it was reaching for live in
    // the kernel's audit sink, not here.
    expect(Object.keys(observation.services).sort()).toEqual(['actionLedger', 'policy', 'policySet', 'sandboxPolicy', 'trustKernel'])

    // The observation IS this case's output. Read this line beside the first
    // one's rather than inferring either from the profile's YAML rows.
    console.log(`[BLOCKED-266] sdk-minimal PEP observation (kernel pinned): ${JSON.stringify(observation)}`)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
