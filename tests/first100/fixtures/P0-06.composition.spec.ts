/**
 * P0-06 acceptance[2] on the shipped profiles: every migration the schema
 * registry holds after a real boot is the declared identity or carries a
 * declared reverse or irreversibility case.
 *
 * Each case runs `./P0-06.registry-census-driver.ts` in a child process
 * through `runLoaderSmoke`, which isolates `DSH_HOME`. The driver boots one
 * shipped profile through `bootProductionProfile` over an existing test
 * overlay that only disables the profile's startup and server rows and adds a
 * stand-in model, and writes the registry's census. A process per profile
 * keeps each census to that profile's own registrations, because the
 * registry is module state.
 *
 * The expected registrations are read from the product, not from a run: the
 * session-event ids from `KNOWN_SESSION_EVENT_TYPES`, the eleven sdk-protocol
 * wire ids the registry's own bootstrap names, and one `settings:<namespace>`
 * id per settings namespace the profile's rows install
 * ({@link SETTINGS_NAMESPACES}).
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { offendingIds, type CensusRecord } from './p0-06-registry-census.ts'

const driver = fileURLToPath(new URL('./P0-06.registry-census-driver.ts', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The existing test overlay each profile boots under, by profile name. */
const OVERLAYS: Readonly<Record<string, string>> = {
  'headless': fileURLToPath(new URL('../../../packages/workspace/workspace-trust-local/tests/fixtures/headless-trust.patch.yml', import.meta.url)),
  'acp': fileURLToPath(new URL('../../../packages/workspace/workspace-trust-local/tests/fixtures/acp-trust.patch.yml', import.meta.url)),
  'sdk': fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/workspace-trust.patch.yml', import.meta.url)),
  'sdk-minimal': fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/sdk-minimal-pep.patch.yml', import.meta.url)),
}

/** The sdk-protocol wire ids the registry bootstraps (`schema-registry/src/index.ts`, `PROTOCOL_WIRE_SCHEMA_IDS`). */
const PROTOCOL_WIRE_IDS = [
  'InitializeParams',
  'InitializeResult',
  'SessionPromptParams',
  'SessionPromptResult',
  'SessionEventNotification',
  'SessionStatusNotification',
  'SubagentStartedNotification',
  'SubagentFinishedNotification',
  'HostControlNotification',
  'HumanQuestionParams',
  'HumanQuestionResult',
] as const

/**
 * The settings namespaces dsh-base registers. `SettingsService.register`
 * registers each one's schema with the identity migration, and
 * `installSection` calls it. Registrants: agent-default-model, agent-loop,
 * permission-presets (`permission`), llm-deepseek, llm-pi-ai, bash-sandbox
 * through its `LocalBashExecutor` base (`shell`; pwsh-sandbox on win32),
 * web-search-deepseek and policy-language (`policy-set`). tool-subagent
 * registers none unless `modelSelectionSettings` is set, and dsh-base does not
 * set it.
 */
const DSH_BASE_SETTINGS = ['agent-default-model', 'agent-loop', 'llm-deepseek', 'llm-pi-ai', 'permission', 'policy-set', 'shell', 'web-search-deepseek'] as const

/**
 * The settings namespaces each profile registers. The headless, acp and sdk
 * bundles add no registrant to dsh-base; the sdk overlay disables
 * llm-deepseek. sdk-minimal mounts agent-loop, llm-deepseek and
 * policy-language, and its overlay disables llm-deepseek.
 */
const SETTINGS_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  'headless': DSH_BASE_SETTINGS,
  'acp': DSH_BASE_SETTINGS,
  'sdk': DSH_BASE_SETTINGS.filter(ns => ns !== 'llm-deepseek'),
  'sdk-minimal': ['agent-loop', 'policy-set'],
}

/** One registration as the driver recorded it. */
interface CensusEntry extends CensusRecord {
  readonly version: { readonly major: number, readonly minor: number }
  readonly historyLength: number
  readonly roundTrip: boolean
}

/**
 * Boot one shipped profile in a child process and read its registry census.
 * @param profile - the shipped profile to boot.
 * @returns the census entries the driver recorded.
 */
async function censusOf(profile: string): Promise<CensusEntry[]> {
  const overlay = OVERLAYS[profile]
  if (overlay === undefined) throw new Error(`no overlay for profile ${profile}`)
  let raw = ''
  await runLoaderSmoke({
    label: `P0-06 registry census (${profile})`,
    tempDirPrefix: `p0-06-census-${profile}-`,
    binScript: driver,
    libBinScript: driver,
    configPath: overlay,
    binArgs: [overlay, profile],
    tsconfigPath: repoTsconfig,
    inspect: async (cwd) => {
      raw = await readFile(join(cwd, 'census.json'), 'utf8')
    },
  })
  const census = JSON.parse(raw) as { readonly profile: string, readonly entries: CensusEntry[] }
  expect(census.profile).toBe(profile)
  return census.entries
}

describe('P0-06 acceptance[2]: every schema-registry migration a shipped profile registers is the declared identity or carries a declared reverse or irreversibility case', () => {
  it.each(['headless', 'acp', 'sdk', 'sdk-minimal'])('on the shipped %s profile', async (profile) => {
    const entries = await censusOf(profile)
    const ids = entries.map(entry => entry.schemaId)

    // The registrations are exactly the ones the product declares, so an empty
    // or partial census cannot pass the offender check below.
    expect(ids.filter(id => id.startsWith('session-event:')).sort())
      .toEqual([...KNOWN_SESSION_EVENT_TYPES].map(type => `session-event:${type}`).sort())
    expect(ids.filter(id => id.startsWith('sdk-protocol:')).sort())
      .toEqual(PROTOCOL_WIRE_IDS.map(name => `sdk-protocol:${name}`).sort())
    expect(ids.filter(id => id.startsWith('settings:')).sort())
      .toEqual(SETTINGS_NAMESPACES[profile]?.map(ns => `settings:${ns}`).sort())
    // No fourth registrant: every id belongs to one of the three production registrars.
    expect(ids.filter(id => !/^(?:session-event|sdk-protocol|settings):/u.test(id))).toEqual([])

    expect(offendingIds(entries)).toEqual([])
    expect(entries.filter(entry => !entry.roundTrip).map(entry => entry.schemaId)).toEqual([])
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
