import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { createServicePrincipal, createUserPrincipal } from '@deepseek-ai/dsh-principal/chain'
import { bindWorkspaceTrust, reconcileWorkspaceTrust } from '@deepseek-ai/dsh-workspace-trust'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry, { observeWorkspaceIdentity } from '../src/index.ts'

const hostUser = createUserPrincipal(PrincipalId('host-user'), TenantId('tenant-a'))
const serviceActor = createServicePrincipal(PrincipalId('svc'), TenantId('tenant-a'))

const roots: string[] = []
const disposers: (() => Promise<void>)[] = []

/** A private temp root owned by exactly one test, canonicalized so no assertion compares a symlinked `/tmp` spelling. */
async function tempRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-p107-')))
  roots.push(root)
  return root
}

/**
 * Recursively remove a directory, refusing any path that is not strictly
 * inside a root this file itself created with `mkdtemp`. The recursive
 * removals below exist to rebuild a directory under its old name; the
 * containment check is asserted here rather than trusted at each call site so
 * that no future edit can aim one at a caller-supplied or defaulted path.
 */
async function removeInsideTempRoot(path: string): Promise<void> {
  const owner = roots.find(root => path.startsWith(`${root}/`))
  if (owner === undefined) throw new Error(`refusing to remove '${path}': not inside a temp root of this test file`)
  await rm(path, { recursive: true })
}

/** Boot the real storage/domain/registry composition over an empty session history. */
async function registry() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', {
    list: vi.fn(async () => []),
    load: vi.fn(() => { throw new Error('event bodies must not be loaded') }),
    inspect: vi.fn(() => { throw new Error('event bodies must not be inspected') }),
  } as never)
  const fiber = await ctx.plugin(WorkspaceRegistry)
  disposers.push(async () => { await fiber.dispose() })
  return ctx.workspaceRegistry
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('must[0]: real canonical-realpath + inode/volume observation', () => {
  it('observes the fs.realpath canonical path for a symlinked, dot-segmented spelling of the same directory', async () => {
    const root = await tempRoot()
    const target = join(root, 'project')
    await mkdir(target)
    await mkdir(join(target, 'sub'))
    const link = join(root, 'link')
    await symlink(target, link)

    const identity = await observeWorkspaceIdentity(join(link, '.', 'sub', '..'))

    expect(identity.canonicalPath).toBe(target)
  })

  it('observes exactly the device and inode fs.stat reports for that canonical path', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)

    const identity = await observeWorkspaceIdentity(dir)
    const stats = await stat(dir)

    expect(identity.volume).toStrictEqual({ device: stats.dev, inode: stats.ino })
  })

  it('binds a freshly created workspace to its observed identity at untrusted, with no grantor', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const workspaces = await registry()
    const workspace = await workspaces.create(dir)

    const record = await workspaces.workspaceTrust(workspace.id)

    expect(record.state).toBe('untrusted')
    expect(record.grantedBy).toBeUndefined()
    expect(record.identity).toStrictEqual(await observeWorkspaceIdentity(dir))
  })

  it('refuses a trust upgrade authored by a non-host principal, leaving the workspace untrusted', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const workspaces = await registry()
    const workspace = await workspaces.create(dir)

    const result = await workspaces.upgradeWorkspaceTrust(workspace.id, 'trusted-execute', serviceActor)

    expect(result).toStrictEqual({ upgraded: false, reason: 'non-host-principal' })
    expect((await workspaces.workspaceTrust(workspace.id)).state).toBe('untrusted')
  })
})

describe('acceptance[1]: trust is not inherited across a real identity change', () => {
  it('keeps host-granted trust across a re-observation of an unchanged directory', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const workspaces = await registry()
    const workspace = await workspaces.create(dir)
    await workspaces.upgradeWorkspaceTrust(workspace.id, 'trusted-execute', hostUser)

    const record = await workspaces.workspaceTrust(workspace.id)

    expect(record.state).toBe('trusted-execute')
    expect(record.grantedBy).toBe(hostUser.id)
  })

  it('drops trust when the workspace directory is replaced in place under the same canonical path', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const workspaces = await registry()
    const workspace = await workspaces.create(dir)
    await workspaces.upgradeWorkspaceTrust(workspace.id, 'trusted-execute', hostUser)
    const before = await observeWorkspaceIdentity(dir)

    await removeInsideTempRoot(dir)
    await mkdir(dir)
    const after = await observeWorkspaceIdentity(dir)
    const record = await workspaces.workspaceTrust(workspace.id)

    expect(after.canonicalPath).toBe(before.canonicalPath)
    expect(after.volume.inode).not.toBe(before.volume.inode)
    expect(record.state).toBe('untrusted')
    expect(record.grantedBy).toBeUndefined()
    expect(record.identity).toStrictEqual(after)
  })

  it('drops trust when the symlink the workspace was opened through is retargeted to another directory', async () => {
    const root = await tempRoot()
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    const link = join(root, 'opened')
    await symlink(first, link)
    const workspaces = await registry()
    const workspace = await workspaces.create(link)
    await workspaces.upgradeWorkspaceTrust(workspace.id, 'trusted-execute', hostUser)

    await unlink(link)
    await symlink(second, link)
    const record = await workspaces.workspaceTrust(workspace.id)

    expect(record.state).toBe('untrusted')
    expect(record.identity.canonicalPath).toBe(second)
  })

  it('drops trust when the workspace directory is moved out from under the path it was opened at', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const workspaces = await registry()
    const workspace = await workspaces.create(dir)
    await workspaces.upgradeWorkspaceTrust(workspace.id, 'trusted-execute', hostUser)

    await rename(dir, join(root, 'moved'))
    const record = await workspaces.workspaceTrust(workspace.id)

    expect(record.state).toBe('untrusted')
    expect(record.grantedBy).toBeUndefined()
  })

  it('does not carry trust to the new canonical path of a moved directory that kept its inode', async () => {
    const root = await tempRoot()
    const dir = join(root, 'project')
    await mkdir(dir)
    const before = await observeWorkspaceIdentity(dir)
    const granted = { ...bindWorkspaceTrust(before, '2026-09-03T00:00:00.000Z'), state: 'trusted-execute' as const }

    const moved = join(root, 'moved')
    await rename(dir, moved)
    const after = await observeWorkspaceIdentity(moved)
    const reconciled = reconcileWorkspaceTrust(granted, after, '2026-09-03T00:00:01.000Z')

    expect(after.volume).toStrictEqual(before.volume)
    expect(after.canonicalPath).not.toBe(before.canonicalPath)
    expect(reconciled.state).toBe('untrusted')
    expect(reconciled.identity).toStrictEqual(after)
  })
})
