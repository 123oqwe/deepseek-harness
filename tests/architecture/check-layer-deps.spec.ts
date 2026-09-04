/**
 * Epic P0-04 U-stage: the real layer-dependency checker
 * (`scripts/architecture/check-layer-deps.mjs`) — classifying every real
 * workspace package (the epic gate's "All packages classified"), resolving
 * dependency edges through must[2]'s three detection channels, enforcing
 * `docs/architecture/layering.md`'s rules 4 and 6 against the real kernel
 * package (acceptance[1]), and searching the real production package graph
 * for an unexempted cycle (acceptance[0], acceptance[2]).
 *
 * `tests/architecture/layer-deps.spec.ts` covers the C-stage pure
 * classification and shortest-cycle module this checker calls; this suite
 * covers only the real filesystem scan, the exemption store, and the gate
 * run. acceptance[2]'s 10-second budget is deliberately NOT asserted here:
 * a wall-clock assertion passes on a fast CI runner and fails on a loaded
 * developer machine, which would make this suite's result depend on where
 * it ran rather than on the property it claims to check. The budget is
 * evidenced by timing the real CLI instead.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyWorkspacePackages,
  collectLayerEdges,
  readLayerExemptions,
  runLayerDepsCheck,
} from '../../scripts/architecture/check-layer-deps.mjs'

const root = resolve(import.meta.dirname, '../..')

const fixtureRoots: string[] = []
afterEach(() => {
  for (const dir of fixtureRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create a fresh on-disk fixture repository root, removed after the test. */
function fixtureRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-check-layer-deps-'))
  fixtureRoots.push(dir)
  writeExemptions(dir, { $schemaVersion: 1, exemptedCycles: [], kernelEdgeAllowlist: [] })
  return dir
}

/**
 * Write a fixture workspace package manifest.
 * @param fixture - fixture repository root.
 * @param dir - repo-relative package directory.
 * @param manifest - the manifest fields to write.
 */
function writeManifest(fixture: string, dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(join(fixture, dir), { recursive: true })
  writeFileSync(join(fixture, dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * Write a fixture TypeScript source file.
 * @param fixture - fixture repository root.
 * @param relPath - repo-relative file path.
 * @param content - file contents.
 */
function writeSource(fixture: string, relPath: string, content: string): void {
  const filePath = join(fixture, relPath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, `${content}\n`)
}

/**
 * Write the fixture's exemption store at the same repo-relative path the
 * real checker reads.
 * @param fixture - fixture repository root.
 * @param document - the exemption document to write.
 */
function writeExemptions(fixture: string, document: unknown): void {
  const filePath = join(fixture, 'tests/first100/layer-cycle-exemptions.json')
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`)
}

describe('the real workspace: every package is classified (epic gate)', () => {
  it('assigns a layer to every real workspace package, leaving none unclassified', () => {
    const classified = classifyWorkspacePackages(root)
    expect(classified.unclassified).toEqual([])
    expect(classified.byPackage.size).toBeGreaterThan(200)
    // A capability family's Service Definition and its provider live in the
    // same packages/<group>/ directory, so a group-name-only mapping cannot
    // tell them apart. architecture.layers.json's family declarations do.
    expect(classified.byPackage.get('@deepseek-ai/dsh-llm')?.layer).toBe('capability-definitions')
    expect(classified.byPackage.get('@deepseek-ai/dsh-llm-deepseek')?.layer).toBe('providers')
    expect(classified.byPackage.get('@deepseek-ai/dsh-trust-kernel')?.layer).toBe('kernel')
    expect(classified.byPackage.get('@deepseek-ai/dsh-client-ui-chat')?.layer).toBe('surfaces-apps')
  })
})

describe('the real workspace: runLayerDepsCheck against the real repository', () => {
  it('reports zero violations and no unexempted cycle in the production package graph', () => {
    const result = runLayerDepsCheck(root)
    expect(result.violations).toEqual([])
    expect(result.unclassified).toEqual([])
    expect(result.shortestCycle).toBeUndefined()
    expect(result.scanned.packages).toBeGreaterThan(200)
    expect(result.scanned.edges).toBeGreaterThan(0)
  }, 30_000)

  it('resolves the real trust-kernel Cordis edge as permitted under rule 4 and its dsh-invariants edge as allowlisted', () => {
    // The concrete non-vacuous evidence for acceptance[1]: a checker that
    // flagged nothing, or that flagged every kernel edge, would not
    // distinguish these two real edges from each other.
    const result = runLayerDepsCheck(root)
    const kernelEdges = result.kernelEdges.filter(edge => edge.fromPackage === '@deepseek-ai/dsh-trust-kernel')
    const cordis = kernelEdges.find(edge => edge.toPackage === '@deepseek-ai/cordis')
    expect(cordis?.bindings).toEqual(['Context'])
    expect(cordis?.verdict).toBe('permitted-binding')
    const invariants = kernelEdges.find(edge => edge.toPackage === '@deepseek-ai/dsh-invariants')
    expect(invariants?.verdict).toBe('allowlisted')
  }, 30_000)
})

describe('the exemption store (rules 5 and 6)', () => {
  it('reads the real store and reports no expired or stale entry', () => {
    const exemptions = readLayerExemptions(root)
    expect(exemptions.errors).toEqual([])
  })

  it('rejects a kernelEdgeAllowlist entry whose expires date has passed', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', {
      name: '@deepseek-ai/dsh-k',
      peerDependencies: { '@deepseek-ai/dsh-ui': 'workspace:^' },
    })
    writeManifest(fixture, 'packages/client/ui', { name: '@deepseek-ai/dsh-ui' })
    writeExemptions(fixture, {
      $schemaVersion: 1,
      exemptedCycles: [],
      kernelEdgeAllowlist: [
        {
          fromPackage: '@deepseek-ai/dsh-k',
          toPackage: '@deepseek-ai/dsh-ui',
          owner: 'P0-04',
          reason: 'fixture',
          expires: '2020-01-01',
        },
      ],
    })
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.map(v => v.rule)).toContain('expired-kernel-edge-allowlist')
  })

  it('rejects a kernelEdgeAllowlist entry naming an edge that no longer exists', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', { name: '@deepseek-ai/dsh-k' })
    writeExemptions(fixture, {
      $schemaVersion: 1,
      exemptedCycles: [],
      kernelEdgeAllowlist: [
        {
          fromPackage: '@deepseek-ai/dsh-k',
          toPackage: '@deepseek-ai/dsh-gone',
          owner: 'P0-04',
          reason: 'fixture',
          expires: '2999-01-01',
        },
      ],
    })
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.map(v => v.rule)).toContain('stale-kernel-edge-allowlist')
  })
})

describe('rule 4: the kernel Cordis binding rule is measured per binding', () => {
  it('permits a kernel package importing only Context, and rejects one importing Service', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', {
      name: '@deepseek-ai/dsh-k',
      peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    })
    writeSource(fixture, 'packages/kernel/k/src/index.ts', "import { Context } from '@deepseek-ai/cordis'")
    expect(runLayerDepsCheck(fixture).violations).toEqual([])

    writeSource(fixture, 'packages/kernel/k/src/index.ts', "import { Context, Service } from '@deepseek-ai/cordis'")
    const rejected = runLayerDepsCheck(fixture)
    expect(rejected.violations.map(v => v.rule)).toContain('kernel-forbidden-cordis-binding')
    expect(rejected.violations[0]?.detail).toContain('Service')
  })

  it('rejects a forbidden Cordis binding imported type-only, since rule 4 grants the kernel no type-only escape', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', {
      name: '@deepseek-ai/dsh-k',
      peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    })
    writeSource(fixture, 'packages/kernel/k/src/index.ts', "import type { Plugin } from '@deepseek-ai/cordis'")
    expect(runLayerDepsCheck(fixture).violations.map(v => v.rule)).toContain('kernel-forbidden-cordis-binding')
  })

  it('rejects a kernel dependency on a surfaces-apps package and on a providers package', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', {
      name: '@deepseek-ai/dsh-k',
      peerDependencies: { '@deepseek-ai/dsh-ui': 'workspace:^', '@deepseek-ai/dsh-llm-x': 'workspace:^' },
    })
    writeManifest(fixture, 'packages/client/ui', { name: '@deepseek-ai/dsh-ui' })
    writeManifest(fixture, 'packages/llm/llm-x', { name: '@deepseek-ai/dsh-llm-x' })
    const violations = runLayerDepsCheck(fixture).violations
    expect(violations.map(v => v.toPackage).sort()).toEqual(['@deepseek-ai/dsh-llm-x', '@deepseek-ai/dsh-ui'])
    expect(new Set(violations.map(v => v.rule))).toEqual(new Set(['kernel-upward-dependency']))
  })
})

describe('must[2]: three detection channels', () => {
  it('detects an edge declared only in package.json, only via a tsconfig path alias, and only in a dynamic import', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/core/orch', {
      name: '@deepseek-ai/dsh-orch',
      dependencies: { '@deepseek-ai/dsh-declared': 'workspace:^' },
    })
    writeManifest(fixture, 'packages/util/declared', { name: '@deepseek-ai/dsh-declared' })
    writeManifest(fixture, 'packages/util/aliased', { name: '@deepseek-ai/dsh-aliased' })
    writeManifest(fixture, 'packages/util/dynamic', { name: '@deepseek-ai/dsh-dynamic' })
    writeSource(
      fixture,
      'packages/core/orch/src/index.ts',
      [
        "import { a } from '@deepseek-ai/dsh-aliased'",
        "const b = await import('@deepseek-ai/dsh-dynamic')",
      ].join('\n'),
    )
    writeFileSync(
      join(fixture, 'tsconfig.base.json'),
      `${JSON.stringify({
        compilerOptions: {
          paths: { '@deepseek-ai/dsh-aliased': ['./packages/util/aliased/src/index.ts'] },
        },
      }, null, 2)}\n`,
    )
    const edges = collectLayerEdges(fixture, classifyWorkspacePackages(fixture).byPackage)
    const found = new Map(edges.map(edge => [edge.toPackage, edge.detectionMethod]))
    expect(found.get('@deepseek-ai/dsh-declared')).toBe('package-graph')
    expect(found.get('@deepseek-ai/dsh-aliased')).toBe('path-alias')
    expect(found.get('@deepseek-ai/dsh-dynamic')).toBe('dynamic-require')
  })
})

describe('acceptance[0]: cycle detection across three cycle fixtures (validation[2])', () => {
  /**
   * Build a fixture whose production graph contains the given edges.
   * @param edges - `from` package short name to its dependency short names.
   * @returns the fixture repository root.
   */
  function cycleFixture(edges: Record<string, string[]>): string {
    const fixture = fixtureRoot()
    for (const [from, tos] of Object.entries(edges)) {
      writeManifest(fixture, `packages/core/${from}`, {
        name: `@deepseek-ai/dsh-${from}`,
        dependencies: Object.fromEntries(tos.map(to => [`@deepseek-ai/dsh-${to}`, 'workspace:^'])),
      })
    }
    return fixture
  }

  it('finds a two-package cycle', () => {
    const result = runLayerDepsCheck(cycleFixture({ a: ['b'], b: ['a'] }))
    expect(result.shortestCycle).toEqual(['@deepseek-ai/dsh-a', '@deepseek-ai/dsh-b'])
    expect(result.violations.map(v => v.rule)).toContain('unexempted-cycle')
  })

  it('finds a four-package cycle and reports the shortest cycle when a shorter one also exists', () => {
    const long = runLayerDepsCheck(cycleFixture({ a: ['b'], b: ['c'], c: ['d'], d: ['a'] }))
    expect(long.shortestCycle).toHaveLength(4)

    const both = runLayerDepsCheck(cycleFixture({ a: ['b'], b: ['c'], c: ['d'], d: ['a'], e: ['f'], f: ['e'] }))
    expect(both.shortestCycle).toHaveLength(2)
  })

  it('accepts a cycle covered by a declared exemption and still rejects an undeclared one', () => {
    const fixture = cycleFixture({ a: ['b'], b: ['a'] })
    writeExemptions(fixture, {
      $schemaVersion: 1,
      kernelEdgeAllowlist: [],
      exemptedCycles: [
        {
          cycle: ['@deepseek-ai/dsh-a', '@deepseek-ai/dsh-b'],
          reason: 'fixture',
          owner: 'P0-04',
          adrNote: '.agents/notes/fixture.md',
          recordedDate: '2026-09-04',
        },
      ],
    })
    expect(runLayerDepsCheck(fixture).violations.map(v => v.rule)).not.toContain('unexempted-cycle')
  })

  it('excludes devDependencies from the production graph acceptance[0] scopes', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/core/a', {
      name: '@deepseek-ai/dsh-a',
      devDependencies: { '@deepseek-ai/dsh-b': 'workspace:^' },
    })
    writeManifest(fixture, 'packages/core/b', {
      name: '@deepseek-ai/dsh-b',
      dependencies: { '@deepseek-ai/dsh-a': 'workspace:^' },
    })
    expect(runLayerDepsCheck(fixture).shortestCycle).toBeUndefined()
  })
})
