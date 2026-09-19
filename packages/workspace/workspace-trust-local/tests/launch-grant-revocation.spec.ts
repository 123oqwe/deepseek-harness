/**
 * P1-07 / BLOCKED-261: a launch argument does not resurrect trust a human
 * lowered in the same process.
 *
 * `--trust-workspace` is registered against the provider rather than read once
 * (`ctx.inject`), so the grant re-runs whenever the provider is replaced. That
 * is what "whoever is the live provider holds this startup's grant" means — and
 * it is also how a revocation made INSIDE the session could be undone by the
 * launch argument that preceded it, silently, on a reload nobody asked for.
 *
 * The rule lives in the provider because the provider is what reads the stored
 * record. Two inputs decide it: the record's own `loweredExplicitly` marker,
 * which separates "a human lowered this" from "nobody ever decided about it",
 * and this process's start instant, which separates a revocation made during
 * this startup from one made in an earlier run that this startup may legitimately
 * grant again.
 */

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { PrincipalId, TenantId } from '@deepseek-ai/dsh-principal/types'
import type { Principal } from '@deepseek-ai/dsh-principal/types'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it } from 'vitest'
import * as WorkspaceTrustLocal from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

/** The host user this entry point acts as; `--trust-workspace` mints the same kind. */
const HOST: Principal = {
  kind: 'user',
  id: PrincipalId('host-user'),
  tenant: TenantId('local'),
} as unknown as Principal

/**
 * A realpath-resolved temporary root, removed after the case.
 * @returns the directory path.
 */
async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-launch-trust-')))
  roots.push(root)
  return root
}

/**
 * Mount the provider over a real storage stack.
 * @param storageRoot - the durable root; two mounts over one root are two mounts of one host's state.
 * @returns the mounted context.
 */
async function mount(storageRoot: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: storageRoot },
  )
  await ctx.plugin(
    { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig },
    { backend: 'json' },
  )
  await ctx.plugin(WorkspaceTrustLocal, { grants: [] })
  return ctx
}

/**
 * A project directory to grant trust on.
 * @param root - the temporary root it lives under.
 * @returns the project path.
 */
async function project(root: string): Promise<string> {
  const path = join(root, 'project')
  await mkdir(path)
  return path
}

describe('P1-07 must[2] / BLOCKED-261: the launch grant and an in-session revocation', () => {
  it('grants a workspace nobody has decided about, because a first binding is not a revocation', async () => {
    // The positive control for the rule below: `bindWorkspaceTrust` creates an
    // `'untrusted'` record for an untouched workspace, and its `at` is also
    // after this process started. Only the explicit marker separates the two,
    // and without it this case would fail with the rule that protects the next.
    const root = await makeRoot()
    const path = await project(root)
    const ctx = await mount(root)
    try {
      expect(await ctx.workspaceTrust.stateFor(path)).toBe('untrusted')
      await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument')
      expect(await ctx.workspaceTrust.stateFor(path)).toBe('trusted-read')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('replays the same launch grant as a no-op while nothing has lowered it', async () => {
    const root = await makeRoot()
    const path = await project(root)
    const ctx = await mount(root)
    try {
      await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument')
      // The second call is what a provider reload produces. It is refused as
      // "not an upgrade" — the state is already there — so no second record and
      // no second audit entry exist to find.
      expect(await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument'))
        .toEqual({ upgraded: false, reason: 'not-an-upgrade' })
      expect(await ctx.workspaceTrust.stateFor(path)).toBe('trusted-read')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not re-grant after an explicit revocation, so the later human decision stands', async () => {
    const root = await makeRoot()
    const path = await project(root)
    const ctx = await mount(root)
    try {
      await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument')
      await ctx.workspaceTrust.revokeTrust(path, 'untrusted')
      expect(await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument'))
        .toEqual({ upgraded: false, reason: 'lowered-in-this-process' })
      expect(await ctx.workspaceTrust.stateFor(path)).toBe('untrusted')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('still does not re-grant when the provider itself is replaced, which is the case the rule exists for', async () => {
    // Not the same as calling twice on one mount: a replacement disposes this
    // provider and mounts another over the same durable root, which is exactly
    // what `ctx.inject` re-runs the launch grant for. A rule that kept its
    // state in the mount would pass the case above and fail this one.
    const root = await makeRoot()
    const path = await project(root)
    const first = await mount(root)
    try {
      await first.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument')
      await first.workspaceTrust.revokeTrust(path, 'untrusted')
    } finally {
      await first.fiber.dispose()
    }
    const second = await mount(root)
    try {
      expect(await second.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument'))
        .toEqual({ upgraded: false, reason: 'lowered-in-this-process' })
      expect(await second.workspaceTrust.stateFor(path)).toBe('untrusted')
    } finally {
      await second.fiber.dispose()
    }
  })

  it('lets an in-session command raise trust again, because the rule gates the launch argument and not the human', async () => {
    const root = await makeRoot()
    const path = await project(root)
    const ctx = await mount(root)
    try {
      await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'launch-argument')
      await ctx.workspaceTrust.revokeTrust(path, 'untrusted')
      expect(await ctx.workspaceTrust.grantTrust(path, 'trusted-read', HOST, 'command'))
        .toMatchObject({ upgraded: true })
      expect(await ctx.workspaceTrust.stateFor(path)).toBe('trusted-read')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
