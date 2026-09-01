/**
 * Epic P0-03 U-stage: the real capability-seam scanner
 * (`scripts/architecture/check-capability-seams.mjs`) — real workspace
 * `package.json` and TypeScript-import scanning (must[1]), real must[2] test
 * evidence, and the resulting gate run against the real repository
 * (acceptance[0]) and against on-disk fixture repositories constructed for
 * this suite (acceptance[2]). `tests/architecture/capability-seams.spec.ts`
 * covers the C-stage pure detector/schema module this scanner calls; this
 * suite covers only the real filesystem scan and gate wiring.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, afterEach } from 'vitest'
import {
  collectImportSpecifiers,
  collectResolvedImports,
  readAppPackages,
  readCapabilityTestEvidence,
  readWorkspacePackages,
  runCapabilitySeamsCheck,
} from '../../scripts/architecture/check-capability-seams.mjs'

const root = resolve(import.meta.dirname, '../..')

const roots: string[] = []
afterEach(() => {
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

/** Create a fresh on-disk fixture repository root, cleaned up after the test. */
function fixtureRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-check-capability-seams-'))
  roots.push(dir)
  return dir
}

function writeManifest(fixture: string, dir: string, name: string): void {
  mkdirSync(join(fixture, dir), { recursive: true })
  writeFileSync(join(fixture, dir, 'package.json'), JSON.stringify({ name }, null, 2))
}

function writeSource(fixture: string, dir: string, relPath: string, content: string): void {
  const filePath = join(fixture, dir, relPath)
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, content)
}

function writeLayers(fixture: string, layers: unknown): void {
  writeFileSync(join(fixture, 'architecture.layers.json'), JSON.stringify(layers, null, 2))
}

describe('collectImportSpecifiers (must[1] real TypeScript-import scan)', () => {
  it('collects a runtime import, a type-only import, an export-from, and a require specifier', () => {
    const source = [
      "import { a } from 'pkg-a'",
      "import type { B } from 'pkg-b'",
      "export { c } from 'pkg-c'",
      "const d = require('pkg-d')",
      "import './local.ts'",
    ].join('\n')
    expect(collectImportSpecifiers('/virtual/file.ts', source)).toEqual([
      'pkg-a', 'pkg-b', 'pkg-c', 'pkg-d', './local.ts',
    ])
  })
})

describe('readWorkspacePackages / readAppPackages (must[1] real package.json scan)', () => {
  it('resolves a real workspace package name to its real directory', () => {
    const packages = readWorkspacePackages(root)
    expect(packages.get('@deepseek-ai/dsh-shell')).toBe('packages/shell/shell')
    expect(packages.get('@deepseek-ai/dsh-agent-loop')).toBe('packages/core/agent-loop')
  })

  it('classifies packages/client/* and apps/* as application/UI code, and a provider package as not', () => {
    const appPackages = readAppPackages(root)
    expect(appPackages.has('@deepseek-ai/dsh-client-ui-chat')).toBe(true)
    expect(appPackages.has('@deepseek-ai/dsh-web-frontend')).toBe(true)
    expect(appPackages.has('@deepseek-ai/dsh-bash-local')).toBe(false)
  })
})

describe('the real workspace (acceptance[0]): runCapabilitySeamsCheck against the real repository', () => {
  it('reports zero schema errors and zero unsuppressed violations under the controlled allowlist', () => {
    const result = runCapabilitySeamsCheck(root)
    expect(result.schemaErrors).toEqual([])
    expect(result.violations).toEqual([])
    expect(result.scanned.families).toBeGreaterThan(0)
    expect(result.scanned.packages).toBeGreaterThan(0)
    expect(result.scanned.imports).toBeGreaterThan(0)
  })

  it('resolves a real multi-family Consumer (packages/core/agent-loop) import without flagging a violation', () => {
    // packages/core/agent-loop is a real Consumer of the llm, sessionPersistence,
    // and settings families (architecture.layers.json); its src/index.ts imports
    // @deepseek-ai/dsh-llm's published entry point. This is the concrete,
    // non-vacuous real-file evidence for acceptance[0]: a scanner that flagged
    // everything (or nothing, without scanning) would not distinguish this real,
    // legitimate edge from a violation.
    const packages = readWorkspacePackages(root)
    const imports = collectResolvedImports(root, packages)
    const agentLoopToLlm = imports.find(edge =>
      edge.fromFile === 'packages/core/agent-loop/src/index.ts' && edge.toPackage === '@deepseek-ai/dsh-llm')
    expect(agentLoopToLlm).toEqual({
      fromPackage: '@deepseek-ai/dsh-agent-loop',
      fromFile: 'packages/core/agent-loop/src/index.ts',
      toPackage: '@deepseek-ai/dsh-llm',
      toSpecifier: '@deepseek-ai/dsh-llm',
      toIsDeepImport: false,
    })
    const { violations } = runCapabilitySeamsCheck(root)
    expect(violations.some(violation => violation.sourceFile === 'packages/core/agent-loop/src/index.ts')).toBe(false)
  }, 20_000)
})

describe('on-disk violation fixtures (acceptance[2]): the gate fails against real fixture files, not in-memory data', () => {
  it('fails with a deep-import violation when a real fixture consumer imports a real fixture provider\'s src/*', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeSource(fixture, 'packages/fixture/provider', 'src/thing.ts', 'export const thing = 1\n')
    writeSource(fixture, 'packages/fixture/consumer', 'src/index.ts', "import { thing } from 'fixture-provider/src/thing.ts'\n")
    // Give the family the rest of must[2]'s real evidence so this fixture
    // isolates the deep-import violation alone: a provider fixture, a
    // consumer composition test (imports the family's own definition), and
    // an unload/rollback test.
    writeSource(fixture, 'packages/fixture/provider', 'tests/provider.spec.ts', "import { it } from 'vitest'\nit('provides', () => {})\n")
    writeSource(fixture, 'packages/fixture/consumer', 'tests/consumer.spec.ts', "import 'fixture-def'\nimport { it } from 'vitest'\nit('disposes cleanly on unload', () => {})\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    const { violations } = runCapabilitySeamsCheck(fixture)
    expect(violations).toEqual([{
      kind: 'deep-import',
      edge: { from: 'fixture-consumer', to: 'fixture-provider' },
      sourceFile: 'packages/fixture/consumer/src/index.ts',
      remediation: expect.stringContaining('fixture-def') as string,
    }])
  })

  it('fails with a missing-provider violation when a real fixture family declares zero providers', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: [], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    // A family with zero providers structurally cannot own a provider
    // fixture either, so must[2]'s non-reversible-registration check fires
    // too (the real repository allowlists both for the same two self-
    // providing families); assert missing-provider by kind rather than
    // requiring it to be the fixture's only violation.
    const { violations } = runCapabilitySeamsCheck(fixture)
    expect(violations.filter(violation => violation.kind === 'missing-provider')).toEqual([{
      kind: 'missing-provider',
      edge: { from: 'fixture-def', to: 'fixture-def' },
      sourceFile: 'architecture.layers.json',
      remediation: expect.stringContaining('fixture') as string,
    }])
  })

  it('fails with a non-reversible-registration violation when a real fixture family has no consumer composition or unload/rollback test', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    // A provider fixture exists (must[2]'s first artifact)...
    writeSource(fixture, 'packages/fixture/provider', 'tests/provider.spec.ts', "import { it } from 'vitest'\nit('provides', () => {})\n")
    // ...but the consumer's test never composes the provider or definition, and
    // nothing anywhere exercises unload/rollback/dispose.
    writeSource(fixture, 'packages/fixture/consumer', 'tests/consumer.spec.ts', "import { it } from 'vitest'\nit('consumes', () => {})\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    const evidence = readCapabilityTestEvidence(fixture, readWorkspacePackages(fixture), {
      id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'],
    })
    expect(evidence).toEqual({
      familyId: 'fixture', hasProviderFixture: true, hasConsumerCompositionTest: false, hasUnloadRollbackTest: false,
    })

    const { violations } = runCapabilitySeamsCheck(fixture)
    expect(violations).toEqual([{
      kind: 'non-reversible-registration',
      edge: { from: 'fixture-def', to: 'fixture-def' },
      sourceFile: 'architecture.layers.json',
      remediation: expect.stringMatching(/consumer composition test.*unload\/rollback test/) as string,
    }])
  })

  it('fails with a provider-app-dependency violation when a real fixture provider imports a real fixture app/UI package (bonus must[1] coverage)', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeManifest(fixture, 'packages/client/fixture-app', 'fixture-app')
    writeSource(fixture, 'packages/fixture/provider', 'src/index.ts', "import 'fixture-app'\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    const { violations } = runCapabilitySeamsCheck(fixture)
    expect(violations).toContainEqual({
      kind: 'provider-app-dependency',
      edge: { from: 'fixture-provider', to: 'fixture-app' },
      sourceFile: 'packages/fixture/provider/src/index.ts',
      remediation: expect.stringContaining('fixture') as string,
    })
  })

  it('suppresses an otherwise-failing fixture violation covered by a dated, owned allowlist entry', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: [], consumers: [] }],
      allowlist: [{
        kind: 'missing-provider', from: 'fixture-def', to: 'fixture-def',
        reason: 'fixture', owner: 'test@example.com', removalDate: '2099-01-01',
      }],
    })

    const { violations } = runCapabilitySeamsCheck(fixture)
    expect(violations.filter(violation => violation.kind === 'missing-provider')).toEqual([])
  })
})

describe('CI output (acceptance[3]): the real CLI script names the edge, source file, and a remediation', () => {
  it('prints the dependency edge, source file, and remediation for a real fixture violation, and exits non-zero', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeSource(fixture, 'packages/fixture/provider', 'src/thing.ts', 'export const thing = 1\n')
    writeSource(fixture, 'packages/fixture/consumer', 'src/index.ts', "import { thing } from 'fixture-provider/src/thing.ts'\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    // An absolute file:// specifier, not a relative one: the mkdtemp fixture
    // root's depth relative to the repository is a platform/OS-tmpdir detail
    // the driver script must not encode.
    const scannerUrl = pathToFileURL(resolve(root, 'scripts/architecture/check-capability-seams.mjs')).href
    const scriptSource = [
      `import { runCapabilitySeamsCheck, formatViolation } from ${JSON.stringify(scannerUrl)}`,
      `const { violations } = runCapabilitySeamsCheck(${JSON.stringify(fixture)})`,
      'for (const violation of violations) console.log(formatViolation(violation))',
      'if (violations.length > 0) process.exitCode = 1',
    ].join('\n')
    const driver = join(fixture, 'drive-check.mjs')
    writeFileSync(driver, scriptSource)

    let stdout = ''
    let failed = false
    try {
      stdout = execFileSync('npx', ['tsx', driver], { cwd: root, encoding: 'utf8' })
    } catch (error: unknown) {
      failed = true
      stdout = (error as { stdout: string }).stdout
    }
    expect(failed).toBe(true)
    expect(stdout).toContain('fixture-consumer -> fixture-provider')
    expect(stdout).toContain('packages/fixture/consumer/src/index.ts')
    expect(stdout).toContain('fixture-def')
  })
})

/**
 * Epic P0-03 F-stage. `tests/architecture/capability-seams.spec.ts` (declared
 * in the epic's F-stage files) covers the pure `capability-seams.ts` module;
 * these cases exercise the real filesystem scan and gate wiring this file
 * already owns (U-stage), so they land here instead — a files[] deviation
 * (BLOCKED-012) the Supervisor's manifest-patch process should record.
 */
describe('multiple simultaneous violations (F-stage): the real scanner reports every violation from one scan, not just one', () => {
  it('reports a deep-import, a provider-app-dependency, and a missing-provider violation together from one real fixture', () => {
    const fixture = fixtureRoot()
    // Family "seam" carries full must[2] evidence (provider fixture, consumer
    // composition test, unload/rollback test) so its only violations are the
    // two structural ones below — isolated from the non-reversible-registration
    // check U-stage's fixtures already cover one kind at a time.
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeManifest(fixture, 'packages/client/fixture-app', 'fixture-app')
    writeSource(fixture, 'packages/fixture/provider', 'src/thing.ts', 'export const thing = 1\n')
    writeSource(fixture, 'packages/fixture/provider', 'src/index.ts', "import 'fixture-app'\n")
    writeSource(fixture, 'packages/fixture/consumer', 'src/index.ts', "import { thing } from 'fixture-provider/src/thing.ts'\n")
    writeSource(fixture, 'packages/fixture/provider', 'tests/provider.spec.ts', "import { it } from 'vitest'\nit('provides', () => {})\n")
    writeSource(fixture, 'packages/fixture/consumer', 'tests/consumer.spec.ts', "import 'fixture-def'\nimport { it } from 'vitest'\nit('disposes cleanly on unload', () => {})\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [
        { id: 'seam', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] },
        // A second, unrelated family with zero providers: missing-provider
        // fires simultaneously alongside "seam"'s two structural violations.
        { id: 'empty', definition: 'fixture-def', providers: [], consumers: [] },
      ],
      allowlist: [],
    })

    const { violations } = runCapabilitySeamsCheck(fixture)
    const kinds = violations.map(violation => violation.kind)
    expect(kinds).toContain('deep-import')
    expect(kinds).toContain('provider-app-dependency')
    expect(kinds).toContain('missing-provider')
    expect(violations.length).toBeGreaterThanOrEqual(3)
  })
})

describe('malformed architecture.layers.json (F-stage): the real scanner fails closed with a clear schema error, never a crash', () => {
  it('reports a clear error and zero violations, without throwing, when families is missing from the real fixture file', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, { $schemaVersion: 1, allowlist: [] })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual(['architecture.layers.json: families must be an array'])
    expect(result.violations).toEqual([])
  })

  it('reports a clear error and zero violations, without throwing, when a family in the real fixture file is missing providers', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', consumers: [] }],
      allowlist: [],
    })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual(['fixture: providers must be an array'])
    expect(result.violations).toEqual([])
  })

  it('still reports a clear schema error (and keeps scanning) when a real fixture family references a package absent from the workspace', () => {
    // Already proven at the pure validateArchitectureLayers level in
    // tests/architecture/capability-seams.spec.ts; this is the same case
    // proven through the real filesystem scan (must[1]'s real boundary).
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['does-not-exist'], consumers: [] }],
      allowlist: [],
    })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual(['fixture: does-not-exist is not a workspace package'])
  })

  it('still reports a clear schema error (and keeps scanning) when the real fixture file declares a family id twice', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [
        { id: 'fixture', definition: 'fixture-def', providers: ['fixture-def'], consumers: [] },
        { id: 'fixture', definition: 'fixture-def', providers: ['fixture-def'], consumers: [] },
      ],
      allowlist: [],
    })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual(['family id fixture is declared more than once'])
  })

  // The three cases below are array-ELEMENT malformations, not array-type
  // malformations: `families`/`allowlist` are real arrays (the cases above
  // already cover the array-typed field itself being missing/wrong-typed),
  // but one element of the array is not a well-formed object. Before this
  // fix, each crashed with an opaque TypeError reading a field off `null`/
  // `undefined` instead of reporting a schema error.

  it('reports a clear error and zero violations, without throwing, when a real fixture families element is null', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, { $schemaVersion: 1, families: [null], allowlist: [] })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual([
      'architecture.layers.json: a capability family must be an object, got null',
    ])
    expect(result.violations).toEqual([])
  })

  it('reports a clear error and zero violations, without throwing, when a real fixture allowlist element is null', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-def'], consumers: [] }],
      allowlist: [null],
    })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual([
      'architecture.layers.json: an allowlist entry must be an object, got null',
    ])
    expect(result.violations).toEqual([])
  })

  it('reports a clear error, without throwing, when a real fixture allowlist entry is missing its owner field', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeSource(fixture, 'packages/fixture/def', 'tests/def.spec.ts', "import { it } from 'vitest'\nit('disposes cleanly on unload', () => {})\n")
    writeSource(fixture, 'packages/fixture/consumer', 'tests/consumer.spec.ts', "import 'fixture-def'\nimport { it } from 'vitest'\nit('consumes', () => {})\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-def'], consumers: ['fixture-consumer'] }],
      allowlist: [{
        kind: 'missing-provider',
        from: 'fixture-def',
        to: 'fixture-def',
        reason: 'hand-edited allowlist entry',
        removalDate: '2026-12-01',
        // owner intentionally omitted -- a plausible hand-edit slip.
      }],
    })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual([
      'missing-provider fixture-def -> fixture-def: owner must be a string, got undefined',
    ])
    // owner is not part of hasScannableShape's gate (unlike a malformed
    // families/allowlist element), so the scan still runs; the fixture
    // supplies full must[2] evidence so there is no real violation, which
    // isolates the owner-type schema error from unrelated violations.
    expect(result.violations).toEqual([])
  })

  it('reports a clear error, without throwing, when a real fixture families element is a string instead of an object', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeLayers(fixture, { $schemaVersion: 1, families: ['fixture'], allowlist: [] })

    const result = runCapabilitySeamsCheck(fixture)
    expect(result.schemaErrors).toEqual([
      'architecture.layers.json: a capability family must be an object, got "fixture"',
    ])
    expect(result.violations).toEqual([])
  })
})

describe('the real `pnpm run architecture:seams` command (F-stage): CI-blocking exit code end-to-end, not just a function\'s return value', () => {
  it('matches the declared package.json script this suite\'s other cases assume', () => {
    const rootPackageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    expect(rootPackageJson.scripts?.['architecture:seams']).toBe('tsx scripts/architecture/check-capability-seams.mjs')
  })

  it('exits 0 for a real clean fixture when invoked as the real pnpm script (not the underlying function directly)', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeSource(fixture, 'packages/fixture/def', 'tests/def.spec.ts', "import { it } from 'vitest'\nit('disposes cleanly on unload', () => {})\n")
    writeSource(fixture, 'packages/fixture/consumer', 'tests/consumer.spec.ts', "import 'fixture-def'\nimport { it } from 'vitest'\nit('consumes', () => {})\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-def'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    // cwd stays the real repository so pnpm resolves its own tsx toolchain;
    // --repo-root redirects the scan to the fixture, matching this epic's
    // own validation clause ("对一个测试 package 临时加入...deep import，确认失败后恢复")
    // without ever mutating the real repository's tracked source.
    const result = spawnSync('pnpm', ['run', 'architecture:seams', '--', '--repo-root', fixture], { cwd: root, encoding: 'utf8' })
    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('0 violation(s)')
  }, 30_000)

  it('exits non-zero for a real fixture violation when invoked as the real pnpm script, naming the edge, file, and remediation', () => {
    const fixture = fixtureRoot()
    writeManifest(fixture, 'packages/fixture/def', 'fixture-def')
    writeManifest(fixture, 'packages/fixture/provider', 'fixture-provider')
    writeManifest(fixture, 'packages/fixture/consumer', 'fixture-consumer')
    writeSource(fixture, 'packages/fixture/provider', 'src/thing.ts', 'export const thing = 1\n')
    writeSource(fixture, 'packages/fixture/consumer', 'src/index.ts', "import { thing } from 'fixture-provider/src/thing.ts'\n")
    writeLayers(fixture, {
      $schemaVersion: 1,
      families: [{ id: 'fixture', definition: 'fixture-def', providers: ['fixture-provider'], consumers: ['fixture-consumer'] }],
      allowlist: [],
    })

    const result = spawnSync('pnpm', ['run', 'architecture:seams', '--', '--repo-root', fixture], { cwd: root, encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    // main() reports violations through console.error, matching every other
    // "unsuccessful command" line this gate prints.
    expect(result.stderr).toContain('fixture-consumer -> fixture-provider')
    expect(result.stderr).toContain('packages/fixture/consumer/src/index.ts')
    expect(result.stderr).toContain('fixture-def')
  }, 30_000)
})
