import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerNamespace,
  checkConflicts,
  assertNoConflicts,
  clearRegistrations,
  listRegistrations,
  isOfficialNamespace,
  addOfficialNamespace,
  NamespaceConflictError,
} from '../src/index.ts'

describe('P1-09 Plugin Namespace Ownership', () => {
  beforeEach(() => clearRegistrations())
  afterEach(() => clearRegistrations())

  it('registers a namespace', () => {
    registerNamespace({ namespace: 'my-plugin', pluginId: 'plugin-a', isOfficial: false, capabilities: ['tool:read'] })
    expect(listRegistrations()).toHaveLength(1)
  })

  it('detects namespace collision', () => {
    registerNamespace({ namespace: 'shared', pluginId: 'plugin-a', isOfficial: false, capabilities: [] })
    registerNamespace({ namespace: 'shared', pluginId: 'plugin-b', isOfficial: false, capabilities: [] })
    const conflicts = checkConflicts()
    expect(conflicts.some(c => c.type === 'namespace_collision')).toBe(true)
  })

  it('detects unauthorized official namespace', () => {
    registerNamespace({ namespace: 'dsh', pluginId: 'third-party', isOfficial: false, capabilities: [] })
    const conflicts = checkConflicts()
    expect(conflicts.some(c => c.type === 'unauthorized_official')).toBe(true)
  })

  it('allows official namespace for official plugins', () => {
    registerNamespace({ namespace: 'dsh', pluginId: 'official-plugin', isOfficial: true, capabilities: [] })
    const conflicts = checkConflicts()
    expect(conflicts.some(c => c.type === 'unauthorized_official')).toBe(false)
  })

  it('assertNoConflicts passes with no conflicts', () => {
    registerNamespace({ namespace: 'safe', pluginId: 'plugin-a', isOfficial: false, capabilities: [] })
    expect(() => assertNoConflicts()).not.toThrow()
  })

  it('assertNoConflicts throws with conflicts', () => {
    registerNamespace({ namespace: 'dsh', pluginId: 'third-party', isOfficial: false, capabilities: [] })
    expect(() => assertNoConflicts()).toThrow(NamespaceConflictError)
  })

  it('isOfficialNamespace checks official set', () => {
    expect(isOfficialNamespace('dsh')).toBe(true)
    expect(isOfficialNamespace('my-plugin')).toBe(false)
  })

  it('addOfficialNamespace adds to set', () => {
    addOfficialNamespace('new-official')
    expect(isOfficialNamespace('new-official')).toBe(true)
  })
})
