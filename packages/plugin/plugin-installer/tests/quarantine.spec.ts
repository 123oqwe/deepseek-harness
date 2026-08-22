import { describe, it, expect } from 'vitest'
import { createQuarantine, verify, install, beginTransaction, addEntry, commit, abort } from '../src/index.ts'

describe('P1-04 Plugin Installer Quarantine', () => {
  it('creates quarantine entry with scripts blocked', () => {
    const entry = createQuarantine('test-plugin', '1.0.0', new Uint8Array([1, 2, 3]))
    expect(entry.state).toBe('downloaded')
    expect(entry.lifecycleScriptsBlocked).toBe(true)
    expect(entry.tarballDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects on failed signature', () => {
    const entry = createQuarantine('p', '1.0', new Uint8Array([1]))
    const result = verify(entry, { signature: false, sbom: true, pathTraversal: false })
    expect(result.state).toBe('rejected')
    expect(result.rejectedReason).toContain('signature')
  })

  it('rejects on path traversal', () => {
    const entry = createQuarantine('p', '1.0', new Uint8Array([1]))
    const result = verify(entry, { signature: true, sbom: true, pathTraversal: true })
    expect(result.state).toBe('rejected')
    expect(result.rejectedReason).toContain('path traversal')
  })

  it('verifies with all checks passing', () => {
    const entry = createQuarantine('p', '1.0', new Uint8Array([1]))
    const result = verify(entry, { signature: true, sbom: true, pathTraversal: false })
    expect(result.state).toBe('verified')
  })

  it('installs verified entry', () => {
    const entry = verify(createQuarantine('p', '1.0', new Uint8Array([1])), { signature: true, sbom: true })
    const installed = install(entry)
    expect(installed.state).toBe('installed')
    expect(installed.installedAt).toBeTruthy()
  })

  it('rejects install of non-verified', () => {
    const entry = createQuarantine('p', '1.0', new Uint8Array([1]))
    expect(() => install(entry)).toThrow('Cannot install')
  })

  it('transaction commit requires all verified', () => {
    let tx = beginTransaction()
    const entry = verify(createQuarantine('p', '1.0', new Uint8Array([1])), { signature: true, sbom: true })
    tx = addEntry(tx, install(entry))
    const committed = commit(tx)
    expect(committed.state).toBe('committed')
  })

  it('transaction abort rolls back', () => {
    let tx = beginTransaction()
    const entry = verify(createQuarantine('p', '1.0', new Uint8Array([1])), { signature: true, sbom: true })
    tx = addEntry(tx, entry)
    const aborted = abort(tx)
    expect(aborted.state).toBe('aborted')
  })
})
