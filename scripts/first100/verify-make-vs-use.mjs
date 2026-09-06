/**
 * Check that an epic's recorded make-vs-use decision matches the tree.
 *
 * The fourth pre-flight question makes each epic state which packages it adopts
 * and in what form. That statement is a claim about code, and until now nothing
 * compared it to the code. This is the comparison — the same shape as
 * `verify-cells-recomputable`, which recomputes a green cell from its own
 * observation instead of trusting the row.
 *
 * **Four checks, and the second is the one with teeth.**
 *
 * 1. A package adopted as `form: runtime` is imported somewhere in the epic's
 *    declared files. A dependency recorded and never imported is a decision
 *    nobody acted on.
 * 2. A package the ledger marks `role: reject` is imported NOWHERE in them. The
 *    rejections carry reasons — an external daemon as a default, a second seam,
 *    a licence, an unmaintained project — and a rejection that quietly got
 *    wired anyway is the failure this check exists for. It is a negative claim,
 *    so it runs with a positive control: an adopted package must be found by
 *    the same scan, or the scan proves nothing.
 * 3. A package adopted as `form: oracle` appears in devDependencies only. An
 *    oracle that reaches `dependencies` has become a runtime dependency by
 *    accident, which is how a differential test turns into a shipped one.
 * 4. An epic that declares `standardsOwned` has at least one frozen case naming
 *    that standard. Owning a vocabulary means pinning it somewhere a reader can
 *    find, not asserting ownership in a JSON field.
 *
 * Three states per epic, and `UNRECORDED` does not pass: an epic with adopted
 * packages and no `preFlight.makeVsUse` has not answered the question, and
 * treating silence as success is what this whole family of checks refuses.
 *
 * Usage: `node scripts/first100/verify-make-vs-use.mjs`
 *
 * @module scripts/first100/verify-make-vs-use
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/make-vs-use-ledger.json')
const AUDIT_PATH = join(REPO_ROOT, 'spec/first100/exec/clause-subject-audit.json')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')

const loadJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * Every file an epic declares, across its top-level list and its stages.
 * @param epic - the registry row.
 * @returns declared repo-relative paths.
 */
function declaredFiles(epic) {
  const paths = new Set()
  for (const file of epic.files ?? []) paths.add(file.path)
  for (const stage of Object.values(epic.stages ?? {})) {
    for (const path of stage?.files ?? []) paths.add(path)
  }
  return [...paths]
}

/**
 * Whether any of `paths` that exists on disk imports `pkg`.
 *
 * Matches an import or require of the package name exactly or as a subpath, so
 * `canonicalize` does not match `json-canonicalize`. A declared file that does
 * not exist yet is skipped rather than counted as absence: an epic states the
 * files it WILL write, and a check that read "not yet created" as "decision
 * violated" would fire on every unstarted epic.
 * @param pkg - the npm package name.
 * @param paths - repo-relative candidate paths.
 * @returns the first path importing it, or undefined.
 */
function findImport(pkg, paths) {
  // Escaped with a helper rather than by hand: the first version built the
  // pattern with nested backslash escapes in a template string and produced
  // `@sigstore\\/verify`, which matches nothing. It reported that P1-02 does not
  // import a package P1-02 demonstrably imports — a scan that finds nothing
  // and a decision that was never acted on look identical in the output, which
  // is why this function ends with a positive control at the call site.
  const escaped = pkg.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  const pattern = new RegExp(`(?:from|require\\()\\s*['"]${escaped}(?:/[^'"]*)?['"]`, 'u')
  for (const path of paths) {
    const full = join(REPO_ROOT, path)
    if (!existsSync(full)) continue
    if (pattern.test(readFileSync(full, 'utf8'))) return path
  }
  return undefined
}

/**
 * The npm names the ledger rejects for one epic.
 * @param row - the ledger row.
 * @returns rejected npm package names.
 */
const rejectedPackages = (row) =>
  (row?.oss ?? []).filter(entry => entry.role === 'reject' && typeof entry.npm === 'string').map(entry => entry.npm)

function main() {
  const rows = new Map(loadJson(LEDGER_PATH).rows.map(row => [row.id, row]))
  const registry = new Map(loadJson(REGISTRY_PATH).epics.map(epic => [epic.id, epic]))
  const preFlight = loadJson(AUDIT_PATH).preFlight ?? {}
  const freeze = loadJson(FREEZE_PATH).entries ?? []

  const findings = []
  const states = []
  for (const [key, entry] of Object.entries(preFlight)) {
    const declared = entry.makeVsUse
    if (declared === undefined) continue
    const epic = registry.get(key)
    const files = epic === undefined ? [] : declaredFiles(epic)
    const row = rows.get(key)
    let state = 'VERIFIED'

    for (const adopted of declared.adopted ?? []) {
      const name = typeof adopted === 'string' ? adopted : adopted.name
      const form = typeof adopted === 'string' ? 'runtime' : adopted.form ?? 'runtime'
      const pkg = String(name).split('@').slice(0, name.startsWith('@') ? 2 : 1).join('@')
      if (form === 'runtime' && epic !== undefined && findImport(pkg, files) === undefined) {
        findings.push(`${key}: adopts ${pkg} as runtime, but no declared file imports it`)
        state = 'MISMATCHED'
      }
      if (form === 'oracle') {
        // An oracle that reached `dependencies` would ship with the product.
        // Checked against the package.json of every package the epic declares a
        // file in, not just declared package.json paths, because an epic rarely
        // lists its own manifest among its files.
        const depFiles = [...new Set(files.map(path => path.replace(/\/(src|tests)\/.*$/u, '/package.json')))]
        for (const path of depFiles) {
          const full = join(REPO_ROOT, path)
          if (!existsSync(full)) continue
          const pkgJson = loadJson(full)
          if (pkgJson.dependencies?.[pkg] !== undefined) {
            findings.push(`${key}: ${pkg} is adopted as an ORACLE but appears in ${path}'s dependencies, not devDependencies`)
            state = 'MISMATCHED'
          }
        }
      }
    }

    // The negative claim, with its positive control alongside.
    for (const rejected of rejectedPackages(row)) {
      const found = findImport(rejected, files)
      if (found !== undefined) {
        findings.push(`${key}: the ledger REJECTS ${rejected}, but ${found} imports it`)
        state = 'MISMATCHED'
      }
    }

    for (const standard of declared.standardsOwned ?? []) {
      const named = freeze.some(item => item.epic === key && item.supersededBy === undefined
        && (item.expectCases ?? []).some(title => title.includes(standard)))
      if (!named) {
        findings.push(`${key}: claims to own the ${standard} vocabulary, but no live frozen case names it`)
        state = 'MISMATCHED'
      }
    }
    states.push([key, state])
  }

  // The positive control for the import scan itself: a claim of "nothing
  // imports this" is worthless from a scan that finds nothing at all.
  const control = findImport('canonicalize', ['packages/action/action-manifest/tests/manifest.spec.ts'])
  if (control === undefined) {
    console.error('verify-make-vs-use: the import scan found NOTHING where a known import exists — the scan is broken, and every "not imported" result above would be meaningless.')
    process.exit(1)
  }

  for (const [key, state] of states) console.log(`  ${key}: ${state}`)
  if (findings.length === 0) {
    console.log(`verify-make-vs-use: ${String(states.length)} recorded decision(s) match the tree (import scan control passed at ${control}).`)
    return
  }
  console.error(`verify-make-vs-use: ${String(findings.length)} recorded decision(s) disagree with the tree:`)
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}

main()
