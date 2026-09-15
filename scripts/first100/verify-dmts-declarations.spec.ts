/**
 * Controls for verify-dmts-declarations, on fixture directories rather than the live tree: a spec
 * asserting the live tree has no gap could never be seen to fail once the tree is clean.
 */
import { describe, expect, it } from 'vitest'

import { dmtsDeclarationGaps, dmtsExitCode } from './verify-dmts-declarations.mjs'

const dir = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries))
const module = 'export function alpha() {}\nexport const beta = () => 1\n'
const importer = "import { alpha, beta } from './lib.mjs'\n"

describe('dmtsDeclarationGaps', () => {
  it('finds the module and its imported bindings at all, so an empty result is not a scan that looked at nothing', () => {
    const result = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'lib.d.mts': 'export function alpha(): void\nexport const beta: () => number\n', 'user.mjs': importer }))
    expect(result.imported).toBe(2)
    expect(dmtsExitCode(result)).toBe(0)
  })

  it('reports an imported export absent from the .d.mts, and exits 1', () => {
    const result = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'lib.d.mts': 'export function alpha(): void\n', 'user.spec.ts': importer }))
    expect(result.gaps).toStrictEqual([{ module: 'lib.mjs', name: 'beta', users: ['user.spec.ts'], declarationFile: 'lib.d.mts' }])
    expect(dmtsExitCode(result)).toBe(1)
  })

  it('reports every imported export of a module that has no .d.mts at all', () => {
    const result = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'user.mjs': importer }))
    expect(result.gaps.map(g => [g.name, g.declarationFile])).toStrictEqual([['alpha', undefined], ['beta', undefined]])
  })

  it('does not count a name that appears only in a comment of the .d.mts', () => {
    const result = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'lib.d.mts': 'export function alpha(): void\n/** beta is declared elsewhere */\n// beta\n', 'user.mjs': importer }))
    expect(result.gaps.map(g => g.name)).toStrictEqual(['beta'])
  })

  it('checks a type-only import against the .d.mts alone, since a .mjs module cannot export a type', () => {
    const typed = "import type { Shape } from './lib.mjs'\nimport { alpha, beta } from './lib.mjs'\n"
    const declared = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'lib.d.mts': 'export function alpha(): void\nexport const beta: () => number\nexport interface Shape { a: number }\n', 'user.ts': typed }))
    expect([declared.gaps, declared.phantoms]).toStrictEqual([[], []])
    const inline = dmtsDeclarationGaps(dir({ 'lib.mjs': module, 'lib.d.mts': 'export function alpha(): void\nexport const beta: () => number\n', 'user.ts': "import { alpha, beta, type Shape } from './lib.mjs'\n" }))
    expect(inline.phantoms).toStrictEqual([])
    expect(inline.gaps).toStrictEqual([{ module: 'lib.mjs', name: 'Shape', users: ['user.ts'], declarationFile: 'lib.d.mts' }])
  })

  it('reports an import of a name the module does not export', () => {
    const result = dmtsDeclarationGaps(dir({ 'lib.mjs': 'export function alpha() {}\n', 'lib.d.mts': 'export function alpha(): void\n', 'user.mjs': importer }))
    expect(result.phantoms).toStrictEqual([{ module: 'lib.mjs', name: 'beta', users: ['user.mjs'] }])
    expect(dmtsExitCode(result)).toBe(1)
  })

  it('exits 2 for a module with importers whose exports it cannot read, and 1 when a gap exists as well', () => {
    const unreadable = dmtsDeclarationGaps(dir({ 'lib.mjs': "export * from './other.mjs'\n", 'user.mjs': importer }))
    expect(unreadable.unparsed).toStrictEqual([{ module: 'lib.mjs', users: ['user.mjs'] }])
    expect(dmtsExitCode(unreadable)).toBe(2)
    const both = dmtsDeclarationGaps(dir({ 'lib.mjs': "export * from './other.mjs'\n", 'user.mjs': importer, 'two.mjs': module, 'x.mjs': "import { alpha } from './two.mjs'\n" }))
    expect(dmtsExitCode(both)).toBe(1)
  })
})
