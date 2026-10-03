/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalPath, protectedRoots, unreadableFiles, writableRoots } from '@deepseek-ai/dsh-sandbox'

/** Every temp root created by this file, removed after each test. */
const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('canonicalPath', () => {
  it('resolves symlinks (an existing path realpaths)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    roots.push(dir)
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

describe('writableRoots', () => {
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })

  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    roots.push(ws)
    const writable = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(writable).toContain(realpathSync.native(ws))
    expect(writable).toContain(canonicalPath('/tmp'))
    expect(writable).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(writable).size).toBe(writable.length)
  })
})

describe('protectedRoots (B-715)', () => {
  it('workspace-write protects the harness home, canonical, wherever DSH_HOME points', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    roots.push(home)
    vi.stubEnv('DSH_HOME', home)
    expect(protectedRoots({ mode: 'workspace-write', workspaceRoot: process.cwd() })).toEqual([realpathSync.native(home)])
  })

  it('read-only protects nothing, since it grants nothing', () => {
    expect(protectedRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })
})

describe('unreadableFiles (B-717)', () => {
  it('names the harness credential store under the canonical home, whether or not the files exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    roots.push(home)
    vi.stubEnv('DSH_HOME', home)
    const canonical = realpathSync.native(home)
    expect(unreadableFiles()).toEqual([join(canonical, '.credentials.yaml'), join(canonical, '.env')])
  })
})
