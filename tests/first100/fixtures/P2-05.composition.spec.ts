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
 * `observation.json`. `beforeAll` runs the driver twice in parallel, each a
 * child process and so its own root: once as above, and once with
 * `--unmount-first`, which disables the row before any call has reached the
 * engine. The observations are read once there; the cases only read them.
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
  readonly policySet: unknown
}

/** What the driver recorded about one turn's tool call. */
interface TurnRecord {
  readonly probeRuns: number
  readonly results: readonly string[]
  readonly decisions: readonly AuditedDecision[]
}

/** Everything the driver recorded. */
interface Observation {
  readonly unmountFirst: boolean
  /** The plugin name of every Loader row the booted profile holds. */
  readonly rows: readonly string[]
  readonly trustKernel: boolean
  readonly policyMountedBefore: boolean
  readonly before: TurnRecord
  readonly unmount: { readonly rowId: string, readonly policyMountedAfter: boolean }
  readonly after: TurnRecord
}

describe('P2-05 acceptance[2] (narrowed by C18): the policy service unmounted through the Loader on the shipped sdk-minimal composition', () => {
  let observation: Observation | undefined
  let unmountedFirst: Observation | undefined

  /**
   * Run the driver once in its own child process.
   * @param binArgs - the driver's arguments.
   * @returns what it recorded.
   */
  async function observe(binArgs: readonly string[]): Promise<Observation> {
    let raw = ''
    const result = await runLoaderSmoke({
      label: `P2-05 acceptance[2] unmount observation ${binArgs.join(' ')}`,
      tempDirPrefix: 'p2-05-unmount-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      // `runLoaderSmoke` passes these instead of `[configPath]`, so the config path stays first.
      binArgs: [configPath, ...binArgs],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        raw = await readFile(join(cwd, 'observation.json'), 'utf8')
      },
    })
    if (raw === '') throw new Error(`the driver recorded no observation; stderr tail: ${result.stderr.slice(-800)}`)
    return JSON.parse(raw) as Observation
  }

  beforeAll(async () => {
    [observation, unmountedFirst] = await Promise.all([observe([]), observe(['--unmount-first'])])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  const recorded = (): Observation => {
    if (observation === undefined) throw new Error('beforeAll recorded no observation')
    return observation
  }

  it('control: before the unmount, a tool call is permitted by the mounted engine and its body runs', () => {
    const { unmountFirst, rows, trustKernel, policyMountedBefore, before } = recorded()
    // The composition is sdk-minimal's: its own shell row, and not dsh-base's plan-mode row.
    expect(unmountFirst).toBe(false)
    expect(rows).toContain('@deepseek-ai/dsh-tool-bash-persistent')
    expect(rows).not.toContain('@deepseek-ai/dsh-plan-mode')
    expect(trustKernel).toBe(true)
    expect(policyMountedBefore).toBe(true)
    expect(before.probeRuns).toBe(1)
    expect(before.decisions.at(-1)).toMatchObject({ effect: 'permit', reason: undefined })
  })

  it('precondition: disabling the policy-engine row through the Loader withdraws the policy service', () => {
    const { unmount } = recorded()
    expect(unmount).toEqual({ rowId: 'policy-engine', policyMountedAfter: false })
  })

  it('acceptance[2]: after the unmount the same tool call fails closed, refused as policy-unavailable, and its body never runs', () => {
    const { after } = recorded()
    expect(after.probeRuns).toBe(0)
    expect(after.decisions.at(-1)).toMatchObject({ effect: 'deny', reason: 'policy-unavailable' })
    // The engine answered before the unmount, so the refusal carries its digest, not the empty one.
    expect(after.decisions.at(-1)?.policySet).not.toBe('sha256-empty')
    expect(after.results.some(text => text.includes('policy-unavailable'))).toBe(true)
  })

  it('acceptance[2]: unmounted before any decision, the first tool call fails closed, refused as policy-unavailable with the empty policy set, and its body never runs', () => {
    if (unmountedFirst === undefined) throw new Error('beforeAll recorded no --unmount-first observation')
    const { unmountFirst, trustKernel, policyMountedBefore, before, unmount, after } = unmountedFirst
    expect(unmountFirst).toBe(true)
    expect(trustKernel).toBe(true)
    expect(policyMountedBefore).toBe(true)
    expect(before.decisions).toEqual([])
    expect(unmount).toEqual({ rowId: 'policy-engine', policyMountedAfter: false })
    expect(after.probeRuns).toBe(0)
    expect(after.decisions.at(-1)).toEqual({ effect: 'deny', reason: 'policy-unavailable', policySet: 'sha256-empty' })
  })
})
