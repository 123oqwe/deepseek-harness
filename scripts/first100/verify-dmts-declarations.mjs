/**
 * Every export of a `scripts/first100/*.mjs` module that another file imports is
 * declared in that module's `.d.mts`.
 *
 * `tsconfig.host.json` includes the `.ts` files under `scripts/` and does not allow JS, so a
 * `.mjs` module enters the host program only through a `.ts` importer, and then
 * only its `.d.mts` describes it. An export that a `.mjs` file imports today is
 * therefore unchecked, and the first spec that imports it turns
 * `tsc -b tsconfig.host.json` red at a change that looks unrelated (4e31fecd39).
 * This reads source text only, so it answers in well under a second what the
 * typecheck answers late.
 *
 * Exit 0 when every imported export is declared, 1 when one is not or when a
 * file imports a name its module does not export, and 2 when a module with
 * importers yields no parseable export at all, which means this check could
 * not tell. A failure exits 1 even when another module also could not be read.
 *
 * Usage: `node scripts/first100/verify-dmts-declarations.mjs`
 *
 * @module scripts/first100/verify-dmts-declarations
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The names a module exports: `export function|const|let|class NAME` and `export { a, b as c }`.
 * @param text - the module source.
 * @returns the exported names.
 */
function exportsOf(text) {
  const names = new Set()
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gmu)) names.add(m[1])
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gmu)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/u).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

/**
 * A declaration file with its comments removed, so a name mentioned only in a comment does not read as declared.
 * @param text - the `.d.mts` source.
 * @returns the text without block or line comments.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/\/\/[^\n]*/gu, ' ')
}

/**
 * Declaration gaps across one directory's files.
 *
 * Pure over file texts, so the spec runs it on fixtures and the gate runs it on
 * the live directory. A name is imported when a `.mjs`, `.ts` or `.mts` file names
 * it in an `import { … }` or `import type { … }` from `./<module>.mjs`. A type-only
 * import (`import type`, or a `type` specifier) names a type, which a `.mjs` module
 * cannot export, so it is checked against the `.d.mts` alone.
 * @param files - file name -> text, for every file in the directory.
 * @returns `gaps` (imported, exported, not declared), `phantoms` (imported as a value, not exported), `unparsed` (modules with importers and no parseable export), each naming the users; and `imported`, the count of imported bindings.
 */
export function dmtsDeclarationGaps(files) {
  const gaps = []
  const phantoms = []
  const unparsed = []
  let imported = 0
  const importerNames = [...files.keys()].filter(name => /\.(mjs|ts|mts)$/u.test(name) && !name.endsWith('.d.mts'))
  for (const module of [...files.keys()].filter(name => name.endsWith('.mjs')).sort()) {
    const specifier = module.replace(/\.mjs$/u, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
    const pattern = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]\\./${specifier}\\.mjs['"]`, 'gu')
    const users = new Map()
    const valueNames = new Set()
    for (const importer of importerNames) {
      if (importer === module) continue
      for (const m of files.get(importer).matchAll(pattern)) {
        for (const part of m[1].split(',')) {
          const name = part.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u)[0].trim()
          if (!name) continue
          users.set(name, [...users.get(name) ?? [], importer])
          if (!/^import\s+type\b/u.test(m[0]) && !/^type\s/u.test(part.trim())) valueNames.add(name)
        }
      }
    }
    if (users.size === 0) continue
    imported += users.size
    const exported = exportsOf(files.get(module))
    const declarationName = module.replace(/\.mjs$/u, '.d.mts')
    const declarationText = files.has(declarationName) ? withoutComments(files.get(declarationName)) : undefined
    if (exported.size === 0) {
      unparsed.push({ module, users: [...new Set([...users.values()].flat())].sort() })
      continue
    }
    for (const [name, importers] of users) {
      if (!exported.has(name) && valueNames.has(name)) {
        phantoms.push({ module, name, users: importers.sort() })
      } else if (declarationText === undefined || !new RegExp(`\\b${name}\\b`, 'u').test(declarationText)) {
        gaps.push({ module, name, users: importers.sort(), declarationFile: declarationText === undefined ? undefined : declarationName })
      }
    }
  }
  return { gaps, phantoms, unparsed, imported }
}

/**
 * The exit code for one run: a missing declaration or phantom import decides the run, and an unreadable module only when nothing failed.
 * @param result - from {@link dmtsDeclarationGaps}.
 * @returns 1 when any gap or phantom exists, otherwise 2 when a module could not be parsed, otherwise 0.
 */
export function dmtsExitCode(result) {
  if (result.gaps.length > 0 || result.phantoms.length > 0) return 1
  if (result.unparsed.length > 0) return 2
  return 0
}

function main() {
  const files = new Map(readdirSync(HERE).filter(name => /\.(mjs|ts|mts)$/u.test(name)).map(name => [name, readFileSync(resolve(HERE, name), 'utf8')]))
  const result = dmtsDeclarationGaps(files)
  for (const g of result.gaps) console.error(`  NOT DECLARED  ${g.module} :: ${g.name}  (${g.declarationFile ?? 'no .d.mts'}; imported by ${g.users.join(', ')})`)
  for (const p of result.phantoms) console.error(`  NOT EXPORTED  ${p.module} :: ${p.name}  (imported by ${p.users.join(', ')})`)
  for (const u of result.unparsed) console.error(`  UNPARSED      ${u.module}: no export could be read, though ${u.users.join(', ')} import it`)
  const code = dmtsExitCode(result)
  if (code === 0) {
    console.log(`verify-dmts-declarations: every one of ${String(result.imported)} imported export binding(s) is declared in its module's .d.mts.`)
    return
  }
  console.error(code === 1
    ? `verify-dmts-declarations: ${String(result.gaps.length)} undeclared and ${String(result.phantoms.length)} unexported import(s); declare each export in the module's .d.mts, which is all the host typecheck can see of it.`
    : `verify-dmts-declarations: could not read the exports of ${String(result.unparsed.length)} module(s) that others import, so their declarations cannot be checked.`)
  process.exit(code)
}

// Only when run as a command; the spec imports the pure functions.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
