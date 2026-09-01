/**
 * Epic P0-03 C-stage: the `architecture.layers.json` capability-family
 * contract and the pure seam-violation detection functions
 * (`scripts/architecture/capability-seams.ts`). Repo-wide TypeScript-import
 * scanning and the CI-wired scanner script are a later slice; this suite
 * exercises the type/schema surface and the detection logic against
 * already-resolved fixture facts, plus self-consistency of the real
 * `architecture.layers.json` committed at the repository root.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allowedDependencyEdgesFor,
  detectDeepImportViolation,
  detectMissingProviderViolations,
  detectNonReversibleRegistrationViolation,
  detectProviderAppDependencyViolation,
  isAllowlisted,
  readWorkspacePackageNames,
  validateAllowlistEntry,
  validateArchitectureLayers,
  validateCapabilityFamily,
  type ArchitectureLayers,
  type CapabilityFamily,
  type ResolvedImport,
  type SeamViolation,
} from '../../scripts/architecture/capability-seams.ts'

const root = resolve(import.meta.dirname, '../..')

const shellFamily: CapabilityFamily = {
  id: 'shell',
  definition: '@deepseek-ai/dsh-shell',
  providers: ['@deepseek-ai/dsh-bash-local', '@deepseek-ai/dsh-bash-sandbox'],
  consumers: ['@deepseek-ai/dsh-tool-bash'],
}

function layersOf(...families: CapabilityFamily[]): ArchitectureLayers {
  return { $schemaVersion: 1, families, allowlist: [] }
}

describe('CapabilityFamily schema (must[0])', () => {
  it('accepts a well-formed family with a definition, providers, and consumers', () => {
    expect(validateCapabilityFamily(shellFamily)).toEqual([])
  })

  it('rejects a family with an empty id', () => {
    expect(validateCapabilityFamily({ ...shellFamily, id: '' }))
      .toContain('capability family id must not be empty')
  })

  it('rejects a family with a duplicate provider entry', () => {
    expect(validateCapabilityFamily({
      ...shellFamily,
      providers: ['@deepseek-ai/dsh-bash-local', '@deepseek-ai/dsh-bash-local'],
    })).toEqual(['shell: providers must not repeat @deepseek-ai/dsh-bash-local'])
  })

  it('rejects a family with a duplicate consumer entry', () => {
    expect(validateCapabilityFamily({
      ...shellFamily,
      consumers: ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-bash'],
    })).toEqual(['shell: consumers must not repeat @deepseek-ai/dsh-tool-bash'])
  })

  it('rejects two families sharing the same id', () => {
    const workspaceNames = new Set([
      shellFamily.definition, ...shellFamily.providers, ...shellFamily.consumers,
    ])
    expect(validateArchitectureLayers(layersOf(shellFamily, shellFamily), workspaceNames))
      .toContain('family id shell is declared more than once')
  })

  it('rejects a family whose definition, provider, or consumer package is absent from the workspace', () => {
    const errors = validateArchitectureLayers(layersOf(shellFamily), new Set(['@deepseek-ai/dsh-shell']))
    expect(errors).toContain('shell: @deepseek-ai/dsh-bash-local is not a workspace package')
    expect(errors).toContain('shell: @deepseek-ai/dsh-bash-sandbox is not a workspace package')
    expect(errors).toContain('shell: @deepseek-ai/dsh-tool-bash is not a workspace package')
  })
})

describe('allowedDependencyEdgesFor (must[0])', () => {
  it('derives one allowed edge from each provider to the family definition', () => {
    expect(allowedDependencyEdgesFor(shellFamily)).toContainEqual({
      from: '@deepseek-ai/dsh-bash-local', to: '@deepseek-ai/dsh-shell',
    })
    expect(allowedDependencyEdgesFor(shellFamily)).toContainEqual({
      from: '@deepseek-ai/dsh-bash-sandbox', to: '@deepseek-ai/dsh-shell',
    })
  })

  it('derives one allowed edge from each consumer to the family definition', () => {
    expect(allowedDependencyEdgesFor(shellFamily)).toContainEqual({
      from: '@deepseek-ai/dsh-tool-bash', to: '@deepseek-ai/dsh-shell',
    })
  })

  it('derives no edge between two providers or between two consumers', () => {
    const edges = allowedDependencyEdgesFor(shellFamily)
    expect(edges).toHaveLength(3)
    expect(edges.some(edge => edge.from === '@deepseek-ai/dsh-bash-local' && edge.to === '@deepseek-ai/dsh-bash-sandbox')).toBe(false)
  })
})

describe('AllowlistEntry schema (acceptance[1])', () => {
  const validEntry = {
    kind: 'missing-provider' as const,
    from: '@deepseek-ai/dsh-authorization',
    to: '@deepseek-ai/dsh-authorization',
    reason: 'registration-based provider pattern',
    owner: 'harryqiao59@gmail.com',
    removalDate: '2026-12-01',
  }

  it('requires every allowlist entry to carry a removalDate in YYYY-MM-DD form', () => {
    expect(validateAllowlistEntry(validEntry)).toEqual([])
    expect(validateAllowlistEntry({ ...validEntry, removalDate: '' })).toEqual([
      'missing-provider @deepseek-ai/dsh-authorization -> @deepseek-ai/dsh-authorization: removalDate must be an ISO calendar date (YYYY-MM-DD), got ""',
    ])
  })

  it('rejects an allowlist entry whose removalDate is not a real calendar date', () => {
    expect(validateAllowlistEntry({ ...validEntry, removalDate: '2026-13-40' })).toEqual([
      'missing-provider @deepseek-ai/dsh-authorization -> @deepseek-ai/dsh-authorization: removalDate must be an ISO calendar date (YYYY-MM-DD), got "2026-13-40"',
    ])
  })

  it('requires every allowlist entry to carry a non-empty owner', () => {
    expect(validateAllowlistEntry({ ...validEntry, owner: '' })).toEqual([
      'missing-provider @deepseek-ai/dsh-authorization -> @deepseek-ai/dsh-authorization: owner must not be empty',
    ])
  })

  it('rejects a duplicate allowlist entry for the same kind, from, and to', () => {
    const workspaceNames = new Set([validEntry.from])
    const errors = validateArchitectureLayers(
      { $schemaVersion: 1, families: [], allowlist: [validEntry, validEntry] },
      workspaceNames,
    )
    expect(errors).toContain(
      'allowlist entry missing-provider @deepseek-ai/dsh-authorization -> @deepseek-ai/dsh-authorization is declared more than once',
    )
  })
})

describe('the real architecture.layers.json (acceptance[0], acceptance[1])', () => {
  const doc = JSON.parse(readFileSync(resolve(root, 'architecture.layers.json'), 'utf8')) as ArchitectureLayers

  it('parses and validates every declared family with zero schema violations', () => {
    expect(validateArchitectureLayers(doc, readWorkspacePackageNames(root))).toEqual([])
  })

  it('gives every allowlist entry a removalDate and an owner', () => {
    expect(doc.allowlist.length).toBeGreaterThan(0)
    for (const entry of doc.allowlist) expect(validateAllowlistEntry(entry)).toEqual([])
  })
})

describe('detectDeepImportViolation (must[1], acceptance[2])', () => {
  const layers = layersOf(shellFamily)

  it("flags a consumer import resolving into a provider package's src/* as a deep-import violation", () => {
    const edge: ResolvedImport = {
      fromPackage: '@deepseek-ai/dsh-tool-bash',
      fromFile: 'packages/shell/tool-bash/src/index.ts',
      toPackage: '@deepseek-ai/dsh-bash-local',
      toSpecifier: '@deepseek-ai/dsh-bash-local/src/executor.ts',
      toIsDeepImport: true,
    }
    expect(detectDeepImportViolation(edge, layers)).toEqual({
      kind: 'deep-import',
      edge: { from: '@deepseek-ai/dsh-tool-bash', to: '@deepseek-ai/dsh-bash-local' },
      sourceFile: 'packages/shell/tool-bash/src/index.ts',
      remediation: expect.stringContaining('@deepseek-ai/dsh-shell') as string,
    })
  })

  it("does not flag a consumer import resolving to a provider package's published entry point", () => {
    const edge: ResolvedImport = {
      fromPackage: '@deepseek-ai/dsh-tool-bash',
      fromFile: 'packages/shell/tool-bash/src/index.ts',
      toPackage: '@deepseek-ai/dsh-bash-local',
      toSpecifier: '@deepseek-ai/dsh-bash-local',
      toIsDeepImport: false,
    }
    expect(detectDeepImportViolation(edge, layers)).toBeNull()
  })

  it('does not flag an import between packages outside any declared family', () => {
    const edge: ResolvedImport = {
      fromPackage: '@deepseek-ai/dsh-tool-fs',
      fromFile: 'packages/fs/tool-fs/src/index.ts',
      toPackage: '@deepseek-ai/dsh-util-time',
      toSpecifier: '@deepseek-ai/dsh-util-time/src/index.ts',
      toIsDeepImport: true,
    }
    expect(detectDeepImportViolation(edge, layers)).toBeNull()
  })
})

describe('detectProviderAppDependencyViolation (must[1])', () => {
  const layers = layersOf(shellFamily)
  const appPackages = new Set(['@deepseek-ai/dsh-client-ui-chat'])

  it('flags a provider import resolving into an app/UI package as a provider-app-dependency violation', () => {
    const edge: ResolvedImport = {
      fromPackage: '@deepseek-ai/dsh-bash-local',
      fromFile: 'packages/shell/bash-local/src/index.ts',
      toPackage: '@deepseek-ai/dsh-client-ui-chat',
      toSpecifier: '@deepseek-ai/dsh-client-ui-chat',
      toIsDeepImport: false,
    }
    expect(detectProviderAppDependencyViolation(edge, layers, appPackages)).toEqual({
      kind: 'provider-app-dependency',
      edge: { from: '@deepseek-ai/dsh-bash-local', to: '@deepseek-ai/dsh-client-ui-chat' },
      sourceFile: 'packages/shell/bash-local/src/index.ts',
      remediation: expect.stringContaining('shell') as string,
    })
  })

  it('does not flag a provider import resolving to its own family definition package', () => {
    const edge: ResolvedImport = {
      fromPackage: '@deepseek-ai/dsh-bash-local',
      fromFile: 'packages/shell/bash-local/src/index.ts',
      toPackage: '@deepseek-ai/dsh-shell',
      toSpecifier: '@deepseek-ai/dsh-shell',
      toIsDeepImport: false,
    }
    expect(detectProviderAppDependencyViolation(edge, layers, appPackages)).toBeNull()
  })
})

describe('detectMissingProviderViolations (acceptance[2])', () => {
  it('flags a family with zero providers and no matching allowlist entry', () => {
    const providerless: CapabilityFamily = { ...shellFamily, providers: [] }
    expect(detectMissingProviderViolations(layersOf(providerless))).toEqual([{
      kind: 'missing-provider',
      edge: { from: '@deepseek-ai/dsh-shell', to: '@deepseek-ai/dsh-shell' },
      sourceFile: 'architecture.layers.json',
      remediation: expect.stringContaining('shell') as string,
    }])
  })

  it('does not flag a family whose only provider is its own definition package', () => {
    const selfProviding: CapabilityFamily = { ...shellFamily, providers: ['@deepseek-ai/dsh-shell'] }
    expect(detectMissingProviderViolations(layersOf(selfProviding))).toEqual([])
  })
})

describe('detectNonReversibleRegistrationViolation (must[2], acceptance[2])', () => {
  const layers = layersOf(shellFamily)

  it('flags a family missing a provider fixture, consumer composition test, or unload/rollback test', () => {
    const violation = detectNonReversibleRegistrationViolation({
      familyId: 'shell',
      hasProviderFixture: true,
      hasConsumerCompositionTest: true,
      hasUnloadRollbackTest: false,
    }, layers)
    expect(violation).toEqual({
      kind: 'non-reversible-registration',
      edge: { from: '@deepseek-ai/dsh-shell', to: '@deepseek-ai/dsh-shell' },
      sourceFile: 'architecture.layers.json',
      remediation: expect.stringContaining('unload/rollback') as string,
    })
  })

  it('does not flag a family whose test evidence covers all four must[2] artifacts', () => {
    const violation = detectNonReversibleRegistrationViolation({
      familyId: 'shell',
      hasProviderFixture: true,
      hasConsumerCompositionTest: true,
      hasUnloadRollbackTest: true,
    }, layers)
    expect(violation).toBeNull()
  })
})

describe('SeamViolation remediation output (acceptance[3])', () => {
  it('names the offending dependency edge, source file, and a remediation suggestion on every violation kind', () => {
    const layers = layersOf(shellFamily)
    const deepImport = detectDeepImportViolation({
      fromPackage: '@deepseek-ai/dsh-tool-bash',
      fromFile: 'packages/shell/tool-bash/src/index.ts',
      toPackage: '@deepseek-ai/dsh-bash-local',
      toSpecifier: '@deepseek-ai/dsh-bash-local/src/executor.ts',
      toIsDeepImport: true,
    }, layers)
    const missingProvider = detectMissingProviderViolations(layersOf({ ...shellFamily, providers: [] }))[0]
    const nonReversible = detectNonReversibleRegistrationViolation({
      familyId: 'shell', hasProviderFixture: false, hasConsumerCompositionTest: false, hasUnloadRollbackTest: false,
    }, layers)

    for (const violation of [deepImport, missingProvider, nonReversible]) {
      expect(violation).not.toBeNull()
      expect(violation?.edge.from.length).toBeGreaterThan(0)
      expect(violation?.edge.to.length).toBeGreaterThan(0)
      expect(violation?.sourceFile.length).toBeGreaterThan(0)
      expect(violation?.remediation.length).toBeGreaterThan(0)
    }
  })
})

describe('isAllowlisted (acceptance[0])', () => {
  it('suppresses a violation whose kind and edge match an allowlist entry', () => {
    const layers: ArchitectureLayers = {
      $schemaVersion: 1,
      families: [shellFamily],
      allowlist: [{
        kind: 'missing-provider',
        from: '@deepseek-ai/dsh-shell',
        to: '@deepseek-ai/dsh-shell',
        reason: 'fixture',
        owner: 'harryqiao59@gmail.com',
        removalDate: '2026-12-01',
      }],
    }
    const violations = detectMissingProviderViolations(layersOf({ ...shellFamily, providers: [] }))
    expect(violations).toHaveLength(1)
    expect(isAllowlisted(violations[0] as SeamViolation, layers)).toBe(true)
  })

  it('still reports a violation whose edge is not covered by any allowlist entry', () => {
    const layers = layersOf(shellFamily)
    const violations = detectMissingProviderViolations(layersOf({ ...shellFamily, providers: [] }))
    expect(violations).toHaveLength(1)
    expect(isAllowlisted(violations[0] as SeamViolation, layers)).toBe(false)
  })
})
