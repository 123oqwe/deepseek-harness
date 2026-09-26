/**
 * P6-03 must[1] with no policy to decide: on the shipped headless profile with
 * the base layer's `memory` row enabled and its `memory-policy` row switched
 * off, no proposal becomes active memory. A proposal waits for a decision
 * nobody is there to make, rather than falling back to a direct write.
 *
 * The driver is `./loader/p6-03-proposal/driver.ts`, the one
 * `P6-03.composition.spec.ts` uses, over `policy-off.patch.yml`. Today the
 * base layer has no `memory-policy` row, so the overlay's switch matches
 * nothing and `propose` writes straight to the store.
 * @module tests/first100/fixtures/P6-03.policy-off.composition
 */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { beforeAll, describe, expect, it } from 'vitest'

const driver = fileURLToPath(new URL('./loader/p6-03-proposal/driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/policy-off.patch.yml', import.meta.url))
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
    label: 'P6-03 proposal with memory-policy off',
    tempDirPrefix: 'p6-03-policy-off-',
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

describe('P6-03 with memory-policy switched off on the shipped headless profile: no proposal becomes active memory', () => {
  it('a complete normal proposal is accepted to wait, and the default search does not return it', () => {
    expect(outcome('normal')).toStrictEqual({ name: 'normal', active: false })
  })

  it('a sensitive proposal is accepted to wait, and the default search does not return it', () => {
    expect(outcome('sensitive')).toStrictEqual({ name: 'sensitive', active: false })
  })

  it('a proposal whose origin names nobody is still refused before any policy is asked', () => {
    const noEvidence = outcome('no-evidence')
    expect(noEvidence.thrown).toBeDefined()
    expect(noEvidence.active).toBe(false)
  })
})
