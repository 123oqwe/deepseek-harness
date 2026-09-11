/**
 * Behaviour of the undeclared-runtime-import gate.
 *
 * The integration cases build a throwaway workspace rather than asserting
 * against this repository, because a gate measured only against the tree it was
 * written on cannot distinguish "finds nothing" from "finds nothing here". Each
 * negative case is paired with the positive one that makes it mean something:
 * the same import is reported when undeclared and silent when declared.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isClientFaceSource,
  packageNameOf,
  shippedDeclarations,
  undeclaredImports,
} from './verify-import-integrity.ts'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() ?? '', { recursive: true, force: true })
})

/**
 * Build a one-package workspace and return its root.
 * @param manifest - the package manifest to write.
 * @param sources - source files keyed by path under `src/`.
 * @returns the temporary repository root.
 */
function workspace(manifest: Record<string, unknown>, sources: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'import-integrity-'))
  roots.push(root)
  const dir = join(root, 'packages', 'group', 'pkg')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [path, text] of Object.entries(sources)) {
    const full = join(dir, 'src', path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}

const NAME = '@deepseek-ai/dsh-fixture'

describe('packageNameOf', () => {
  it('keeps the scope and drops the subpath', () => {
    expect(packageNameOf('@deepseek-ai/dsh-brand')).toBe('@deepseek-ai/dsh-brand')
    expect(packageNameOf('@deepseek-ai/dsh-llm/brand')).toBe('@deepseek-ai/dsh-llm')
    expect(packageNameOf('zod')).toBe('zod')
    expect(packageNameOf('typescript/lib/typescript.js')).toBe('typescript')
  })

  it('names no package for a specifier that resolves without one', () => {
    expect(packageNameOf('./sibling.ts')).toBeUndefined()
    expect(packageNameOf('../up.ts')).toBeUndefined()
    expect(packageNameOf('/abs')).toBeUndefined()
    expect(packageNameOf('#internal')).toBeUndefined()
    expect(packageNameOf('node:fs')).toBeUndefined()
    // A bare scope is not a package name; treating it as one would report `@scope`.
    expect(packageNameOf('@deepseek-ai')).toBeUndefined()
  })
})

describe('isClientFaceSource', () => {
  it('matches both spellings the tree actually uses', () => {
    expect(isClientFaceSource('packages/client/ui-chat/src/index.ts')).toBe(true)
    expect(isClientFaceSource('packages/api/session-controller/src/client/store.ts')).toBe(true)
  })

  it('does not match a Host source whose name merely contains the word', () => {
    expect(isClientFaceSource('packages/sdk/client/src/index.ts')).toBe(false)
    expect(isClientFaceSource('packages/core/agent/src/client-adapter.ts')).toBe(false)
  })
})

describe('shippedDeclarations', () => {
  it('reads the three sections a consumer installs', () => {
    const declared = shippedDeclarations({
      dependencies: { a: '1' },
      peerDependencies: { b: '1' },
      optionalDependencies: { c: '1' },
    })
    expect([...declared].sort()).toStrictEqual(['a', 'b', 'c'])
  })

  it('does not read devDependencies, which is the rule this gate exists for', () => {
    expect([...shippedDeclarations({ devDependencies: { a: '1' } })]).toStrictEqual([])
  })
})

describe('undeclaredImports', () => {
  it('reports a runtime import the manifest does not declare', () => {
    const root = workspace(
      { name: NAME },
      { 'index.ts': "import { thing } from '@deepseek-ai/schemastery'\nexport const used = thing\n" },
    )
    expect(undeclaredImports(root)).toStrictEqual([{
      pkg: NAME,
      missing: '@deepseek-ai/schemastery',
      file: 'packages/group/pkg/src/index.ts',
      line: 1,
    }])
  })

  it('is silent once the same import is declared — in any of the three shipped sections', () => {
    const source = { 'index.ts': "import { thing } from '@deepseek-ai/schemastery'\nexport const used = thing\n" }
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const root = workspace({ name: NAME, [section]: { '@deepseek-ai/schemastery': 'workspace:^' } }, source)
      expect(undeclaredImports(root), section).toStrictEqual([])
    }
  })

  it('still reports it when only devDependencies declares it, because that section does not ship', () => {
    const root = workspace(
      { name: NAME, devDependencies: { '@deepseek-ai/schemastery': 'workspace:^' } },
      { 'index.ts': "import { thing } from '@deepseek-ai/schemastery'\nexport const used = thing\n" },
    )
    expect(undeclaredImports(root)).toHaveLength(1)
  })

  it('ignores a type-only import, which is erased and needs no declaration', () => {
    const root = workspace(
      { name: NAME },
      { 'index.ts': "import type { Thing } from '@deepseek-ai/schemastery'\nexport type Alias = Thing\n" },
    )
    expect(undeclaredImports(root)).toStrictEqual([])
  })

  it('ignores relative and builtin specifiers', () => {
    const root = workspace(
      { name: NAME },
      {
        'index.ts': "import { readFileSync } from 'node:fs'\nimport { local } from './local.ts'\nexport const used = [readFileSync, local]\n",
        'local.ts': 'export const local = 1\n',
      },
    )
    expect(undeclaredImports(root)).toStrictEqual([])
  })

  it('ignores a package importing itself by name through its own exports map', () => {
    const root = workspace(
      { name: NAME },
      { 'index.ts': `import { other } from '${NAME}/other'\nexport const used = other\n` },
    )
    expect(undeclaredImports(root)).toStrictEqual([])
  })

  it('reports one violation per package per file, not one per imported export', () => {
    const root = workspace(
      { name: NAME },
      { 'index.ts': "import { a, b, c } from '@deepseek-ai/schemastery'\nexport const used = [a, b, c]\n" },
    )
    expect(undeclaredImports(root)).toHaveLength(1)
  })

  it('skips Client-face sources, whose bundler alias is the resolution contract', () => {
    const root = mkdtempSync(join(tmpdir(), 'import-integrity-'))
    roots.push(root)
    const dir = join(root, 'packages', 'client', 'ui-chat')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-chat' }, null, 2)}\n`)
    writeFileSync(join(dir, 'src', 'index.ts'), "import { store } from '@deepseek-ai/dsh-client-store'\nexport const used = store\n")
    expect(undeclaredImports(root)).toStrictEqual([])
  })
})
