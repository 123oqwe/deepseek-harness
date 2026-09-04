/**
 * Usage-stage coverage for the host-local workspace trust provider: the seam
 * Epic P1-07's Consumers read, resolving a session `cwd` to a `TrustState`
 * against the real filesystem.
 *
 * Every case runs against real directories under a realpath-resolved temporary
 * root — macOS resolves `/var` to `/private/var`, so a literal comparison
 * against `os.tmpdir()` would hold on APFS and fail on ext4.
 */

import { mkdtemp, mkdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { TrustGrant } from '../src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'
import * as WorkspaceTrustLocal from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-workspace-trust-local-')))
  roots.push(root)
  return root
}

async function mount(grants: TrustGrant[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(WorkspaceTrustLocal, { grants })
  return ctx
}

describe('P1-07 Usage — the workspace trust seam over a real filesystem', () => {
  it('resolves an ungranted workspace to untrusted, so a freshly cloned repository is never trusted by default', async () => {
    const root = await makeRoot()
    const project = join(root, 'clone')
    await mkdir(project)
    const ctx = await mount([])
    try {
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves a granted workspace to its granted state', async () => {
    const root = await makeRoot()
    const project = join(root, 'project')
    await mkdir(project)
    const ctx = await mount([{ path: project, state: 'trusted-execute' }])
    try {
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves a granted path spelled through a symlink to the same state, since the grant is canonicalized before it is bound', async () => {
    const root = await makeRoot()
    const project = join(root, 'project')
    const link = join(root, 'link')
    await mkdir(project)
    await symlink(project, link)
    const ctx = await mount([{ path: project, state: 'trusted-execute' }])
    try {
      expect(await ctx.workspaceTrust.stateFor(link)).toBe('trusted-execute')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  // acceptance[1] at the seam: the grant names a path, but trust bound to the
  // identity behind it. Re-granting from configuration after the directory
  // changed would hand an attacker the trust of the directory they replaced.
  it('drops a granted workspace to untrusted once the directory at that path is replaced, and does not re-grant it from configuration', async () => {
    const root = await makeRoot()
    const project = join(root, 'project')
    await mkdir(project)
    const ctx = await mount([{ path: project, state: 'trusted-execute' }])
    try {
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-execute')
      await rm(project, { recursive: true })
      await mkdir(project)
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('drops a granted workspace to untrusted once the symlink it was opened through is retargeted to another directory', async () => {
    const root = await makeRoot()
    const project = join(root, 'project')
    const other = join(root, 'other')
    const link = join(root, 'link')
    await mkdir(project)
    await mkdir(other)
    await symlink(project, link)
    const ctx = await mount([{ path: link, state: 'trusted-execute' }])
    try {
      expect(await ctx.workspaceTrust.stateFor(link)).toBe('trusted-execute')
      await rm(link)
      await symlink(other, link)
      expect(await ctx.workspaceTrust.stateFor(link)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('drops a granted workspace to untrusted once the directory is moved out from under the path it was granted at', async () => {
    const root = await makeRoot()
    const project = join(root, 'project')
    const moved = join(root, 'moved')
    await mkdir(project)
    const ctx = await mount([{ path: project, state: 'trusted-execute' }])
    try {
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-execute')
      await rename(project, moved)
      expect(await ctx.workspaceTrust.stateFor(moved)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
