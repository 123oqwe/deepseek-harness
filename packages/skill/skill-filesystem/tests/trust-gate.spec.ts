/**
 * Epic P1-07 must[1] at the one real project-level executable-content load
 * site: `<projectRoot>/.dsh/skills` and `<projectRoot>/.agents/skills`.
 *
 * Four of must[1]'s five named kinds — project plugins, hooks, MCP servers, and
 * home/profile patch overrides — have no project-sourced load site in this
 * product at all (recorded as BLOCKED-054), so a case over those would pass
 * because nothing loads them under any trust state, and would keep passing if
 * the gate were deleted. Executable skills are the kind that genuinely exists,
 * so this file is where the gate has to earn its regression protection.
 *
 * Every case below holds the fixture, the mount configuration, and the query
 * fixed, and varies ONLY the `TrustState` the `workspaceTrust` seam reports.
 * The difference in the catalog is therefore produced by the
 * `authorizeProjectLoad` decision and nothing else: removing or short-circuiting
 * that call makes the untrusted and trusted-read cases fail, which is the
 * property that makes this suite worth keeping.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'
import { afterEach, describe, expect, it } from 'vitest'
import * as SkillFileSystem from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

// realpath: macOS resolves the /var tmpdir through a symlink to /private/var,
// and the provider canonicalizes before it compares.
async function tempDir(name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `dsh-${name}-`)))
  roots.push(dir)
  return dir
}

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  await writeFile(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`)
}

/**
 * Stand-in for `@deepseek-ai/dsh-workspace-trust-local`, reporting one fixed
 * state. The real provider's own filesystem binding and reconciliation are
 * covered by its package tests and by `tests/first100/fixtures/P1-07.composition.spec.ts`;
 * pinning the state here is what isolates the gate from identity observation.
 */
function trustProvider(state: TrustState): { name: string; apply: (ctx: Context) => void } {
  return {
    name: 'workspace-trust-stub',
    apply(ctx: Context): void {
      ctx.provide('workspaceTrust', { stateFor: async () => state })
    },
  }
}

/**
 * One hostile clone: a project root carrying skills in both project roots, plus
 * a host-owned user skill that must never be affected by the project's trust.
 */
async function hostileClone(): Promise<{ home: string; project: string }> {
  const home = await tempDir('skill-trust-home')
  const project = await tempDir('skill-trust-project')
  await mkdir(join(project, '.git'), { recursive: true })
  await writeSkill(join(project, '.dsh/skills'), 'attacker-dsh', 'from the cloned repository')
  await writeSkill(join(project, '.agents/skills'), 'attacker-agents', 'from the cloned repository')
  await writeSkill(join(home, '.dsh/skills'), 'host-owned', 'from the host, not the project')
  return { home, project }
}

async function catalogFor(home: string, project: string, state: TrustState): Promise<string[]> {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(trustProvider(state))
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
  })
  try {
    return (await ctx.skills.list({ cwd: project })).map(skill => skill.name).sort()
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('P1-07 must[1] — an untrusted project never contributes an executable skill', () => {
  it('offers no skill from a cloned repository while the workspace is untrusted, and still offers the host-owned skill', async () => {
    const { home, project } = await hostileClone()
    expect(await catalogFor(home, project, 'untrusted')).toEqual(['host-owned'])
  })

  it('still offers no skill from the repository at trusted-read, because reading a project is not executing it', async () => {
    const { home, project } = await hostileClone()
    expect(await catalogFor(home, project, 'trusted-read')).toEqual(['host-owned'])
  })

  // The control that stops the two cases above from passing on a fixture that
  // was simply never read: the identical fixture, mount, and query at
  // trusted-execute must produce both project skills.
  it('offers both project skills once the workspace reaches trusted-execute, proving the fixture is real and the difference is the trust decision', async () => {
    const { home, project } = await hostileClone()
    expect(await catalogFor(home, project, 'trusted-execute')).toEqual([
      'attacker-agents',
      'attacker-dsh',
      'host-owned',
    ])
  })
})
