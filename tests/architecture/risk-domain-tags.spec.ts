/**
 * Every shipped tool declares what its call touches (Epic P2-04 must[1],
 * §12.48-B(c)).
 *
 * **A structural gate, not a sample.** The classifier's unknown default is the
 * highest policy-adjustable class, so a tool that declares no `riskDomainTags`
 * is not treated leniently — it is treated as the most restricted thing the
 * deployment can ask about. That is the right failure direction and the wrong
 * steady state: if omission stayed normal, every action would classify
 * identically and the taxonomy would carry no information at all.
 *
 * So this enumerates the tool packages the shipped bundles actually mount and
 * requires each `defineTool(...)` in them to carry tags. The set is derived
 * from `packages/bundle/<*>/cordis.patch.yml` rather than listed here, so a
 * tool added to a bundle is covered the moment it is mounted, and one removed
 * stops being required — a hand-kept list would drift from what ships, which
 * is the failure this gate exists to prevent.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Every `@deepseek-ai/dsh-tool-*` package name a shipped bundle mounts. */
function shippedToolPackages(): readonly string[] {
  const bundles = execFileSync('git', ['ls-files', 'packages/bundle/*/cordis.patch.yml'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(line => line.length > 0)
  const names = new Set<string>()
  for (const bundle of bundles) {
    for (const match of readFileSync(join(root, bundle), 'utf8').matchAll(/@deepseek-ai\/dsh-(tool-[a-z0-9-]+)/gu)) {
      names.add(match[1] as string)
    }
  }
  // Not a tool: a `tools/execute` wrapper that enforces the timeout budget and
  // registers nothing a model can call.
  names.delete('tool-call-timeout-policy')
  return [...names].sort()
}

/** Source files of one tool package, by workspace path. */
function sourcesOf(pkg: string): readonly string[] {
  return execFileSync('git', ['ls-files', `packages/*/${pkg}/src/*.ts`], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(line => line.endsWith('.ts'))
}

/**
 * Each `defineTool({...})` call in a file, as the text between its braces.
 *
 * Textual rather than parsed: the property this gate checks is whether the
 * literal declares a field, and a definition assembled dynamically would not
 * be readable by any static check anyway — which is itself worth failing on.
 */
function defineToolBlocks(source: string): readonly string[] {
  const blocks: string[] = []
  for (const match of source.matchAll(/defineTool\(\{/gu)) {
    const start = (match.index ?? 0) + match[0].length
    let depth = 1
    let index = start
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      index += 1
    }
    blocks.push(source.slice(start, index))
  }
  return blocks
}

describe('P2-04 must[1]: every shipped tool declares its risk domain tags', () => {
  it('finds the shipped tool packages from the bundles, so the set cannot drift from what ships', () => {
    const shipped = shippedToolPackages()
    // A guard on the guard: if the derivation broke, an empty set would make
    // the gate below pass while checking nothing.
    expect(shipped.length).toBeGreaterThan(10)
    expect(shipped).toContain('tool-bash')
    expect(shipped).toContain('tool-fs')
  })

  it('leaves NO shipped tool undeclared, because an undeclared tool classifies by the unknown default', () => {
    const undeclared: string[] = []
    for (const pkg of shippedToolPackages()) {
      for (const file of sourcesOf(pkg)) {
        const source = readFileSync(join(root, file), 'utf8')
        for (const block of defineToolBlocks(source)) {
          const name = /name:\s*'([^']+)'/u.exec(block)?.[1] ?? '(unnamed)'
          if (!/\briskDomainTags\s*:/u.test(block)) undeclared.push(`${file}: ${name}`)
        }
      }
    }
    expect(undeclared).toEqual([])
  })
})
