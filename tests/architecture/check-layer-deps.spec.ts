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
 * run. acceptance[2]'s budget is asserted here only through the CLI's
 * `--budget-ms` argument, which proves the budget comparison decides the
 * exit code. The 10-second budget itself is measured on the real repository
 * by the serial First-100 gate run: a wall-clock assertion in this suite
 * would pass on a fast CI runner and fail on a loaded developer machine.
 */

import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { load as parseYaml } from 'js-yaml'
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
  writeWorkspace(dir, ['packages/*/*', 'apps/*', 'vendor/*'])
  writeExemptions(dir, { $schemaVersion: 1, exemptedCycles: [], kernelEdgeAllowlist: [] })
  return dir
}

/**
 * Write the fixture's `pnpm-workspace.yaml`, the file the checker enumerates packages from.
 * @param fixture - fixture repository root.
 * @param patterns - the `packages:` patterns to declare.
 */
function writeWorkspace(fixture: string, patterns: readonly string[]): void {
  writeFileSync(join(fixture, 'pnpm-workspace.yaml'), `packages:\n${patterns.map(pattern => `  - '${pattern}'\n`).join('')}`)
}

/**
 * The directories that hold a `package.json` and match a `pnpm-workspace.yaml`
 * pattern; fails the calling case when the file declares none.
 * @param repo - repository root.
 * @returns repo-relative directories.
 */
function declaredManifestDirs(repo: string): string[] {
  const patterns = (parseYaml(readFileSync(join(repo, 'pnpm-workspace.yaml'), 'utf8')) as { packages?: unknown } | undefined)?.packages
  expect(Array.isArray(patterns) && patterns.length > 0).toBe(true)
  const dirs = (patterns as string[]).flatMap(pattern => globSync(`${pattern}/package.json`, { cwd: repo }).map(path => dirname(path).split(sep).join('/')))
  expect(dirs.length).toBeGreaterThan(0)
  return dirs
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

/** The narrowed acceptance[1] admits the three Cordis forms to this package alone, so the fixture kernel carries its name. */
const KERNEL = '@deepseek-ai/dsh-trust-kernel'
/** A second `kernel`-layer package, to which no Cordis use is admitted. */
const OTHER_KERNEL = '@deepseek-ai/dsh-k'
const CORDIS = '@deepseek-ai/cordis'
const LOADER = '@deepseek-ai/cordis-plugin-loader'
const INCLUDE = '@deepseek-ai/cordis-plugin-include'
const UI = '@deepseek-ai/dsh-ui'
const PROVIDER = '@deepseek-ai/dsh-llm-x'
const ORCH = '@deepseek-ai/dsh-orch'
const CORDIS_PEER = { peerDependencies: { [CORDIS]: 'workspace:^' } }
const CONTEXT_IMPORT = `import { Context } from '${CORDIS}'`
const FIXTURE_ADR_NOTE = '.agents/notes/fixture-cycle.md'

/** The fixture package name for a short name. */
function dsh(name: string): string {
  return `@deepseek-ai/dsh-${name}`
}

/**
 * Write exempted-cycle records whose `adrNote` names a file that exists, so a
 * case measures cycle matching rather than a missing note.
 * @param fixture - fixture repository root.
 * @param cycles - each record's package names in edge order.
 */
function writeCycleExemptions(fixture: string, cycles: readonly (readonly string[])[]): void {
  writeSource(fixture, FIXTURE_ADR_NOTE, '# Agent Note: fixture')
  writeExemptions(fixture, {
    $schemaVersion: 1,
    kernelEdgeAllowlist: [],
    exemptedCycles: cycles.map(cycle => ({ cycle, reason: 'fixture', owner: 'P0-04', adrNote: FIXTURE_ADR_NOTE, recordedDate: '2026-09-24' })),
  })
}

/**
 * Build a fixture whose production graph has the given edges and whose store
 * records the given cycles.
 * @param edges - `from` short name to the short names it depends on.
 * @param cycles - exempted cycles as short names in edge order.
 * @returns the fixture repository root.
 */
function graphFixture(edges: Record<string, string[]>, cycles: string[][] = []): string {
  const fixture = fixtureRoot()
  for (const [from, tos] of Object.entries(edges)) {
    writeManifest(fixture, `packages/core/${from}`, {
      name: dsh(from),
      dependencies: Object.fromEntries(tos.map(to => [dsh(to), 'workspace:^'])),
    })
  }
  writeCycleExemptions(fixture, cycles.map(cycle => cycle.map(dsh)))
  return fixture
}

/**
 * Build a fixture holding one kernel package and the vendored
 * `@deepseek-ai/cordis-plugin-loader`.
 * @param manifest - manifest fields for the kernel package beyond its name.
 * @param source - the kernel's `src/index.ts`, or `undefined` for none.
 * @returns the fixture repository root.
 */
function kernelFixture(manifest: Record<string, unknown>, source: string | undefined): string {
  const fixture = fixtureRoot()
  writeManifest(fixture, 'packages/kernel/k', { name: KERNEL, ...manifest })
  writeManifest(fixture, 'vendor/loader', { name: LOADER })
  if (source !== undefined) writeSource(fixture, 'packages/kernel/k/src/index.ts', source)
  return fixture
}

/**
 * Classify {@link PROVIDER} as `providers` the way the real repository
 * classifies its model providers: through an `architecture.layers.json` family.
 * @param fixture - fixture repository root.
 */
function writeProvidersFamily(fixture: string): void {
  writeFileSync(join(fixture, 'architecture.layers.json'), `${JSON.stringify({
    $schemaVersion: 1,
    families: [{ id: 'llm', definition: '@deepseek-ai/dsh-llm-def', providers: [PROVIDER], consumers: [] }],
    allowlist: [],
  }, null, 2)}\n`)
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
    expect(result.shortestCycle).toBeUndefined() // acceptance[0]
    // A generic upward edge between two ranked layers is a reported finding,
    // not a pass condition: must[0] requires the order be defined, must[2]
    // requires the three channels be detected, acceptance[0] is about cycles,
    // and the epic gate names only the kernel-reverse-edge and
    // expired-allowlist zeros. Asserting zero of them would make a
    // permanently red gate nobody reads. The split is asserted here so it
    // cannot be widened into a way of hiding a real violation.
    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.findings.every(finding => finding.rule === 'layer-violation')).toBe(true)
    expect(result.violations.map(violation => violation.rule)).not.toContain('layer-violation')
    expect(result.violations).toEqual([])
    expect(result.unclassified).toEqual([]) // gate: all packages classified
    expect(result.scanned.packages).toBeGreaterThan(200)
    expect(result.scanned.edges).toBeGreaterThan(0)
    // acceptance[2]'s 10-second budget is evidenced by timing the real CLI,
    // never asserted here: a wall-clock assertion passes on a fast runner and
    // fails on a loaded machine.
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
    writeManifest(fixture, 'packages/client/ui-fixture', { name: '@deepseek-ai/dsh-ui' })
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
      name: KERNEL,
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
    writeManifest(fixture, 'packages/client/ui-fixture', { name: '@deepseek-ai/dsh-ui' })
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
    const { edges } = collectLayerEdges(fixture, classifyWorkspacePackages(fixture).byPackage)
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

describe('acceptance[0]: the scanned workspace is the one pnpm-workspace.yaml declares', () => {
  it('enumerates every package pnpm-workspace.yaml declares and scans none it does not', () => {
    const fixture = fixtureRoot()
    writeWorkspace(fixture, ['packages/*/*', 'tools/*', 'vendor/*'])
    writeManifest(fixture, 'packages/core/p', { name: dsh('p') })
    writeManifest(fixture, 'tools/t', { name: dsh('t') })
    writeManifest(fixture, 'vendor/v', { name: '@deepseek-ai/vendored-v' })
    writeManifest(fixture, 'scratch/s', { name: dsh('s') })
    const classified = classifyWorkspacePackages(fixture)
    expect([...classified.byPackage.keys()]).toEqual([dsh('p')])
    expect(classified.unclassified).toEqual([dsh('t')])
    expect([...classified.vendored.keys()]).toEqual(['@deepseek-ai/vendored-v'])
  })

  it('covers the real workspace exactly as pnpm lists it, leaving no manifest unscanned', () => {
    // The oracle is pnpm's own project list, not a second reading of
    // pnpm-workspace.yaml: an error in how the checker expands the patterns
    // would repeat in any oracle that expanded them the same way.
    const listed = spawnSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root, encoding: 'utf8' })
    expect(listed.status, listed.stderr).toBe(0)
    // A listing that is not an array of projects with a path fails here
    // instead of comparing as an empty set.
    const projects: unknown = JSON.parse(listed.stdout)
    expect(Array.isArray(projects) && projects.every(project => typeof (project as { path?: unknown }).path === 'string'), listed.stdout.slice(0, 400)).toBe(true)
    const realRoot = realpathSync(root)
    const expected = (projects as { path: string }[])
      .map(project => relative(realRoot, realpathSync(project.path)).split(sep).join('/'))
      .filter(dir => dir !== '')
      .sort()
    // A floor, not the oracle: pnpm lists at least every directory the
    // workspace patterns match that holds a manifest.
    expect(expected.length).toBeGreaterThanOrEqual(declaredManifestDirs(root).length)
    const classified = classifyWorkspacePackages(root)
    expect(classified.unclassified).toEqual([])
    expect([...classified.byPackage.values(), ...classified.vendored.values()].map(pkg => pkg.dir).sort()).toEqual(expected)
    expect(classified.vendored.has(CORDIS)).toBe(true)
  }, 30_000)

  it('the layer checker refuses a pnpm-workspace.yaml that declares no packages', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/core/p', { name: dsh('p') })
    writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages: []\n')
    expect(() => runLayerDepsCheck(fixture)).toThrow('pnpm-workspace.yaml declares no packages')
    writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'linkWorkspacePackages: true\n')
    expect(() => runLayerDepsCheck(fixture)).toThrow('pnpm-workspace.yaml declares no packages')
  })
})

describe('acceptance[0]: every unexempted cycle is reported, and a record exempts the one cycle its edges name (layering.md rule 5)', () => {
  it('admits the vendored Cordis peer-dependency cycles only through their exemption records', () => {
    const fixture = fixtureRoot()
    // The peer fields of vendor/cordis, vendor/loader and vendor/include.
    writeManifest(fixture, 'vendor/cordis', {
      name: CORDIS,
      peerDependencies: { [INCLUDE]: 'workspace:^', [LOADER]: 'workspace:^' },
      peerDependenciesMeta: { [INCLUDE]: { optional: true }, [LOADER]: { optional: true } },
    })
    writeManifest(fixture, 'vendor/loader', {
      name: LOADER,
      peerDependencies: { [CORDIS]: 'workspace:^', 'node-addon-require-builtin': '^0.1.4' },
      peerDependenciesMeta: { 'node-addon-require-builtin': { optional: true } },
    })
    writeManifest(fixture, 'vendor/include', {
      name: INCLUDE,
      peerDependencies: { [LOADER]: 'workspace:^', [CORDIS]: 'workspace:^' },
    })
    writeCycleExemptions(fixture, [[CORDIS, LOADER], [CORDIS, INCLUDE]])
    const partial = runLayerDepsCheck(fixture)
    expect(partial.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(1)
    expect(partial.unexemptedCycles).toEqual([[CORDIS, INCLUDE, LOADER]])

    writeCycleExemptions(fixture, [[CORDIS, LOADER], [CORDIS, INCLUDE], [CORDIS, INCLUDE, LOADER]])
    const complete = runLayerDepsCheck(fixture)
    expect(complete.violations).toEqual([])
    expect(complete.unexemptedCycles).toEqual([])
  })

  it('fails when an exempted short cycle coexists with an unexempted longer one', () => {
    const result = runLayerDepsCheck(graphFixture({ a: ['b'], b: ['a'], c: ['d'], d: ['e'], e: ['c'] }, [['a', 'b']]))
    expect(result.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(1)
    expect(result.unexemptedCycles).toEqual([[dsh('c'), dsh('d'), dsh('e')]])
  })

  it('fails when an unexempted cycle shares an edge with an exempted one', () => {
    const result = runLayerDepsCheck(graphFixture({ a: ['b'], b: ['a', 'c'], c: ['a'] }, [['a', 'b']]))
    expect(result.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(1)
    expect(result.unexemptedCycles).toEqual([[dsh('a'), dsh('b'), dsh('c')]])
  })

  it('reports every unexempted cycle, not only the shortest', () => {
    const result = runLayerDepsCheck(graphFixture({ a: ['b'], b: ['a'], c: ['d'], d: ['e'], e: ['c'] }))
    expect(result.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(2)
    expect(result.unexemptedCycles).toEqual([[dsh('a'), dsh('b')], [dsh('c'), dsh('d'), dsh('e')]])
  })

  it('does not exempt a cycle whose record names the same packages in the other edge order', () => {
    const result = runLayerDepsCheck(graphFixture({ a: ['b'], b: ['c'], c: ['a'] }, [['a', 'c', 'b']]))
    expect(result.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(1)
    expect(result.unexemptedCycles).toEqual([[dsh('a'), dsh('b'), dsh('c')]])
  })

  it('reports a record naming an edge the production graph does not have as stale', () => {
    const result = runLayerDepsCheck(graphFixture({ a: ['b'], b: [] }, [['a', 'b']]))
    expect(result.violations.map(v => [v.rule, v.fromPackage])).toEqual([['stale-exempted-cycle', dsh('a')]])
  })

  it('rejects a record whose adrNote names no file', () => {
    const fixture = graphFixture({ a: ['b'], b: ['a'] })
    writeExemptions(fixture, {
      $schemaVersion: 1,
      kernelEdgeAllowlist: [],
      exemptedCycles: [{ cycle: [dsh('a'), dsh('b')], reason: 'fixture', owner: 'P0-04', adrNote: '.agents/notes/absent.md', recordedDate: '2026-09-24' }],
    })
    const violations = runLayerDepsCheck(fixture).violations
    expect(violations.map(v => v.rule)).toEqual(['malformed-exemption-store'])
    expect(violations[0]?.detail).toContain('.agents/notes/absent.md')
  })

  it('fails on a cycle made only of recorded edges that no record names', () => {
    // Two records whose edges together form every edge among a, b and c: the
    // three two-package cycles use recorded edges only and no record names them.
    const result = runLayerDepsCheck(graphFixture({ a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] }, [['a', 'b', 'c'], ['a', 'c', 'b']]))
    expect(result.violations.filter(v => v.rule === 'unexempted-cycle')).toHaveLength(3)
    expect(result.unexemptedCycles).toEqual([[dsh('a'), dsh('b')], [dsh('a'), dsh('c')], [dsh('b'), dsh('c')]])
  })

  it('rejects two records that name one cycle', () => {
    const violations = runLayerDepsCheck(graphFixture({ a: ['b'], b: ['a'] }, [['a', 'b'], ['b', 'a']])).violations
    expect(violations.map(v => v.rule)).toEqual(['malformed-exemption-store'])
  })
})

describe('acceptance[1]: only @deepseek-ai/dsh-trust-kernel may depend on Cordis, and only through the three forms the narrowed clause admits', () => {
  const admitted: [string, Record<string, unknown>, string][] = [
    ['the Context import binding', {}, CONTEXT_IMPORT],
    ['the @deepseek-ai/cordis peer declaration the Context binding needs', CORDIS_PEER, CONTEXT_IMPORT],
    ['a declare-module augmentation of the Context interface', {}, `export {}\ndeclare module '${CORDIS}' {\n  interface Context {\n    probe: string\n  }\n}`],
  ]

  it.each(admitted)('admits %s', (_form, manifest, source) => {
    const result = runLayerDepsCheck(kernelFixture(manifest, source))
    expect(result.violations).toEqual([])
    expect(result.kernelEdges.map(edge => [edge.toPackage, edge.verdict])).toEqual([[CORDIS, 'permitted-binding']])
  })

  it('admits the three forms to @deepseek-ai/dsh-trust-kernel alone: another kernel package using them is refused', () => {
    const forms = `${CONTEXT_IMPORT}\ndeclare module '${CORDIS}' {\n  interface Context {\n    probe: string\n  }\n}`
    const other = fixtureRoot()
    writeManifest(other, 'packages/kernel/other', { name: OTHER_KERNEL, ...CORDIS_PEER })
    writeSource(other, 'packages/kernel/other/src/index.ts', forms)
    const refused = runLayerDepsCheck(other).violations
    expect(refused.map(v => [v.rule, v.fromPackage, v.toPackage])).toEqual([['kernel-forbidden-cordis-binding', OTHER_KERNEL, CORDIS]])
    expect(refused[0]?.detail).toContain('Context')
    // The same manifest and source under the Trust Kernel's name are admitted,
    // so the refusal above is the package name's doing.
    expect(runLayerDepsCheck(kernelFixture(CORDIS_PEER, forms)).violations).toEqual([])
  })

  const rejected: [string, Record<string, unknown>, string | undefined, string][] = [
    ['another Cordis binding beside Context', CORDIS_PEER, `import { Context, Service } from '${CORDIS}'`, CORDIS],
    ['a re-export of Context', CORDIS_PEER, `${CONTEXT_IMPORT}\nexport { Context } from '${CORDIS}'`, CORDIS],
    ['export *', CORDIS_PEER, `${CONTEXT_IMPORT}\nexport * from '${CORDIS}'`, CORDIS],
    ['export * as ns', CORDIS_PEER, `${CONTEXT_IMPORT}\nexport * as cordis from '${CORDIS}'`, CORDIS],
    ['a side-effect import', CORDIS_PEER, `${CONTEXT_IMPORT}\nimport '${CORDIS}'`, CORDIS],
    ['import {}', CORDIS_PEER, `${CONTEXT_IMPORT}\nimport {} from '${CORDIS}'`, CORDIS],
    ['a dynamic import()', CORDIS_PEER, `${CONTEXT_IMPORT}\nexport const load = () => import('${CORDIS}')`, CORDIS],
    ['require()', CORDIS_PEER, `${CONTEXT_IMPORT}\nexport const load = () => require('${CORDIS}')`, CORDIS],
    ['import = require()', CORDIS_PEER, `${CONTEXT_IMPORT}\nimport cordis = require('${CORDIS}')`, CORDIS],
    ['a triple-slash types reference', CORDIS_PEER, `/// <reference types="${CORDIS}" />\n${CONTEXT_IMPORT}`, CORDIS],
    ['a declare-module augmentation of an interface other than Context', CORDIS_PEER, `${CONTEXT_IMPORT}\ndeclare module '${CORDIS}' {\n  interface Events {\n    'kernel/probe'(): void\n  }\n}`, CORDIS],
    ['a Cordis declaration in dependencies rather than peerDependencies', { dependencies: { [CORDIS]: 'workspace:^' } }, CONTEXT_IMPORT, CORDIS],
    ['a Cordis peer declaration no Context use needs', CORDIS_PEER, undefined, CORDIS],
    ['a vendored package declared in dependencies', { ...CORDIS_PEER, dependencies: { [LOADER]: 'workspace:^' } }, CONTEXT_IMPORT, LOADER],
    ['a vendored package declared in peerDependencies', { peerDependencies: { [CORDIS]: 'workspace:^', [LOADER]: 'workspace:^' } }, CONTEXT_IMPORT, LOADER],
    ['a vendored package declared in optionalDependencies', { ...CORDIS_PEER, optionalDependencies: { [LOADER]: 'workspace:^' } }, CONTEXT_IMPORT, LOADER],
  ]

  it.each(rejected)('rejects a kernel dependency on vendored Cordis through %s', (_form, manifest, source, target) => {
    const violations = runLayerDepsCheck(kernelFixture(manifest, source)).violations
    expect(violations.filter(v => v.rule === 'kernel-forbidden-cordis-binding').map(v => v.toPackage)).toEqual([target])
  })
})

describe('acceptance[1]: a kernel package depends on no model provider, UI package or external package', () => {
  it('rejects a kernel dependency on a model provider that architecture.layers.json classifies as providers', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', { name: KERNEL, peerDependencies: { [PROVIDER]: 'workspace:^' } })
    writeManifest(fixture, 'packages/llm/llm-x', { name: PROVIDER })
    writeProvidersFamily(fixture)
    expect(classifyWorkspacePackages(fixture).byPackage.get(PROVIDER)?.layer).toBe('providers')
    const violations = runLayerDepsCheck(fixture).violations
    expect(violations.map(v => [v.rule, v.toPackage])).toEqual([['kernel-upward-dependency', PROVIDER]])
    expect(violations[0]?.detail.startsWith('kernel -> providers')).toBe(true)
  })

  // Every row also imports two Node builtins and a package-internal subpath,
  // none of which is an external package.
  const nonExternalImports = "import { createHash } from 'node:crypto'\nimport { readFileSync } from 'fs'\nimport { probe } from '#probe'"
  const external: [string, Record<string, unknown>, string, string][] = [
    ['a static import', {}, "import { complete } from '@earendil-works/pi-ai'", '@earendil-works/pi-ai'],
    ['a type-only import', {}, "import type { MessageParam } from '@anthropic-ai/sdk'", '@anthropic-ai/sdk'],
    ['a re-export', {}, "export { Anthropic } from '@anthropic-ai/sdk'", '@anthropic-ai/sdk'],
    ['a dynamic import()', {}, "export const load = () => import('@openai/codex')", '@openai/codex'],
    ['require()', {}, "export const load = () => require('@openai/codex')", '@openai/codex'],
    ['a manifest declaration', { dependencies: { '@anthropic-ai/claude-agent-sdk': '^0.3.0' } }, '', '@anthropic-ai/claude-agent-sdk'],
  ]

  it.each(external)('rejects a kernel dependency on an external package through %s', (_form, manifest, source, target) => {
    const violations = runLayerDepsCheck(kernelFixture(manifest, `${nonExternalImports}\n${source}`)).violations
    expect(violations.filter(v => v.rule === 'kernel-external-dependency').map(v => v.toPackage)).toEqual([target])
  })

  const allowlisted: [string, (fixture: string) => void, string, string][] = [
    ['a Cordis binding other than Context', fixture => {
      writeSource(fixture, 'packages/kernel/k/src/index.ts', `import { Context, Service } from '${CORDIS}'`)
    }, CORDIS, 'kernel-forbidden-cordis-binding'],
    ['a UI package', fixture => {
      writeManifest(fixture, 'packages/client/ui-fixture', { name: UI })
    }, UI, 'kernel-upward-dependency'],
    ['a model provider', fixture => {
      writeManifest(fixture, 'packages/llm/llm-x', { name: PROVIDER })
      writeProvidersFamily(fixture)
    }, PROVIDER, 'kernel-upward-dependency'],
  ]

  it.each(allowlisted)('refuses to let an unexpired kernelEdgeAllowlist entry suppress a kernel dependency on %s', (_target, writeTarget, target, rule) => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/kernel/k', { name: KERNEL, peerDependencies: { [target]: 'workspace:^', [ORCH]: 'workspace:^' } })
    writeManifest(fixture, 'packages/core/orch', { name: ORCH })
    writeTarget(fixture)
    writeExemptions(fixture, {
      $schemaVersion: 1,
      exemptedCycles: [],
      kernelEdgeAllowlist: [target, ORCH].map(toPackage => ({ fromPackage: KERNEL, toPackage, owner: 'P0-04', reason: 'fixture', expires: '2999-01-01' })),
    })
    const result = runLayerDepsCheck(fixture)
    expect(result.violations.filter(v => v.toPackage === target).map(v => v.rule)).toEqual([rule])
    // The same store still admits the kernel's orchestration-runtime edge, so
    // the refusal above is decided by the target, not by a disabled allowlist.
    expect(result.kernelEdges.find(edge => edge.toPackage === ORCH)?.verdict).toBe('allowlisted')
  })
})

describe('acceptance[2]: the real CLI', () => {
  /**
   * Run the real `pnpm run architecture:layers` against a fixture root.
   * @param fixture - fixture repository root.
   * @param budgetMs - the time budget passed as `--budget-ms`.
   * @returns the finished process.
   */
  function runCli(fixture: string, budgetMs: number) {
    return spawnSync('pnpm', ['run', 'architecture:layers', '--', '--repo-root', fixture, '--budget-ms', String(budgetMs)], { cwd: root, encoding: 'utf8' })
  }

  it('the CLI exits 0 on a clean workspace within its time budget and prints its elapsed time', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/core/a', { name: dsh('a') })
    const result = runCli(fixture, 600_000)
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toMatch(/ in \d+\.\d{2}s\./)
  }, 30_000)

  it('the CLI exits non-zero with a time-budget line when the run exceeds its time budget', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/core/a', { name: dsh('a') })
    const result = runCli(fixture, 0)
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).not.toBe(0)
    expect(result.stderr).toContain('check-layer-deps: time-budget:')
  }, 30_000)

  it('the CLI prints the shortest cycle path when an unexempted cycle exists', () => {
    const result = runCli(graphFixture({ a: ['b'], b: ['a'], c: ['d'], d: ['e'], e: ['c'] }), 600_000)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`check-layer-deps: unexempted-cycle: ${dsh('a')} -> ${dsh('b')}: shortest cycle: ${dsh('a')} -> ${dsh('b')} -> ${dsh('a')}\n`)
  }, 30_000)
})
