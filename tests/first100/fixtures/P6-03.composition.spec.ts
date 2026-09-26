/**
 * P6-03's first slice on the shipped composition: a memory proposal passes a
 * policy decision before it becomes active memory (must[1] 「Policy 决定
 * auto-accept/review/reject」, must[2] 「高敏感默认人工。」, acceptance[0]
 * 「伪造无证据 proposal 不进入 active memory。」).
 *
 * `./loader/p6-03-proposal/driver.ts` boots the SHIPPED headless profile with
 * the base layer's `memory` row enabled and submits three proposals through
 * `ctx.memory.propose`: a complete `normal` one (the control), the same one
 * marked `sensitive`, and one whose origin names nobody. Active memory is read
 * through the default search, the retrieval P6-02 limits to active records.
 * The overlay lets that search return sensitive content, so a sensitive
 * proposal it does not return is one that is not active. Today `propose`
 * writes straight to the store, and the sensitive proposal is active at once.
 * @module tests/first100/fixtures/P6-03.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What one proposal came to, as the driver reported it. */
interface Outcome {
  readonly name: string
  readonly thrown?: string
  readonly active: boolean
}

let outcomes: readonly Outcome[] = []

beforeAll(async () => {
  const { stdout, stderr } = await runLoaderSmoke({
    label: 'P6-03 proposal',
    tempDirPrefix: 'p6-03-proposal-',
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    tsconfigPath: repoTsconfig,
  })
  const json = /P6-03-PROPOSAL (?<json>.+)/u.exec(stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver reported nothing usable; stderr tail:\n${stderr.slice(-800)}`)
  outcomes = (JSON.parse(json) as { outcomes: readonly Outcome[] }).outcomes
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

/**
 * The outcome of one named proposal.
 * @param name - the proposal's name in the driver.
 * @returns its outcome.
 */
function outcome(name: string): Outcome {
  const found = outcomes.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`the driver reported no "${name}" proposal: ${JSON.stringify(outcomes)}`)
  return found
}

describe('P6-03 first slice on the shipped headless profile: a proposal is decided before it is active memory', () => {
  it('control: a complete normal proposal is accepted, and the default search returns it', () => {
    expect(outcome('normal')).toStrictEqual({ name: 'normal', active: true })
  })

  it('must[2]: a sensitive proposal waits for a person: propose accepts it, and the default search does not return it', () => {
    expect(outcome('sensitive')).toStrictEqual({ name: 'sensitive', active: false })
  })

  it('acceptance[0]: a proposal whose origin names nobody is refused and never becomes active', () => {
    const noEvidence = outcome('no-evidence')
    expect(noEvidence.thrown).toBeDefined()
    expect(noEvidence.active).toBe(false)
  })
})
