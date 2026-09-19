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
import { readdir, readFile, writeFile } from 'node:fs/promises'
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

/** One message as the recorder saw it. */
interface RecordedMessage {
  readonly index: number
  readonly role: string
  readonly text: string
}

/**
 * What one run recorded, and enough of the run to explain an empty reading.
 *
 * `full` is the WHOLE request — the system slot plus every message's text —
 * because that is what the model was given. `dsh-agent-instructions` delivers
 * a project's own content as a user-role message
 * (`packages/context/agent-instructions/src/index.ts:190` composes a
 * `UserMessage`, `:429-431` splices it into the step), so a pair that searched
 * only the system prompt would report the boundary holding while the marker
 * sat one message below it.
 *
 * The diagnostic half is not decoration. The first version of this pair
 * asserted on an empty string twice and reported `expected '' to contain …`,
 * which is true of a boundary working, a driver that never reached a model
 * request, and a recorder reading the wrong field — and the run printed
 * nothing that could tell them apart.
 */
interface RecordedRun {
  /** The system prompt the adapter received, empty when none was recorded. */
  readonly system: string
  /** The system prompt and every message's text, which is everything the model read. */
  readonly full: string
  /** What the run says about itself, for an assertion message. */
  readonly diagnostic: string
}

/**
 * How this run is meant to obtain trust, if at all.
 *
 * `'launch-flag'` is the host user's unattended entry point — `dsh --profile
 * sdk --trust-workspace=read` — and it is a different mechanism from the
 * overlay, not a second spelling of it: the overlay is a deployment's standing
 * configuration, read at mount, while the flag writes a record during startup
 * and has to be durable before the first turn reads it.
 */
type TrustMode = 'none' | 'overlay' | 'launch-flag'

/** Run the driver once in an isolated cwd holding a project `AGENTS.md`, and return what it recorded. */
async function systemPromptFor(mode: TrustMode): Promise<RecordedRun> {
  let system = ''
  let messages: RecordedMessage[] = []
  let recorded = 'request.json was never read'
  let listing = '(cwd not inspected)'
  const result = await runLoaderSmoke({
    label: `sdk-app workspace trust smoke (${mode})`,
    tempDirPrefix: 'sdk-app-trust-smoke-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: repoTsconfig,
    env: {
      ...mode === 'overlay' ? { DSH_TRUST_FIXTURE_GRANT: '1' } : {},
      ...mode === 'launch-flag' ? { DSH_TRUST_FIXTURE_LAUNCH_FLAG: '1' } : {},
    },
    prepare: async (cwd) => {
      await writeFile(join(cwd, 'AGENTS.md'), `# Project\n\n${MARKER}\n`, 'utf8')
    },
    inspect: async (cwd) => {
      listing = (await readdir(cwd)).join(', ')
      let raw: string
      try {
        raw = await readFile(join(cwd, 'request.json'), 'utf8')
      } catch (error) {
        recorded = `request.json is absent (${String(error)}); the run reached no model request`
        return
      }
      const request = JSON.parse(raw) as {
        system?: string
        systemOption?: string | null
        messages?: RecordedMessage[]
      }
      system = request.system ?? ''
      messages = request.messages ?? []
      // Both raw readings and the per-message shape, because "the prompt was
      // empty" and "the recorder looked at the field a loop-built request
      // leaves unset" produce the same empty string at the assertion.
      recorded = `system=${String(system.length)} chars, systemOption=${JSON.stringify(request.systemOption)}`
        + `, messages=${JSON.stringify(messages.map(message => ({ i: message.index, role: message.role, chars: message.text.length })))}`
    },
  })
  const carrying = messages.filter(message => message.text.includes(MARKER))
  return {
    system,
    full: [system, ...messages.map(message => message.text)].join('\n'),
    diagnostic: [
      `mode=${mode}`,
      recorded,
      `marker in system: ${String(system.includes(MARKER))}`,
      `marker in messages: ${carrying.length === 0
        ? 'none'
        : carrying.map(message => `#${String(message.index)} (${message.role})`).join(', ')}`,
      `cwd contained: ${listing}`,
      `stdout tail: ${result.stdout.slice(-400)}`,
      `stderr tail: ${result.stderr.slice(-400)}`,
    ].join('\n'),
  }
}

describe('the sdk profile\'s project-trust boundary', () => {
  it('leaves an ungranted workspace\'s own AGENTS.md out of what the model is given', async () => {
    const run = await systemPromptFor('none')
    // The whole request, not the system slot: the project's own content
    // arrives as a user-role message, so searching less than this could call
    // a leak an absence.
    expect(run.full, run.diagnostic).not.toContain(MARKER)
    // The prompt is not empty for an unrelated reason: the profile's own
    // persona is there, so the absence above is the boundary and not a run
    // that never reached a model request. This is the check that caught the
    // recorder reading the wrong field, and it is deliberately not relaxed.
    expect(run.system.length, run.diagnostic).toBeGreaterThan(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('reads the same AGENTS.md once the host grants that directory', async () => {
    const run = await systemPromptFor('overlay')
    expect(run.full, run.diagnostic).toContain(MARKER)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('reads it after `--trust-workspace=read` alone, with no overlay granting anything', async () => {
    // The unattended entry point, end to end on the shipped profile: the flag
    // is parsed from the launcher's argv, the record is written while the tree
    // loads, and the first model request — the whole request, not the system
    // slot — already carries the project's own file. The ungranted case above
    // is this one's control: same driver, same directory, no flag.
    const run = await systemPromptFor('launch-flag')
    expect(run.full, run.diagnostic).toContain(MARKER)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
