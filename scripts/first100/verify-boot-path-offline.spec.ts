/**
 * Behavior of the profile-boot offline invariant (P1-03 acceptance[0]).
 *
 * The point of these cases is that the gate CAN go red. A structural check
 * that only ever passes is the same failure as the behavioural test it
 * replaced — `fetch` stubbed and asserted zero times passes against every
 * implementation, because no code on the path can call it. So each case adds a
 * real egress to a fixture closure and requires the gate to find it.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = 'scripts/first100/verify-boot-path-offline.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** One package to place in the fixture closure. */
interface FixturePackage {
  dir: string
  name: string
  dependencies?: Record<string, string>
  sources?: Record<string, string>
}

/**
 * A fixture repository with the two boot roots the gate reads, each carrying
 * the dependencies and source given for it.
 * @param packages - one entry per package: its directory, manifest dependencies, and source files.
 * @returns the fixture root.
 */
function fixture(packages: readonly FixturePackage[]): string {
  const root = mkdtempSync(join(tmpdir(), 'boot-offline-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  cpSync(join(REPO, SCRIPT), join(root, SCRIPT))
  for (const { dir, name, dependencies, sources } of packages) {
    mkdirSync(join(root, dir, 'src'), { recursive: true })
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, dependencies: dependencies ?? {} }))
    for (const [file, content] of Object.entries(sources ?? {})) {
      writeFileSync(join(root, dir, 'src', file), content)
    }
  }
  return root
}

/** The two roots the gate always reads, with nothing in them. */
const emptyRoots = [
  { dir: 'packages/boot/app-boot', name: '@deepseek-ai/dsh-app-boot' },
  { dir: 'packages/plugin/plugin-lock', name: '@deepseek-ai/dsh-plugin-lock' },
]

function run(root: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync(process.execPath, [join(root, SCRIPT)], { cwd: root, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` }
  }
}

describe('P1-03 acceptance[0]: the profile-boot closure cannot reach the network', () => {
  it('passes a closure with no HTTP client and no egress call', () => {
    const root = fixture([
      { ...emptyRoots[0]!, sources: { 'index.ts': 'export const compose = (): string => "local"\n' } },
      { ...emptyRoots[1]!, sources: { 'index.ts': 'export const gate = (): boolean => true\n' } },
    ])
    const { code, output } = run(root)
    expect(code).toBe(0)
    expect(output).toContain('no network egress')
  })

  it('REFUSES a closure whose package.json depends on an HTTP client', () => {
    // A client can be present with no source file naming a URL, so the
    // dependency list is checked separately from the sources.
    const root = fixture([
      { ...emptyRoots[0]!, dependencies: { undici: '^6.0.0' } },
      emptyRoots[1]!,
    ])
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('undici')
  })

  it('REFUSES a closure whose source calls fetch, with no such dependency declared', () => {
    // The other half: `fetch` is a global, so an egress can exist with a
    // completely clean dependency list.
    const root = fixture([
      { ...emptyRoots[0]!, sources: { 'index.ts': 'export const load = async (): Promise<Response> => fetch("https://example.invalid")\n' } },
      emptyRoots[1]!,
    ])
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('network egress')
  })

  it('REFUSES an egress reached TRANSITIVELY, not only in the two roots', () => {
    // The closure is the point. A gate checking only the roots would pass a
    // profile-boot that imports a package which fetches.
    const root = fixture([
      { ...emptyRoots[0]!, dependencies: { '@deepseek-ai/dsh-deep': 'workspace:^' } },
      emptyRoots[1]!,
      {
        dir: 'packages/util/deep',
        name: '@deepseek-ai/dsh-deep',
        sources: { 'index.ts': 'import https from "node:https"\nexport const client = https\n' },
      },
    ])
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('packages/util/deep')
  })

  it('ignores a vendored Cordis dependency, which is the framework rather than a chosen dependency', () => {
    const root = fixture([
      { ...emptyRoots[0]!, dependencies: { '@deepseek-ai/cordis': 'workspace:^' } },
      emptyRoots[1]!,
    ])
    expect(run(root).code).toBe(0)
  })
})
