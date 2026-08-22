import { describe, it, expect } from 'vitest'
import { check, loadLayers } from './check-capability-seams.mjs'
import type { ArchitectureLayers, Violation } from './check-capability-seams.mjs'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..')

describe('P0-03 Capability Seam architecture consistency', () => {
  it('architecture.layers.json exists and is valid', () => {
    const path = join(repoRoot, 'architecture.layers.json')
    expect(existsSync(path)).toBe(true)
    const data: ArchitectureLayers = JSON.parse(readFileSync(path, 'utf8')) as ArchitectureLayers
    expect(data.layers).toBeTypeOf('object')
    expect(Object.keys(data.layers).length).toBeGreaterThan(0)
    expect(data.rules).toBeTypeOf('object')
  })

  it('kernel layer does not depend on product packages', () => {
    const violations: Violation[] = check()
    const kernelViolations = violations.filter(v => v.rule === 'kernel_no_product_deps')
    expect(kernelViolations).toHaveLength(0)
  })

  it('no consumer deep-imports provider src/*', () => {
    const violations: Violation[] = check()
    const deepImportViolations = violations.filter(v => v.rule === 'no_consumer_deep_import')
    expect(deepImportViolations).toHaveLength(0)
  })

  it('no provider depends on app/UI packages', () => {
    const violations: Violation[] = check()
    const appDepViolations = violations.filter(v => v.rule === 'no_provider_depends_on_app')
    expect(appDepViolations).toHaveLength(0)
  })

  it('allowlist entries have not expired', () => {
    const violations: Violation[] = check()
    const expiredViolations = violations.filter(v => v.rule === 'allowlist_expired')
    expect(expiredViolations).toHaveLength(0)
  })

  it('capability families have definition, providers, consumers, and rule', () => {
    const layers = loadLayers()
    const capabilityFamilies = Object.entries(layers.layers).filter(
      ([, layer]) => layer.definition,
    )
    for (const [name, layer] of capabilityFamilies) {
      if (layer.definition) {
        expect(layer.providers, `${name} should have providers`).toBeDefined()
        expect(layer.consumers, `${name} should have consumers`).toBeDefined()
        expect(layer.rule, `${name} should have a rule`).toBeDefined()
      }
    }
  })

  it('allowlist entries have removalDate and owner', () => {
    const layers = loadLayers()
    const allowlist = layers.allowlist
    if (allowlist) {
      for (const entry of allowlist) {
        expect(entry.removalDate, 'allowlist entry must have removalDate').toBeDefined()
        expect(entry.owner, 'allowlist entry must have owner').toBeDefined()
        expect(entry.reason, 'allowlist entry must have reason').toBeDefined()
      }
    }
  })

  it('check command returns array of violations', () => {
    const violations: Violation[] = check()
    expect(Array.isArray(violations)).toBe(true)
  })
})
