/**
 * Refuse a build artifact tracked inside a package's `src/`.
 *
 * The repository's rule is "source plane vs artifact plane, never mixed", and
 * until 2026-09-06 nothing enforced it. It cost two blockers on one day.
 *
 * `packages/policy/capability-token/src/` held twelve emitted files that nothing
 * resolved — found only because the registry gate set ran in CI for the first
 * time. Hours later `packages/action/action-manifest/src/canonicalize.js` turned
 * out to be the cause of BLOCKED-077: it carried the SUPERSEDED recursive
 * implementation, the module resolver ran it instead of the iterative `.ts`
 * beside it, and hashing a deep value overflowed the stack. A round of
 * investigation had already excluded that function by reading `src/` and `lib/`
 * — both iterative, both correct, and neither one the code that ran.
 *
 * **A stale artifact does not merely duplicate its source; it can silently
 * replace it.** That is what makes this worth a gate rather than a cleanup.
 *
 * **What counts as an artifact.** A `.js`, `.d.ts`, `.js.map` or `.d.ts.map`
 * under `src/` that has a `.ts` or `.tsx` sibling of the same base name.
 * Hand-written ambient declarations — `ripgrep.d.ts`, `turndown-plugin-gfm.d.ts`,
 * `css-modules.d.ts` — have no such sibling and are real source, so the sibling
 * test is what separates them rather than a name list that would need
 * maintaining.
 *
 * Usage: `pnpm run verify-no-artifacts-in-src`
 *
 * @module scripts/verify-no-artifacts-in-src
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The emitted extensions a TypeScript build can leave beside its input. */
const EMITTED = ['.d.ts.map', '.d.ts', '.js.map', '.js'] as const

/**
 * The base name an emitted file would have been produced from, or `undefined`
 * when the path is not an emitted shape at all.
 * @param path - a repository-relative path.
 * @returns the base path without its emitted extension.
 */
export function emittedBase(path: string): string | undefined {
  for (const extension of EMITTED) {
    if (path.endsWith(extension)) return path.slice(0, -extension.length)
  }
  return undefined
}

/**
 * Every tracked file under a package `src/` that is an emitted copy of a source
 * file sitting beside it.
 * @returns the offending repository-relative paths.
 */
function trackedArtifactsInSrc(): string[] {
  const tracked = execFileSync('git', ['ls-files', 'packages/*/*/src/*', 'packages/*/*/src/**/*'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\n').filter(Boolean)

  const offenders: string[] = []
  for (const path of tracked) {
    const base = emittedBase(path)
    if (base === undefined) continue
    // The sibling test, not a name list: a declaration written by hand has no
    // `.ts` to have been emitted from, and is source like any other file.
    if (existsSync(join(REPO_ROOT, `${base}.ts`)) || existsSync(join(REPO_ROOT, `${base}.tsx`))) {
      offenders.push(path)
    }
  }
  return offenders
}

function main(): void {
  const offenders = trackedArtifactsInSrc()
  if (offenders.length === 0) {
    console.log('verify-no-artifacts-in-src: no build artifact is tracked beside its source.')
    return
  }
  console.error(
    `verify-no-artifacts-in-src: ${String(offenders.length)} build artifact(s) tracked inside a package src/. `
    + 'These do not merely duplicate their sources — the module resolver can prefer them, so a stale copy '
    + 'silently replaces the code you are reading (BLOCKED-077). Delete them and add the emit path to .gitignore:',
  )
  for (const path of offenders) console.error(`  ${path}`)
  process.exit(1)
}

main()
