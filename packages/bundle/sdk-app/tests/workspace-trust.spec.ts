/**
 * The project-trust boundary as the shipped `sdk` profile composes it.
 *
 * The bundle overrides `workspace-trust-local` to `disabled: false`, which is
 * a visible behaviour change: a working directory this host has not granted no
 * longer has its own `AGENTS.md` read into what the model is given. Two runs
 * observe it, because one alone cannot: a run showing the file absent is
 * indistinguishable from a composition that never loads project instructions
 * at all until the granted run shows the same file present.
 *
 * What is asserted is the system prompt the adapter actually received — the
 * text the model would read — not a row in a YAML file. The mutation the pair
 * is built against is removing the bundle's two override lines: the base row
 * ships `disabled: true`, the boundary goes away, and the ungranted run then
 * finds the marker in the prompt.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/workspace-trust.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/**
 * The marker the seeded `AGENTS.md` carries.
 *
 * Improbable on purpose: the assertion is that this exact string reached the
 * model, and a word the harness or the base prompt could produce by itself
 * would make the granted run pass without the file being read.
 */
const MARKER = 'carmine-heliotrope-48219'

/** Run the driver once in an isolated cwd holding a project `AGENTS.md`, and return the system prompt it recorded. */
async function systemPromptFor(grant: boolean): Promise<string> {
  let recorded = ''
  await runLoaderSmoke({
    label: `sdk-app workspace trust smoke (${grant ? 'granted' : 'ungranted'})`,
    tempDirPrefix: 'sdk-app-trust-smoke-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: repoTsconfig,
    env: grant ? { DSH_TRUST_FIXTURE_GRANT: '1' } : {},
    prepare: async (cwd) => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(cwd, 'AGENTS.md'), `# Project\n\n${MARKER}\n`, 'utf8')
    },
    inspect: async (cwd) => {
      const request = JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8')) as { system?: string }
      recorded = request.system ?? ''
    },
  })
  return recorded
}

describe('the sdk profile\'s project-trust boundary', () => {
  it('leaves an ungranted workspace\'s own AGENTS.md out of what the model is given', async () => {
    const system = await systemPromptFor(false)
    expect(system).not.toContain(MARKER)
    // The prompt is not empty for an unrelated reason: the profile's own
    // persona is there, so the absence above is the boundary and not a run
    // that never reached a model request.
    expect(system.length).toBeGreaterThan(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('reads the same AGENTS.md once the host grants that directory', async () => {
    expect(await systemPromptFor(true)).toContain(MARKER)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
