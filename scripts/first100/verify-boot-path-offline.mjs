/**
 * Refuse a network egress anywhere in the profile-boot dependency closure.
 *
 * P1-03's acceptance[0] asks that a production cold start work offline. Its own
 * lock row says why that holds today: the boot path is *"structurally
 * satisfied — every input is already-resolved data with no network path to
 * omit."*
 *
 * **That is a claim about structure, and a behavioural test cannot check it.**
 * Stubbing `globalThis.fetch` and asserting it was called zero times passes
 * against every possible implementation, including one that never implemented
 * a cache lookup and simply fails — because no code on the path can call
 * `fetch` at all. An assertion no implementation can violate is not evidence;
 * it reads as verified while verifying nothing.
 *
 * So the structure is checked directly, and this check CAN fail: it goes red
 * the day someone adds an HTTP client to a package in the closure, or writes
 * an egress call into one. That is the event acceptance[0] exists to prevent —
 * not "this run happened not to use the network", but "there is no path that
 * could".
 *
 * **What it does not claim.** It cannot show that a missing cache entry is
 * refused rather than fetched, because no such branch exists. Whoever words
 * acceptance[0]'s evidence must keep those apart: the cold start holds because
 * there is no network path, not because a fallback was exercised.
 *
 * Usage: `node scripts/first100/verify-boot-path-offline.mjs`
 *
 * @module scripts/first100/verify-boot-path-offline
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The packages the offline cold start rests on: profile composition and the
 * lock gate it consults. Named explicitly rather than derived from `apps/cli`,
 * whose own closure includes the LLM providers and is legitimately online.
 */
const BOOT_ROOTS = ['packages/boot/app-boot', 'packages/plugin/plugin-lock']

/**
 * Package names that perform HTTP. A dependency list is checked against this
 * because a client can be present without any source file naming a URL.
 */
const HTTP_CLIENTS = new Set([
  'undici', 'node-fetch', 'axios', 'got', 'ky', 'superagent', 'request',
  'cross-fetch', 'isomorphic-fetch', 'phin', 'needle', 'wretch',
])

/** Source spellings that reach the network directly. */
const EGRESS_PATTERNS = [
  /\bfetch\s*\(/u,
  /\bfrom\s+['"]node:https?['"]/u,
  /\brequire\s*\(\s*['"]node:https?['"]\s*\)/u,
  /\bfrom\s+['"]node:net['"]/u,
  /\bnew\s+WebSocket\s*\(/u,
]

/**
 * Resolve a workspace package name to its directory.
 * @param name - the `@deepseek-ai/dsh-*` package name.
 * @returns the repo-relative directory, or undefined when it is not a workspace package.
 */
function workspaceDir(name) {
  if (!name.startsWith('@deepseek-ai/dsh-')) return undefined
  const leaf = name.slice('@deepseek-ai/dsh-'.length)
  for (const group of readdirSync(join(REPO_ROOT, 'packages'))) {
    const candidate = join('packages', group, leaf)
    if (existsSync(join(REPO_ROOT, candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Every workspace package in the closure, plus every external dependency it pulls.
 * @returns the visited workspace directories and the external dependency names.
 */
function bootClosure() {
  const visited = new Map()
  const external = new Set()
  const queue = [...BOOT_ROOTS]
  while (queue.length > 0) {
    const dir = queue.shift()
    if (visited.has(dir)) continue
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'))
    visited.set(dir, manifest.name)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      // Cordis is vendored and peer-declared by every harness package; it is
      // part of the framework rather than a dependency this closure chose.
      if (dependency.startsWith('@deepseek-ai/cordis')) continue
      const child = workspaceDir(dependency)
      if (child === undefined) external.add(dependency)
      else queue.push(child)
    }
  }
  return { visited, external }
}

/**
 * Source files under a package's `src/`.
 * @param dir - the repo-relative package directory.
 * @returns repo-relative source paths.
 */
function sourceFiles(dir) {
  const root = join(REPO_ROOT, dir, 'src')
  if (!existsSync(root)) return []
  const found = []
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name.endsWith('.ts') && !item.name.endsWith('.d.ts')) found.push(full)
    }
  }
  walk(root)
  return found
}

function main() {
  const { visited, external } = bootClosure()
  const findings = []

  for (const name of external) {
    if (HTTP_CLIENTS.has(name)) findings.push(`the closure depends on ${name}, an HTTP client`)
  }

  for (const dir of visited.keys()) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of EGRESS_PATTERNS) {
        if (pattern.test(source)) {
          findings.push(`${file.slice(REPO_ROOT.length + 1)} contains a network egress matching ${String(pattern)}`)
          break
        }
      }
    }
  }

  // The positive control: a scan finding nothing is indistinguishable from a
  // broken scan, so the patterns are proved to match something before their
  // silence is reported as a result.
  const control = EGRESS_PATTERNS.some(pattern => pattern.test('const r = await fetch("https://example.invalid")'))
  if (!control) {
    console.error('verify-boot-path-offline: the egress patterns match nothing even in a known-positive sample — the scan is broken, and "no egress found" would mean nothing.')
    process.exit(1)
  }

  if (findings.length === 0) {
    console.log(
      `verify-boot-path-offline: ${String(visited.size)} package(s) in the profile-boot closure, `
      + `${String(external.size)} external dependency/dependencies (${[...external].sort().join(', ')}), no network egress.`,
    )
    return
  }
  console.error(
    'verify-boot-path-offline: the profile-boot closure can reach the network, so an offline cold start is no longer '
    + 'structurally guaranteed (P1-03 acceptance[0]):',
  )
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}

main()
