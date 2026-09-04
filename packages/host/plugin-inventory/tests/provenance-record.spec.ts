/**
 * Epic P1-02's Usage stage, acceptance[2]'s Inventory half ("Inventory 和审计
 * 事件记录验证结果而不记录密钥"): `buildPluginPermissionStates` is the real
 * producer of `PluginPermissionState` — it walks a live Cordis `Context`'s
 * Loader entries and reads each entry's own `package.json` off disk — so it is
 * the only place the inventory can record a verification state that describes
 * the product rather than the test that constructed it.
 *
 * Two facts these cases pin, and the difference between them matters:
 *
 * - The **manifest digest** is a local recomputation over the exact bytes of
 *   the entry's own `package.json`. It detects a modified manifest and says
 *   nothing whatever about origin. It is NOT the `PackageDigest` a
 *   `PackageProvenanceClaim` binds — no package tarball exists on disk after
 *   installation, so no such digest is recomputable here.
 * - The **verification state** of every package installed in this repository
 *   today is `'unverified'` / `'no-provenance-claim'`, because none of them
 *   ships a claim. That is the result acceptance[2] asks to be recorded.
 *
 * The signature/key screen below walks the whole serialized permission state,
 * not only its top-level field names: a record that nests key material one
 * level down under an innocuous key would pass a `Object.keys()` check while
 * violating acceptance[2] exactly.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { buildPluginPermissionStates } from '../src/index.ts'
import type { PluginPermissionState } from '../src/types.ts'

const contexts: Context[] = []
const stagedDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of stagedDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const probePlugin: Plugin.Function = () => {}

/** A live Loader context with one mounted probe entry, disposed by `afterEach`. */
async function harness(builtinName: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins[builtinName] = probePlugin
  await ctx.loader.create({ name: `cordis:${builtinName}` })
  return ctx
}

/**
 * Stage a real on-disk package directory, writing `package.json` from exact
 * bytes the caller can digest independently. Removed by `afterEach`.
 */
function stagePackage(manifest: Record<string, unknown>): { dir: string; manifestPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-p1-02-provenance-'))
  stagedDirs.push(dir)
  const manifestPath = join(dir, 'package.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return { dir, manifestPath }
}

/** Every primitive value reachable anywhere in `value`, at any nesting depth. */
function flattenValues(value: unknown, into: string[] = []): string[] {
  if (value === null || value === undefined) return into
  if (value instanceof Uint8Array) {
    into.push(`bytes:${[...value].join(',')}`)
    return into
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenValues(item, into)
    return into
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.push(key)
      flattenValues(item, into)
    }
    return into
  }
  into.push(String(value))
  return into
}

function stateFor(states: readonly PluginPermissionState[], packageName: string): PluginPermissionState {
  const state = states.find(candidate => candidate.packageIdentity.name === packageName)
  expect(state).toBeDefined()
  return state!
}

describe('buildPluginPermissionStates provenance recording (acceptance[2] Inventory half)', () => {
  it('attaches a provenance audit record to every permission state it builds, so the inventory reports a verification state for each live plugin entry', async () => {
    const ctx = await harness('probe-provenance-attached')
    const { dir } = stagePackage({ name: 'example-attached-plugin', version: '1.0.0' })
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-provenance-attached' ? dir : undefined),
    })
    expect(states.length).toBeGreaterThan(0)
    for (const state of states) {
      expect(state.provenanceAudit).toBeDefined()
    }
  })

  it('records unverified with reason no-provenance-claim for a package shipping no claim, which is every package in this repository today', async () => {
    const ctx = await harness('probe-provenance-unclaimed')
    const { dir } = stagePackage({ name: 'example-unclaimed-plugin', version: '2.3.4' })
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-provenance-unclaimed' ? dir : undefined),
    })
    const audit = stateFor(states, 'example-unclaimed-plugin').provenanceAudit
    expect(audit.trust).toBe('unverified')
    expect(audit.reason).toBe('no-provenance-claim')
    expect(audit.packageDigest).toBeUndefined()
    expect(audit.trustAnchorId).toBeUndefined()
  })

  it('digests the exact bytes of the entry own package.json, matching an independently computed sha256 of the same file', async () => {
    const ctx = await harness('probe-provenance-digest')
    const { dir, manifestPath } = stagePackage({ name: 'example-digest-plugin', version: '1.0.0' })
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-provenance-digest' ? dir : undefined),
    })
    const expected = `sha256:${createHash('sha256').update(readFileSync(manifestPath)).digest('hex')}`
    expect(stateFor(states, 'example-digest-plugin').manifestDigest).toBe(expected)
  })

  it('changes the recorded manifest digest when a single byte of that package.json is changed, so the digest is over real bytes and not over the parsed identity', async () => {
    const ctx = await harness('probe-provenance-tamper')
    const { dir, manifestPath } = stagePackage({ name: 'example-tamper-plugin', version: '1.0.0' })
    const resolvePackageDir = (moduleName: string): string | undefined =>
      (moduleName === 'cordis:probe-provenance-tamper' ? dir : undefined)
    const before = stateFor(buildPluginPermissionStates(ctx, { resolvePackageDir }), 'example-tamper-plugin').manifestDigest
    // A whitespace byte: the parsed name and version are byte-for-byte the
    // same afterwards, so only a digest over the real file can notice it.
    const original = readFileSync(manifestPath, 'utf8')
    writeFileSync(manifestPath, `${original} `)
    const after = stateFor(buildPluginPermissionStates(ctx, { resolvePackageDir }), 'example-tamper-plugin').manifestDigest
    expect(after).not.toBe(before)
  })

  it('records the same manifest digest for two entries staged from byte-identical package.json files, so the digest does not depend on the temp path', async () => {
    const ctx = await harness('probe-provenance-stable-a')
    ctx.loader.builtins['probe-provenance-stable-b'] = probePlugin
    await ctx.loader.create({ name: 'cordis:probe-provenance-stable-b' })
    const first = stagePackage({ name: 'example-stable-plugin', version: '1.0.0' })
    const second = stagePackage({ name: 'example-stable-plugin', version: '1.0.0' })
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: (moduleName) => {
        if (moduleName === 'cordis:probe-provenance-stable-a') return first.dir
        if (moduleName === 'cordis:probe-provenance-stable-b') return second.dir
        return undefined
      },
    })
    const digests = states
      .filter(state => state.packageIdentity.name === 'example-stable-plugin')
      .map(state => state.manifestDigest)
    expect(digests).toHaveLength(2)
    expect(digests[0]).toBe(digests[1])
  })

  it('keeps every value of a signature and key fingerprint the package own dsh field carries out of the built permission state, checked over the whole serialized state and not only its top-level field names', async () => {
    const ctx = await harness('probe-provenance-secret')
    const signatureBytes = [7, 11, 13, 17, 19, 23, 29, 31]
    const fingerprint = 'SHA256:UNIQUE-FINGERPRINT-THAT-MUST-NOT-BE-RECORDED'
    const { dir } = stagePackage({
      name: 'example-secret-plugin',
      version: '1.0.0',
      dsh: {
        provenance: {
          evidence: {
            mode: 'offline-signed',
            signature: signatureBytes,
            publicKeyFingerprint: fingerprint,
          },
        },
      },
    })
    const states = buildPluginPermissionStates(ctx, {
      resolvePackageDir: moduleName => (moduleName === 'cordis:probe-provenance-secret' ? dir : undefined),
    })
    const state = stateFor(states, 'example-secret-plugin')
    // The record must exist before its key-freeness means anything: an absent
    // record trivially carries no key material and would prove nothing.
    expect(state.provenanceAudit).toBeDefined()
    const values = flattenValues(state)
    expect(values).not.toContain(fingerprint)
    expect(values).not.toContain('publicKeyFingerprint')
    expect(values).not.toContain('signature')
    expect(values).not.toContain(`bytes:${signatureBytes.join(',')}`)
    for (const byte of signatureBytes) {
      expect(values.filter(entry => entry === String(byte))).toHaveLength(0)
    }
  })
})
