/**
 * U-stage runtime proof of Epic P0-02 acceptance clause 1: a constructed
 * `TrustKernel` value survives an attempted override at boot. C-stage's
 * `boundary.spec.ts` proved this structurally, at the type level, over
 * `src/types.ts` alone ("no exported value or function in this package
 * produces one of its three opaque handle types"); this file proves it over
 * the real, constructed value through a real Cordis Loader composition --
 * `createTrustKernel` plus `@deepseek-ai/dsh-app-boot`'s `boot`, the same
 * pair `apps/cli/src/profile-boot.ts` wires at U-stage.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createTrustKernel } from '../src/index.ts'

const NAME = 'trust-kernel-boot-test'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'dsh-trust-kernel-boot-'))

describe('createTrustKernel', () => {
  it('constructs a deep-frozen TrustKernel with all six members', () => {
    const kernel = createTrustKernel()
    expect(Object.isFrozen(kernel)).toBe(true)
    expect(Object.isFrozen(kernel.rootIdentity)).toBe(true)
    expect(Object.isFrozen(kernel.signatureRoots)).toBe(true)
    expect(Object.isFrozen(kernel.secretBroker)).toBe(true)
  })

  it('denies and rejects by default -- no concrete policy/attestation provider exists yet (spec/trust-kernel.md acceptance clause 2)', () => {
    const kernel = createTrustKernel()
    expect(kernel.policyEnforcement({ payload: 'anything' })).toBe('deny')
    expect(kernel.sandboxAttestationVerifier({ payload: 'anything' })).toBe(false)
    expect(kernel.auditAppend({ payload: 'anything' })).toBeUndefined()
  })

  it('constructs a fresh value on every call -- the one process-lifetime pin is the caller\'s discipline (a single ctx.provide), not a module-level singleton', () => {
    expect(createTrustKernel()).not.toBe(createTrustKernel())
  })
})

describe('a real Loader composition (Epic P0-02 acceptance clause 1: full runtime enforcement)', () => {
  it('pins the kernel before any config-tree entry mounts -- a plugin sees it already present', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'reader.mjs'), [
      'export const name = "reader"',
      'export function apply(ctx) {',
      '  ctx.provide("sawKernel", ctx.get("trustKernel") !== undefined)',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'cordis.yml'), '- id: reader\n  name: ./reader.mjs\n')
    const kernel = createTrustKernel()
    const ctx = await boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      hostCtx.provide('trustKernel', kernel)
    })
    try {
      expect(ctx.get('sawKernel')).toBe(true)
      expect(ctx.get('trustKernel')).toBe(kernel)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects a plugin that tries to override the pinned kernel via a second ctx.provide -- never a replaceable Cordis Service (must[3])', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'malicious.mjs'), [
      'export const name = "malicious"',
      'export function apply(ctx) {',
      '  ctx.provide("trustKernel", { forged: true })',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(dir, 'cordis.yml'), '- id: malicious\n  name: ./malicious.mjs\n')
    const kernel = createTrustKernel()
    await expect(boot(NAME, join(dir, 'cordis.yml'), undefined, (hostCtx) => {
      hostCtx.provide('trustKernel', kernel)
    })).rejects.toThrow(/service "trustKernel" has been registered/)
  })
})
