/**
 * P2-05 acceptance[2] as C18 narrowed it: the Policy service cannot be
 * replaced through Cordis, and fails closed once it is unmounted. This file
 * observes the unmount half on the shipped `sdk-minimal` composition.
 *
 * `./P2-05.unmount-driver.ts` runs in a child process through
 * `runLoaderSmoke`, which points `DSH_HOME` at an isolated directory. The
 * driver boots the profile with the Trust Kernel pinned as the real launcher
 * pins it, drives one tool call, disables the `policy-engine` row through the
 * Loader, drives the same tool call again, and writes what each call met to
 * `observation.json`. The observation is read once in `beforeAll`; the cases
 * only read it.
 *
 * Not observed here: the replace half, which BLOCKED-313 records as
 * evidenced; and whether anything on the shipped product unmounts the row,
 * which is a question about callers rather than about this enforcement point.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./P2-05.unmount-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** One decision the pinned kernel audited. */
interface AuditedDecision {
  readonly effect: unknown
  readonly reason: unknown
}

/** What the driver recorded about one turn's tool call. */
interface TurnRecord {
  readonly probeRuns: number
  readonly results: readonly string[]
  readonly decisions: readonly AuditedDecision[]
}

/** Everything the driver recorded. */
interface Observation {
  readonly profile: string
  readonly trustKernel: boolean
  readonly policyMountedBefore: boolean
  readonly before: TurnRecord
  readonly unmount: { readonly rowId: string, readonly policyMountedAfter: boolean }
  readonly after: TurnRecord
}

describe('P2-05 acceptance[2] (narrowed by C18): the policy service unmounted through the Loader on the shipped sdk-minimal composition', () => {
  let observation: Observation | undefined
  let stderrTail = ''

  beforeAll(async () => {
    let raw = ''
    const result = await runLoaderSmoke({
      label: 'P2-05 acceptance[2] unmount observation',
      tempDirPrefix: 'p2-05-unmount-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        raw = await readFile(join(cwd, 'observation.json'), 'utf8')
      },
    })
    stderrTail = result.stderr.slice(-800)
    observation = JSON.parse(raw) as Observation
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  const recorded = (): Observation => {
    if (observation === undefined) throw new Error(`the driver recorded no observation; stderr tail: ${stderrTail}`)
    return observation
  }

  it('control: before the unmount, a tool call is permitted by the mounted engine and its body runs', () => {
    const { profile, trustKernel, policyMountedBefore, before } = recorded()
    expect(profile).toBe('sdk-minimal')
    expect(trustKernel).toBe(true)
    expect(policyMountedBefore).toBe(true)
    expect(before.probeRuns).toBe(1)
    expect(before.decisions.at(-1)).toEqual({ effect: 'permit', reason: undefined })
  })

  it('precondition: disabling the policy-engine row through the Loader withdraws the policy service', () => {
    const { unmount } = recorded()
    expect(unmount).toEqual({ rowId: 'policy-engine', policyMountedAfter: false })
  })

  it('acceptance[2]: after the unmount the same tool call fails closed, refused as policy-unavailable, and its body never runs', () => {
    const { after } = recorded()
    expect(after.probeRuns).toBe(0)
    expect(after.decisions.at(-1)).toEqual({ effect: 'deny', reason: 'policy-unavailable' })
    expect(after.results.some(text => text.includes('policy-unavailable'))).toBe(true)
  })
})
