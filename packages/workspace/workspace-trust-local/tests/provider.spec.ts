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

  it('CHARACTERIZATION: a restart re-reads the grant, so a directory replaced while the process was down is trusted again', async () => {
    // The in-process defence above is a record held in memory: once a binding
    // exists the grant is never re-consulted, so a swap cannot be un-done by
    // configuration. A restart has no such record. This case measures what a
    // second process does with the SAME configuration over a directory that was
    // replaced while nothing was running — which is the shape an attacker gets
    // for free, because a workstation restarts and a clone is cheap.
    const root = await makeRoot()
    const project = join(root, 'project')
    await mkdir(project)
    const grants: TrustGrant[] = [{ path: project, state: 'trusted-execute' }]

    const first = await mount(grants)
    try {
      expect(await first.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await first.fiber.dispose()
    }

    // The directory the operator granted is gone; a different one now stands at
    // the same path with the same name and a different inode.
    await rm(project, { recursive: true })
    await mkdir(project)

    const restarted = await mount(grants)
    try {
      // Measured, NOT endorsed. This is what the code does today and the case
      // exists so the behaviour is visible rather than assumed; whether a
      // path-keyed grant is meant to survive the directory it named is
      // BLOCKED-199's ruling. The interaction it stands in for would not:
      // `bindWorkspaceTrust` binds to an IDENTITY, and acceptance[1] says trust
      // is not inherited through replacement.
      expect(await restarted.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await restarted.fiber.dispose()
    }
  })

  it('CHARACTERIZATION: a restart re-canonicalizes a granted symlink, so retargeting it while the process was down trusts the new target', async () => {
    // The same gap reached without touching the granted path at all. Within one
    // process `canonicalGrants` is resolved once precisely so a retargeted
    // symlink cannot canonicalize onto the attacker's directory — the package's
    // own comment says so. A restart resolves it again, against the new target.
    const root = await makeRoot()
    const granted = join(root, 'granted')
    const original = join(root, 'original')
    const attacker = join(root, 'attacker')
    await mkdir(original)
    await mkdir(attacker)
    await symlink(original, granted)
    const grants: TrustGrant[] = [{ path: granted, state: 'trusted-execute' }]

    const first = await mount(grants)
    try {
      expect(await first.workspaceTrust.stateFor(granted)).toBe('trusted-execute')
    } finally {
      await first.fiber.dispose()
    }

    await rm(granted)
    await symlink(attacker, granted)

    const restarted = await mount(grants)
    try {
      // Measured, not endorsed — see the case above. The attacker's directory
      // is now trusted-execute without ever having been granted.
      expect(await restarted.workspaceTrust.stateFor(attacker)).toBe('trusted-execute')
    } finally {
      await restarted.fiber.dispose()
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
