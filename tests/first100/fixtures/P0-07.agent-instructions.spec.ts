/**
 * P0-07 acceptance[2] as C19 narrowed it: the repository's `AGENTS.md`
 * requires an evidence-gate report to cite the evidence package's real path
 * and its `accepted` status, and the shipped `dsh-agent-instructions` loads
 * that rule into the agent's context. The clause does not require or check
 * that an answer cites them.
 *
 * The workspace's `AGENTS.md` is this repository's own file, copied in at test
 * time, so the rule under test is the one the repository states. The run uses
 * P1-07 U.3's driver (`packages/bundle/sdk-app/tests/fixtures/driver.ts`),
 * which boots the shipped `sdk` profile (dsh-base plus the sdk app) through
 * `bootProductionProfile` in a child process and records the whole model
 * request, the system slot and every message, to `request.json`; its overlay
 * grants the run directory when `DSH_TRUST_FIXTURE_GRANT=1`. The untrusted run
 * is the control: the same file is not read there, so the rule the trusted
 * run shows came from the project file and not from the harness's own prompt.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const repositoryAgents = fileURLToPath(new URL('../../../AGENTS.md', import.meta.url))
const driver = fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/sdk-app/tests/fixtures/workspace-trust.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

/** The two halves the rule must carry into the agent's context. */
const PATH_HALF = 'cite the package\'s real path'
const STATUS_HALF = '`accepted` status'

/**
 * The repository's evidence-gate rule, as one line of its `AGENTS.md`.
 * @param agents - the file's text.
 * @returns the line.
 * @throws when the repository no longer states the rule, which leaves nothing to observe.
 */
function evidenceGateRule(agents: string): string {
  const lines = agents.split('\n').filter(line => line.includes('Evidence-gate reporting'))
  if (lines.length !== 1) throw new Error(`the repository AGENTS.md states the evidence-gate rule on ${String(lines.length)} lines, expected 1`)
  const [line] = lines as [string]
  if (!line.includes(PATH_HALF) || !line.includes(STATUS_HALF)) throw new Error(`the evidence-gate rule no longer names both halves: ${line}`)
  return line
}

/**
 * Run the driver once in a fresh directory holding this repository's `AGENTS.md`.
 * @param granted - whether the overlay grants the run directory.
 * @returns the whole model request as text, and a diagnostic for assertion messages.
 */
async function modelInput(granted: boolean): Promise<{ readonly full: string, readonly diagnostic: string }> {
  const agents = await readFile(repositoryAgents, 'utf8')
  let full = ''
  let recorded = 'request.json was never read'
  const result = await runLoaderSmoke({
    label: `P0-07 acceptance[2] agent instructions (${granted ? 'trusted' : 'untrusted'})`,
    tempDirPrefix: 'p0-07-agent-instructions-',
    binScript: driver,
    libBinScript: driver,
    configPath,
    tsconfigPath: repoTsconfig,
    env: granted ? { DSH_TRUST_FIXTURE_GRANT: '1' } : {},
    prepare: async (cwd) => {
      await writeFile(join(cwd, 'AGENTS.md'), agents, 'utf8')
    },
    inspect: async (cwd) => {
      const request = JSON.parse(await readFile(join(cwd, 'request.json'), 'utf8')) as {
        readonly system?: string
        readonly messages?: readonly { readonly text: string }[]
      }
      full = [request.system ?? '', ...(request.messages ?? []).map(message => message.text)].join('\n')
      recorded = `system=${String((request.system ?? '').length)} chars, messages=${String((request.messages ?? []).length)}`
    },
  })
  return { full, diagnostic: `${recorded}\nstderr tail: ${result.stderr.slice(-400)}` }
}

describe('P0-07 acceptance[2] (narrowed by C19): the repository AGENTS.md evidence-gate rule on the shipped sdk composition', () => {
  it('a trusted workspace\'s AGENTS.md reaches the model with the rule to cite the evidence package path and its accepted status', async () => {
    const rule = evidenceGateRule(await readFile(repositoryAgents, 'utf8'))
    const { full, diagnostic } = await modelInput(true)
    expect(full, diagnostic).toContain(rule)
    expect(full, diagnostic).toContain(PATH_HALF)
    expect(full, diagnostic).toContain(STATUS_HALF)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('control: an untrusted workspace\'s AGENTS.md does not, so the rule the model reads comes from the project file', async () => {
    const rule = evidenceGateRule(await readFile(repositoryAgents, 'utf8'))
    const { full, diagnostic } = await modelInput(false)
    expect(full.length, diagnostic).toBeGreaterThan(0)
    expect(full, diagnostic).not.toContain(rule)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
