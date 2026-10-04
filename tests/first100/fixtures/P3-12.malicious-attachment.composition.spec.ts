/**
 * P3-12 acceptance[1]: a zip bomb, a polyglot, a file whose bytes contradict
 * the type its name declares, and a malicious document do not enter the model
 * or a host parser. On the shipped `headless` profile an uploaded file is
 * committed by the attachment store before any session event, and so any
 * model request or parser, can refer to it; each such payload must therefore
 * be refused there, as a malicious attachment, before a copy of its bytes is
 * stored.
 *
 * `./P3-12.malicious-attachment-driver.ts` runs in a child process through
 * `runLoaderSmoke`, which isolates `DSH_HOME`, boots the profile through
 * `bootProductionProfile` over the existing headless test overlay, and
 * records what the mounted store's `saveFile` did with each payload. Two
 * benign files are the controls: the store still commits them, so a refusal
 * is about the payload and not every upload.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./P3-12.malicious-attachment-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('../../../packages/workspace/workspace-trust-local/tests/fixtures/headless-trust.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** What the driver recorded for one payload. */
interface Observation {
  readonly label: string
  readonly control: boolean
  readonly size: number
  readonly committed: boolean
  /** The committed reference's byte count, when the store returned one. */
  readonly bytes?: number
  /** The attachment failure code, when the store refused; `null` for a failure that is not an attachment error. */
  readonly code?: string | null
  /** Files that appeared during the call holding the payload's exact bytes. */
  readonly storedCopies: number
}

/** The payloads acceptance[1] names, one or more per kind of attack, in the driver's order. */
const MALICIOUS = [
  'zip bomb (compression ratio)',
  'zip bomb (nesting depth)',
  'polyglot (PNG that is also a ZIP)',
  'false MIME (executable named .jpg)',
  'false MIME (ELF named .pdf)',
  'malicious document (PDF that runs JavaScript on open)',
  'malicious document (Word file with a macro)',
] as const

/** Benign uploads the store must keep accepting. */
const CONTROLS = ['plain text file (control)', 'plain PNG image (control)'] as const

describe('P3-12 acceptance[1]: a zip bomb, a polyglot, a false MIME type and a malicious document do not enter the model or a host parser', () => {
  let observations: readonly Observation[] = []

  beforeAll(async () => {
    let raw = ''
    await runLoaderSmoke({
      label: 'P3-12 acceptance[1] malicious attachments (headless)',
      tempDirPrefix: 'p3-12-malicious-attachment-',
      binScript: driver,
      libBinScript: driver,
      configPath: overlay,
      binArgs: [overlay],
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => {
        raw = await readFile(join(cwd, 'observation.json'), 'utf8')
      },
    })
    observations = JSON.parse(raw) as Observation[]
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  /**
   * The record of one payload.
   * @param label - the payload.
   * @returns what the driver recorded for it.
   */
  function observed(label: string): Observation {
    const found = observations.find(observation => observation.label === label)
    if (found === undefined) throw new Error(`the driver recorded no payload labelled ${label}`)
    return found
  }

  it('records every payload this case names, in order', () => {
    expect(observations.map(observation => observation.label)).toEqual([...MALICIOUS, ...CONTROLS])
  })

  for (const label of MALICIOUS) {
    it(`refuses the ${label} as a malicious attachment before storing its bytes`, () => {
      expect(observed(label)).toMatchObject({ committed: false, code: 'MALICIOUS_ATTACHMENT', storedCopies: 0 })
    })
  }

  for (const label of CONTROLS) {
    it(`stores the ${label}`, () => {
      const observation = observed(label)
      expect(observation).toMatchObject({ committed: true, bytes: observation.size })
    })
  }
})
