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
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import type { Principal } from '@deepseek-ai/dsh-principal/types'
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
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

/**
 * Mount the provider over a real storage stack.
 *
 * `storageRoot` is what makes a "restart" meaningful here: two mounts over the
 * SAME root are two processes over one host's durable state, which is the
 * condition BLOCKED-199 is about. Two mounts over different roots are two
 * different hosts and would prove nothing.
 */
async function mount(grants: TrustGrant[], storageRoot?: string, auditSink?: (entry: { payload: unknown }) => void): Promise<Context> {
  const root = storageRoot ?? await makeRoot()
  const ctx = new Context()
  // Pinned only when a case asks to observe the audit. A shipped profile
  // constructs its kernel with NO `auditSink` (`apps/cli/src/profile-boot.ts`),
  // so `auditAppend` is a no-op there — BLOCKED-191's "the decision's audit has
  // no shipped reader", which applies to this epic's transitions exactly as it
  // does to P2-05's decisions. These cases prove the provider APPENDS; whether
  // a deployment reads it is that finding's, not this one's.
  if (auditSink !== undefined) pinTrustKernel(ctx, createTrustKernel({ auditSink }))
  await ctx.plugin(Storage)
  await ctx.plugin({ name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }, { root })
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
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

  it('does not re-grant a directory replaced while the process was down, because the binding is durable', async () => {
    // BLOCKED-199. The in-process defence is a record; before that record was
    // persisted it died with the process, so a second process re-read the
    // grants against whatever then stood at the granted path. A workstation
    // restarts and a clone is cheap, so "while nothing was running" is not an
    // exotic precondition — it was the whole attack.
    const root = await makeRoot()
    const storageRoot = await makeRoot()
    const project = join(root, 'project')
    await mkdir(project)
    const grants: TrustGrant[] = [{ path: project, state: 'trusted-execute' }]

    const first = await mount(grants, storageRoot)
    try {
      expect(await first.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await first.fiber.dispose()
    }

    // The directory the operator granted is gone; a different one now stands at
    // the same path with the same name and a different inode.
    await rm(project, { recursive: true })
    await mkdir(project)

    // The same host, restarted: same storage root, same configuration.
    const restarted = await mount(grants, storageRoot)
    try {
      expect(await restarted.workspaceTrust.stateFor(project)).toBe('untrusted')
    } finally {
      await restarted.fiber.dispose()
    }
  })

  it('control: the same directory across a restart keeps its trust, so the refusal above is about identity and not about restarting', async () => {
    const root = await makeRoot()
    const storageRoot = await makeRoot()
    const project = join(root, 'project')
    await mkdir(project)
    const grants: TrustGrant[] = [{ path: project, state: 'trusted-execute' }]

    const first = await mount(grants, storageRoot)
    try {
      expect(await first.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await first.fiber.dispose()
    }

    const restarted = await mount(grants, storageRoot)
    try {
      expect(await restarted.workspaceTrust.stateFor(project)).toBe('trusted-execute')
    } finally {
      await restarted.fiber.dispose()
    }
  })

  it('does not trust a retargeted symlink\'s new target across a restart', async () => {
    // The same gap reached without touching the granted path at all. Within one
    // process `canonicalGrants` is resolved once precisely so a retargeted
    // symlink cannot canonicalize onto the attacker's directory. A restart used
    // to resolve it again, against the new target; the stored record is what
    // stops that, because the attacker's directory has no record of its own and
    // the granted path's record names a different identity.
    const root = await makeRoot()
    const storageRoot = await makeRoot()
    const granted = join(root, 'granted')
    const original = join(root, 'original')
    const attacker = join(root, 'attacker')
    await mkdir(original)
    await mkdir(attacker)
    await symlink(original, granted)
    const grants: TrustGrant[] = [{ path: granted, state: 'trusted-execute' }]

    const first = await mount(grants, storageRoot)
    try {
      expect(await first.workspaceTrust.stateFor(granted)).toBe('trusted-execute')
    } finally {
      await first.fiber.dispose()
    }

    await rm(granted)
    await symlink(attacker, granted)

    const restarted = await mount(grants, storageRoot)
    try {
      // The attacker's directory was never granted, and a restart does not
      // hand it the grant by re-resolving the symlink.
      expect(await restarted.workspaceTrust.stateFor(attacker)).toBe('untrusted')
      expect(await restarted.workspaceTrust.stateFor(granted)).toBe('untrusted')
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

/** A host USER principal — the only kind `requestTrustUpgrade` authorizes. */
function hostPrincipal(): Principal {
  return { kind: 'user', id: PrincipalId('host-user-under-test'), tenantId: TenantId('local') }
}

describe('P1-07 BLOCKED-214 — a trust transition is audited with its scope and its source', () => {
  it('appends a GRANT naming the scope, the entry point and the workspace identity', async () => {
    const root = await makeRoot()
    const project = join(root, 'clone')
    await mkdir(project)
    const audited: { payload: Record<string, unknown> }[] = []
    const ctx = await mount([], root, entry => audited.push(entry as { payload: Record<string, unknown> }))
    try {
      await ctx.workspaceTrust.grantTrust(project, 'trusted-read', hostPrincipal(), 'launch-argument')

      const payload = audited.at(-1)?.payload
      expect(payload).toMatchObject({
        kind: 'workspace-trust',
        transition: 'granted',
        toState: 'trusted-read',
        fromState: 'untrusted',
        source: 'launch-argument',
      })
      // The identity, not only the path: two directories can occupy one path
      // over time, and an audit carrying only the path could not tell a
      // re-grant from a grant to a different directory.
      expect(payload).toHaveProperty('volume.inode')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('appends a REVOCATION, so a grant taken back leaves a record of its own', async () => {
    const root = await makeRoot()
    const project = join(root, 'clone')
    await mkdir(project)
    const audited: { payload: Record<string, unknown> }[] = []
    const ctx = await mount([], root, entry => audited.push(entry as { payload: Record<string, unknown> }))
    try {
      await ctx.workspaceTrust.grantTrust(project, 'trusted-execute', hostPrincipal(), 'command')
      await ctx.workspaceTrust.revokeTrust(project, 'untrusted')

      expect(audited.at(-1)?.payload).toMatchObject({
        transition: 'revoked',
        fromState: 'trusted-execute',
        toState: 'untrusted',
      })
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('records nothing and still grants when no kernel is pinned, so an unaudited composition still enforces', async () => {
    // The audit must never be able to refuse the transition the host user
    // asked for: the record is already persisted by the time it is appended.
    const root = await makeRoot()
    const project = join(root, 'clone')
    await mkdir(project)
    const ctx = await mount([], root)
    try {
      const result = await ctx.workspaceTrust.grantTrust(project, 'trusted-read', hostPrincipal(), 'launch-argument')

      expect(result.upgraded).toBe(true)
      expect(await ctx.workspaceTrust.stateFor(project)).toBe('trusted-read')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
