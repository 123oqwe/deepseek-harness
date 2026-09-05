/**
 * P1-03 Provider stage: the transactional lock install.
 *
 * must[1] asks for candidate → verify → atomic replace, and the order is the
 * mechanism: a rejected candidate must leave the working lock byte-identical.
 * acceptance[2] asks that two concurrent installs never produce a half-written
 * lock, which is checked here against the real filesystem rather than a stub,
 * because "atomic" is a property of `rename` and not of this module.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planLockCommit, serializeLock, writeLockAtomically } from '../src/commit.ts'
import { resolveLoadOrder } from '../src/types.ts'
import type {
  GrantedCapability,
  ManifestDigest,
  PackageIntegrity,
  PluginLockEntry,
  PluginLockFile,
  PluginPackageName,
  PluginVersion,
  SignatureIdentity,
  SourceCommit,
} from '../src/types.ts'

function name(value: string): PluginPackageName {
  return brandString<PluginPackageName>(value)
}

function entry(id: string, overrides: Partial<PluginLockEntry> = {}): PluginLockEntry {
  return {
    name: name(id),
    version: brandString<PluginVersion>('1.0.0'),
    integrity: brandString<PackageIntegrity>(`sha512-${id}`),
    sourceCommit: brandString<SourceCommit>(`commit-${id}`),
    manifestDigest: brandString<ManifestDigest>(`sha256-${id}`),
    signatureIdentity: brandString<SignatureIdentity>(`github:acme/${id}`),
    dependencies: [],
    grantedCapabilities: [brandString<GrantedCapability>('fs:read')],
    ...overrides,
  }
}

function lock(entries: readonly PluginLockEntry[], loadOrder?: readonly PluginPackageName[]): PluginLockFile {
  return { lockfileVersion: 1, entries, loadOrder: loadOrder ?? resolveLoadOrder(entries) ?? [] }
}

describe('P1-03 must[1]: candidate, verify, then replace', () => {
  it('commits a valid candidate generated from the current lock', () => {
    const current = lock([entry('alpha')])
    const candidate = lock([entry('alpha'), entry('beta')])

    expect(planLockCommit(current, candidate, current)).toEqual({ committed: true, lock: candidate })
  })

  it('refuses an invalid candidate and names the defect, not a base mismatch', () => {
    const current = lock([entry('alpha')])
    const broken = lock([entry('alpha', { dependencies: [name('missing')] })], [name('alpha')])

    // Validation runs first: telling the author to regenerate against a newer
    // base would send them to fix the wrong thing.
    const decision = planLockCommit(current, broken, current)
    expect(decision).toMatchObject({ committed: false, reason: 'candidate-invalid' })
    if (decision.committed) throw new Error('unreachable')
    expect(decision.detail).toContain('dangling-dependency')
  })

  it('acceptance[2]: refuses a candidate generated from a lock that has since changed', () => {
    const base = lock([entry('alpha')])
    const landedFirst = lock([entry('alpha'), entry('gamma')])
    const candidate = lock([entry('alpha'), entry('beta')])

    // Two installs both read `base`. The first landed. The second's candidate
    // knows nothing about gamma, so committing it would erase an install that
    // already succeeded.
    expect(planLockCommit(landedFirst, candidate, base))
      .toMatchObject({ committed: false, reason: 'concurrent-modification' })
  })

  it('reports the candidate defect even when the base ALSO moved', () => {
    // Pins the check order rather than the two conditions separately.
    const base = lock([entry('alpha')])
    const landedFirst = lock([entry('alpha'), entry('gamma')])
    const broken = lock([entry('alpha', { dependencies: [name('missing')] })], [name('alpha')])

    expect(planLockCommit(landedFirst, broken, base)).toMatchObject({ reason: 'candidate-invalid' })
  })
})

describe('P1-03: the serialized lock is byte-stable', () => {
  it('produces identical bytes for locks built with different property order', () => {
    const straight = lock([entry('alpha', { dependencies: [], grantedCapabilities: [brandString<GrantedCapability>('fs:read'), brandString<GrantedCapability>('net:fetch')] })])
    const shuffled = lock([entry('alpha', { grantedCapabilities: [brandString<GrantedCapability>('net:fetch'), brandString<GrantedCapability>('fs:read')], dependencies: [] })])

    // Capabilities and dependencies are sorted on the way out, so two machines
    // that resolved the same graph write the same file.
    expect(serializeLock(straight)).toBe(serializeLock(shuffled))
  })

  it('ends with exactly one trailing newline', () => {
    const text = serializeLock(lock([entry('alpha')]))
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.endsWith('}\n\n')).toBe(false)
  })
})

describe('P1-03 acceptance[2]: replacement is atomic on the real filesystem', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'dsh-lock-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('replaces an existing lock with the new content', () => {
    const path = join(directory, 'plugins.lock.json')
    writeFileSync(path, serializeLock(lock([entry('alpha')])), 'utf8')

    const next = lock([entry('alpha'), entry('beta')])
    writeLockAtomically(path, next)

    expect(readFileSync(path, 'utf8')).toBe(serializeLock(next))
  })

  it('leaves no scratch file behind, so a reader never finds a partial lock', () => {
    const path = join(directory, 'plugins.lock.json')
    writeLockAtomically(path, lock([entry('alpha')]))

    // A leftover temp file is what a concurrent reader would trip over, and a
    // half-written one is exactly acceptance[2]'s failure.
    expect(readdirSync(directory)).toEqual(['plugins.lock.json'])
  })

  it('writes a complete, re-readable lock when the target did not exist', () => {
    const path = join(directory, 'plugins.lock.json')
    const written = lock([entry('alpha', { dependencies: [name('beta')] }), entry('beta')])
    writeLockAtomically(path, written)

    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      lockfileVersion: 1,
      loadOrder: ['beta', 'alpha'],
    })
  })
})
