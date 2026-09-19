/**
 * BLOCKED-266: what a tool call on the shipped `sdk-minimal` profile actually
 * meets.
 *
 * **This observes a different profile than the rest of this directory, and that
 * is deliberate.** The subject is the PROFILE, which
 * `bootProductionProfile({ profile: 'sdk-minimal' })` names; the harness the
 * observation needs — loader-smoke, app-boot, agent-loop, tools, llm,
 * principal — is already a devDependency of `@deepseek-ai/dsh-sdk-app` and of
 * none of `packages/bundle/sdk-minimal`, which declares one devDependency in
 * total. Seven new dependency edges plus their hand-written lockfile importers,
 * for one observation, is the cost this placement avoids, and a hand-written
 * lockfile edge is what reddened `Install (frozen)` on 2026-09-19.
 *
 * **It records; it does not judge.** P2-05's `acceptance[0]` names "the SAME
 * enforcement point the native path uses", and lane A read `sdk-minimal`'s rows
 * statically (A-61): the dispatch stack is all there, and
 * `dsh-policy-engine-cedar` is not among them. From that reading alone, every
 * action on this profile is either refused or admitted without a policy
 * decision, and **nobody has ever run one to find out which**. Until the
 * delegate rules on what the answer should be, a case that failed on either
 * branch would be asserting a conclusion rather than producing one. So the
 * driver writes what happened and this spec checks that the record exists and
 * is well formed, then prints it for the run's log.
 *
 * **It is not an always-green ornament.** It fails whenever the observation did
 * not happen or is not readable: `observation.json` absent (the boot died, the
 * turn never reached a model request, or the driver threw before writing),
 * malformed JSON, a missing field, `toolBodyRan` not a boolean, or a `decisions`
 * entry that is neither `null` nor an object carrying an `effect`. Deleting the
 * `writeFile` call in the driver, or the `register` of the probe tool, reddens
 * it. What it deliberately does not do is assert WHICH of the two branches the
 * profile takes.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/sdk-minimal-pep-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/sdk-minimal-pep.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** One policy decision as the driver read it back out of the session log. */
interface RecordedDecision {
  readonly effect: string | null
  readonly reason: string | null
}

/** Everything the driver recorded about the one tool call it drove. */
interface Observation {
  readonly profile: string
  readonly toolBodyRan: boolean
  readonly manifestEvents: number
  readonly decisions: readonly (RecordedDecision | null)[]
  readonly services: Record<string, boolean>
  readonly toolResultTexts: readonly string[]
}

describe('P2-05 acceptance[0] / BLOCKED-266: one tool call on the shipped sdk-minimal profile', () => {
  it('records what the action met — a policy decision or none, and whether the tool body ran', async () => {
    let raw = ''
    const result = await runLoaderSmoke({
      label: 'sdk-minimal PEP observation',
      tempDirPrefix: 'sdk-minimal-pep-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        raw = await readFile(join(cwd, 'observation.json'), 'utf8').catch((error: unknown) => `ABSENT: ${String(error)}`)
      },
    })

    // The boot itself is part of the observation: a profile that cannot start
    // answers nothing about what its actions meet.
    expect(result.exitCode, `the driver exited ${String(result.exitCode)}; stderr tail: ${result.stderr.slice(-800)}`).toBe(0)
    expect(raw, 'the driver must write observation.json; without it there is no observation').not.toMatch(/^ABSENT: /u)

    const observation = JSON.parse(raw) as Observation
    expect(observation.profile).toBe('sdk-minimal')
    expect(typeof observation.toolBodyRan, 'the record must say whether the tool body ran').toBe('boolean')
    expect(typeof observation.manifestEvents).toBe('number')
    expect(Array.isArray(observation.decisions)).toBe(true)
    for (const decision of observation.decisions) {
      if (decision === null) continue
      expect(Object.hasOwn(decision, 'effect'), 'a recorded decision must carry its effect').toBe(true)
    }
    expect(Object.keys(observation.services).sort()).toEqual(['actionLedger', 'policyEngine', 'sandboxPolicy', 'trustKernel'])

    // The observation IS this case's output: read this line in the run's log
    // rather than inferring the profile's behaviour from its YAML rows. A case
    // that asserted only shape would leave it unreadable.
    console.log(`[BLOCKED-266] sdk-minimal PEP observation: ${JSON.stringify(observation)}`)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
