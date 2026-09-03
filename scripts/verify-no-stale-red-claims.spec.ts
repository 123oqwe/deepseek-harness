/**
 * Rejects package documentation that still describes landed, working code as an
 * unimplemented RED scaffold.
 *
 * The First-100 program lands each epic stage as a RED commit (real signatures,
 * `'not implemented: ...'` bodies, real failing assertions) followed by a GREEN
 * commit that implements them. The RED commit writes the README, and the GREEN
 * commit changes only code — so the "every decision function throws" sentence
 * survives into a package whose functions all work. Three packages were caught
 * this way in one day, each by a different reader who had to run the suite to
 * find out the documentation was lying.
 *
 * The check is static and needs no test run: a package whose prose claims its
 * exports are unimplemented must actually contain an unimplemented body. When
 * the last `not implemented` throw leaves `src/`, the prose describing it must
 * go in the same change.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(REPO, 'packages')

/**
 * Prose that asserts this package's own exports are unimplemented placeholders.
 *
 * Deliberately narrow. A bare "not implemented" is legitimate and common in a
 * `## Known Limitations` line describing a feature the package does not offer
 * ("Windows ACL inheritance is not implemented"), which is a true statement
 * about scope, not a false statement about the code being a placeholder. Only
 * the First-100 RED-scaffold idiom is matched, because only it claims that the
 * exports named right beside it do not work.
 */
const STALE_CLAIM_PATTERNS = [
  /RED[- ]scaffold/iu,
  /currently failing/iu,
  /currently RED\b/iu,
  /unimplemented stubs?/iu,
  /throws? `?'not implemented/iu,
]

/**
 * Every file under a directory, recursively, skipping build output.
 * @param root - directory to walk.
 * @returns absolute paths of every regular file found.
 */
function walk(root: string): string[] {
  const found: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    // A package group without the directory this walk was asked for is not an
    // error here; the caller only wants files that exist.
    return found
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'lib' || entry === 'dist') continue
    const path = join(root, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

/**
 * Every package directory, as `packages/<group>/<pkg>`.
 * @returns absolute paths of each package directory holding a package.json.
 */
function packageDirectories(): string[] {
  const directories: string[] = []
  for (const group of readdirSync(PACKAGES)) {
    const groupPath = join(PACKAGES, group)
    if (!statSync(groupPath).isDirectory()) continue
    for (const name of readdirSync(groupPath)) {
      const path = join(groupPath, name)
      if (statSync(path).isDirectory() && walk(path).some(file => file.endsWith('package.json'))) {
        directories.push(path)
      }
    }
  }
  return directories
}

/**
 * Whether a package's own `src/` still contains an unimplemented body, which is
 * what makes an unimplemented-code claim true.
 * @param packageDirectory - the package to inspect.
 * @returns true when some source file throws or returns a `not implemented` marker.
 */
function hasUnimplementedSource(packageDirectory: string): boolean {
  return walk(join(packageDirectory, 'src')).some(
    file => file.endsWith('.ts') && /not implemented/u.test(readFileSync(file, 'utf8')),
  )
}

describe('package documentation does not describe landed code as an unimplemented scaffold', () => {
  const directories = packageDirectories()

  it('finds package directories to check', () => {
    expect(directories.length).toBeGreaterThan(0)
  })

  for (const packageDirectory of directories) {
    const label = relative(REPO, packageDirectory)
    const documents = walk(packageDirectory).filter(
      file => file.endsWith('.md') || file.endsWith('.spec.ts') || join(packageDirectory, 'src') === dirname(file),
    )

    it(`${label}: prose claiming unimplemented code matches an actually unimplemented source`, () => {
      if (hasUnimplementedSource(packageDirectory)) return

      const offenders: string[] = []
      for (const document of documents) {
        const text = readFileSync(document, 'utf8')
        for (const pattern of STALE_CLAIM_PATTERNS) {
          const match = pattern.exec(text)
          if (match !== null) {
            offenders.push(`${relative(REPO, document)}: ${JSON.stringify(match[0])}`)
            break
          }
        }
      }

      expect(
        offenders,
        `${label} has no "not implemented" body left in src/, so its code works — but this prose still says otherwise. ` +
          `Update the prose in the same change that implements the code:\n  ${offenders.join('\n  ')}`,
      ).toEqual([])
    })
  }
})
