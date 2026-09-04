/**
 * Epic P1-07 at the instruction-discovery load site. The registry `gate` names
 * instructions first among what an untrusted workspace must not load
 * ("Untrusted workspace cannot load instructions/hooks/skills/MCP or execute"),
 * and validation[1] requires a trusted-read workspace to inject project text as
 * plain text — so `'project-instructions'` is the one `ProjectContentKind`
 * whose decision differs between `'untrusted'` and `'trusted-read'`.
 *
 * The host's own `$DSH_HOME/AGENTS.md` is never project-supplied and stays
 * visible at every state; only the root-to-cwd chain is gated. Each case holds
 * the fixture and the query fixed and varies only the reported `TrustState`.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverBaselineInstructionFiles } from '../src/files.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

// realpath: the /var tmpdir symlink on macOS would otherwise make the
// project-root walk disagree with the canonical path trust is bound to.
async function makeClone(): Promise<{ home: string; project: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agent-instructions-trust-')))
  roots.push(root)
  const home = join(root, 'home')
  const project = join(root, 'clone')
  await mkdir(home, { recursive: true })
  await mkdir(join(project, '.git'), { recursive: true })
  await writeFile(join(home, 'AGENTS.md'), '# Host instructions\n')
  await writeFile(join(project, 'AGENTS.md'), '# Instructions from the cloned repository\n')
  return { home, project }
}

async function displayPathsAt(state: TrustState): Promise<string[]> {
  const { home, project } = await makeClone()
  const files = await discoverBaselineInstructionFiles({
    cwd: project,
    dshHome: home,
    trustState: state,
  })
  return files.map(file => file.displayPath).sort()
}

describe("P1-07 gate — an untrusted workspace's own instructions never reach the model", () => {
  it('discovers only the host-owned user-global instructions while the workspace is untrusted', async () => {
    expect(await displayPathsAt('untrusted')).toEqual(['$DSH_HOME/AGENTS.md'])
  })

  // validation[1]: trusted-read is the state at which project text may be
  // injected, which is the whole reason it exists as a state distinct from
  // untrusted. This is also the control proving the fixture's own AGENTS.md is
  // real and discoverable, so the case above cannot pass on an unread fixture.
  it('discovers the project instructions once the workspace reaches trusted-read, alongside the host-owned ones', async () => {
    expect(await displayPathsAt('trusted-read')).toEqual(['$DSH_HOME/AGENTS.md', 'AGENTS.md'])
  })

  it('discovers the project instructions at trusted-execute as well, since a higher state never loads less', async () => {
    expect(await displayPathsAt('trusted-execute')).toEqual(['$DSH_HOME/AGENTS.md', 'AGENTS.md'])
  })
})
