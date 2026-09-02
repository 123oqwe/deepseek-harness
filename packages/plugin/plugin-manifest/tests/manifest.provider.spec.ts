/**
 * Provider-stage proof for Plugin Manifest v2 (Epic P1-01): the real runtime
 * surface `src/index.ts` adds on top of Contract-stage's pure schema/wildcard
 * logic — declared-vs-observed registration comparison (acceptance[0]/[1])
 * and the resulting quarantine decision (acceptance[0]).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyPluginDeclaration,
  compareDeclaredToObserved,
  decidePluginTrust,
  validatePluginManifestV2,
  type ObservedPluginCapabilities,
  type RegistrationMismatch,
} from '../src/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(here, 'fixtures')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'))
}

const EMPTY_OBSERVED: ObservedPluginCapabilities = {
  ctxKeys: [],
  toolNames: [],
  skillNames: [],
  mcpServerNames: [],
  eventNames: [],
}

/** `benign.json`'s exact declared registration names, matching what it declares as `role: 'provides'`/tool/skill/mcp-server/event. */
function observedMatchingBenign(): ObservedPluginCapabilities {
  return {
    ctxKeys: [],
    toolNames: ['example-format-note'],
    skillNames: ['example-skill'],
    mcpServerNames: ['example-docs'],
    eventNames: ['example/note-formatted'],
  }
}

describe('package root re-exports Contract-stage runtime functions, not just types', () => {
  it('exposes validatePluginManifestV2 from the package root the same as the documented /validate subpath', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
  })

  it('exposes classifyPluginDeclaration from the package root the same as the documented /validate subpath', () => {
    const declaration = classifyPluginDeclaration(loadFixture('benign'))
    expect(declaration.kind).toBe('manifest-v2')
  })
})

describe('compareDeclaredToObserved', () => {
  it('reports no mismatches when every declared capability was actually observed', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const comparison = compareDeclaredToObserved(result.manifest, observedMatchingBenign())
    expect(comparison.mismatches).toEqual([])
    expect(comparison.wildcardFindings).toEqual([])
  })

  it('reports an undeclared-registration mismatch for an observed tool the manifest never declared', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const observed: ObservedPluginCapabilities = { ...observedMatchingBenign(), toolNames: ['example-format-note', 'undeclared-tool'] }
    const comparison = compareDeclaredToObserved(result.manifest, observed)
    expect(comparison.mismatches).toEqual(expect.arrayContaining([
      { kind: 'undeclared-registration', category: 'tool', name: 'undeclared-tool' },
    ]))
  })

  it('reports a declared-not-registered mismatch for a declared skill that never actually registered', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const observed: ObservedPluginCapabilities = { ...observedMatchingBenign(), skillNames: [] }
    const comparison = compareDeclaredToObserved(result.manifest, observed)
    expect(comparison.mismatches).toEqual(expect.arrayContaining([
      { kind: 'declared-not-registered', category: 'skill', name: 'example-skill' },
    ]))
  })

  it('ignores a requires-role service when comparing ctxKeys, since a consumer never owns the key it requires', () => {
    // benign.json declares { ctxKey: 'tools', role: 'requires' } and observes nothing —
    // a requires-role service must never surface as a declared-not-registered mismatch.
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const comparison = compareDeclaredToObserved(result.manifest, observedMatchingBenign())
    expect(comparison.mismatches.some(mismatch => mismatch.category === 'ctxKey')).toBe(false)
  })

  it('reports an undeclared-registration mismatch for an observed ctxKey the manifest never declares with role: provides', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const observed: ObservedPluginCapabilities = { ...observedMatchingBenign(), ctxKeys: ['undeclared-service'] }
    const comparison = compareDeclaredToObserved(result.manifest, observed)
    expect(comparison.mismatches).toEqual(expect.arrayContaining([
      { kind: 'undeclared-registration', category: 'ctxKey', name: 'undeclared-service' },
    ]))
  })

  const categoryCases: Array<[RegistrationMismatch['category'], keyof ObservedPluginCapabilities]> = [
    ['tool', 'toolNames'],
    ['skill', 'skillNames'],
    ['mcpServer', 'mcpServerNames'],
    ['event', 'eventNames'],
  ]

  it.each(categoryCases)('detects an undeclared %s registration observed under that category alone', (category, observedField) => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const observed: ObservedPluginCapabilities = { ...EMPTY_OBSERVED, [observedField]: ['ghost'] }
    const comparison = compareDeclaredToObserved(result.manifest, observed)
    expect(comparison.mismatches).toEqual(expect.arrayContaining([
      { kind: 'undeclared-registration', category, name: 'ghost' },
    ]))
  })

  it('carries the manifest wildcard findings alongside registration mismatches', () => {
    const result = validatePluginManifestV2(loadFixture('overprivileged'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const comparison = compareDeclaredToObserved(result.manifest, EMPTY_OBSERVED)
    expect(comparison.wildcardFindings.length).toBeGreaterThan(0)
    expect(comparison.wildcardFindings).toEqual(expect.arrayContaining([
      { path: 'tools[0].allowedDestinations[0]', pattern: '/' },
      { path: 'tools[0].allowedDestinations[1]', pattern: '*' },
    ]))
  })
})

describe('decidePluginTrust', () => {
  it('decides active when a comparison has no mismatches and no wildcard findings', () => {
    expect(decidePluginTrust({ mismatches: [], wildcardFindings: [] })).toBe('active')
  })

  it('decides quarantined when a comparison has at least one registration mismatch', () => {
    const comparison = {
      mismatches: [{ kind: 'undeclared-registration', category: 'tool', name: 'ghost' }] as const,
      wildcardFindings: [],
    }
    expect(decidePluginTrust(comparison)).toBe('quarantined')
  })

  it('decides quarantined when a comparison has at least one wildcard finding even with no registration mismatch', () => {
    const comparison = {
      mismatches: [],
      wildcardFindings: [{ path: 'tools[0].allowedDestinations[0]', pattern: '*' }],
    }
    expect(decidePluginTrust(comparison)).toBe('quarantined')
  })

  it('decides active for the benign fixture compared against its own matching observation', () => {
    const result = validatePluginManifestV2(loadFixture('benign'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const comparison = compareDeclaredToObserved(result.manifest, observedMatchingBenign())
    expect(decidePluginTrust(comparison)).toBe('active')
  })

  it('decides quarantined for the overprivileged fixture even when every declared capability was observed', () => {
    const result = validatePluginManifestV2(loadFixture('overprivileged'))
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const manifest = result.manifest as { tools: readonly { name: string }[] }
    const observed: ObservedPluginCapabilities = { ...EMPTY_OBSERVED, toolNames: manifest.tools.map(tool => tool.name) }
    const comparison = compareDeclaredToObserved(result.manifest, observed)
    expect(decidePluginTrust(comparison)).toBe('quarantined')
  })
})
