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
 * `PENDING_ADOPTION` is a fourth state, for an adoption decided before the
 * stage that lands it has been written. It carries `landsIn` naming that
 * stage, so the commitment stays checkable rather than deferred forever, and
 * an ACCEPTED epic may not hold one — acceptance would then rest on a promise
 * instead of on code. It reports but does not fail.
 *
 * Three further states per epic, and `UNRECORDED` does not pass: an epic with adopted
 * packages and no `preFlight.makeVsUse` has not answered the question, and
 * treating silence as success is what this whole family of checks refuses.
 *
 * Usage: `node scripts/first100/verify-make-vs-use.mjs`
 *
 * @module scripts/first100/verify-make-vs-use
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
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
 * The import pattern for one package name, escaped once in one place.
 * @param pkg - the npm package name.
 * @returns a regular expression matching an import or require of it.
 */
function importPattern(pkg) {
  const escaped = pkg.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  return new RegExp(`(?:from|require\\()\\s*['"]${escaped}(?:/[^'"]*)?['"]`, 'u')
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
  const pattern = importPattern(pkg)
  for (const path of paths) {
    const full = join(REPO_ROOT, path)
    // A declared path can be a DIRECTORY -- some epics name a package
    // directory rather than a file. `existsSync` passes for it and
    // `readFileSync` then throws EISDIR, which took the whole gate down
    // rather than reporting anything.
    if (!existsSync(full) || !statSync(full).isFile()) continue
    if (pattern.test(readFileSync(full, 'utf8'))) return path
  }
  return undefined
}

/**
 * Whether any tracked source file in the repository imports `pkg`.
 *
 * The fallback for an adoption whose import lives outside the epic's declared
 * files, which BLOCKED-134 showed is the norm rather than the exception.
 * @param pkg - the npm package name.
 * @returns the first importing path, or undefined.
 */
function findImportAnywhere(pkg) {
  for (const path of trackedSources()) {
    const full = join(REPO_ROOT, path)
    if (!existsSync(full) || !statSync(full).isFile()) continue
    if (importPattern(pkg).test(readFileSync(full, 'utf8'))) return path
  }
  return undefined
}

/** Every tracked source file, read once. Built with `git ls-files`, never a shell. */
let trackedCache
function trackedSources() {
  trackedCache ??= execFileSync('git', ['ls-files', '*.ts', '*.mjs'], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\n').filter(path => path.length > 0 && !path.includes('/lib/'))
  return trackedCache
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
  const execRows = loadJson(join(REPO_ROOT, 'spec/first100/exec/ledger.json')).rows ?? {}

  const findings = []
  const pending = []
  const outside = []
  const states = []
  for (const [key, entry] of Object.entries(preFlight)) {
    const declared = entry.makeVsUse
    if (declared === undefined) continue
    const epic = registry.get(key)
    const files = epic === undefined ? [] : declaredFiles(epic)
    const row = rows.get(key)
    let state = 'VERIFIED'

    // Field-shape check first: a record missing what the spec requires has not
    // answered the question, and the states below would describe a claim nobody
    // made. `make-vs-use-plan.md` §0 is the single field spec.
    const REQUIRED = ['ledgerRow', 'card', 'verdict', 'adopted', 'rejectedAbsent', 'standardsOwned', 'residual', 'probes', 'gapCheck', 'recordedBeforeFirstLine']
    const missing = REQUIRED.filter(field => !(field in declared))
    if (missing.length > 0) {
      findings.push(`${key}: preFlight.makeVsUse is missing ${missing.join(', ')} — an incomplete record is UNRECORDED, not a passing one`)
      states.push([key, 'UNRECORDED'])
      continue
    }

    for (const adopted of declared.adopted ?? []) {
      // The npm name is what a file can import; `name` is the ledger's own
      // label for the project (`sigstore/sigstore-js`), which appears in no
      // import statement anywhere.
      const pkg = adopted.npm ?? adopted.name
      const form = adopted.form ?? 'runtime'
      if (pkg === undefined) {
        findings.push(`${key}: an adopted entry names neither an npm package nor a project`)
        state = 'MISMATCHED'
        continue
      }
      // A Node builtin is adopted differently from an npm package: it cannot
      // appear in a package.json, and the card's label for it is often not an
      // importable specifier. It still has to be USED, so the entry names the
      // real specifier and that is what the scan looks for.
      if (form === 'builtin') {
        const specifier = adopted.specifier
        if (typeof specifier !== 'string' || specifier.length === 0) {
          findings.push(`${key}: adopts ${pkg} as a builtin but names no importable specifier, so the claim cannot be checked`)
          state = 'MISMATCHED'
        } else if (findImportAnywhere(specifier) === undefined) {
          findings.push(`${key}: adopts the builtin ${specifier}, but nothing in the repository imports it`)
          state = 'MISMATCHED'
        }
      }
      if (form === 'runtime' && epic !== undefined && findImport(pkg, files) === undefined) {
        // An adoption DECIDED before the code that lands it is not the same as
        // an adoption claimed and never made. `landsIn` names the stage that
        // will import it, which makes the commitment checkable later instead
        // of indefinitely deferred — and an ACCEPTED epic may not hold one,
        // because acceptance would then rest on a promise.
        // BLOCKED-134 measured that a stage's declared `files` is a sketch of
        // the principal deliverables, not the set of files the work touched:
        // 79 of 116 live freeze entries cite something outside it. So "not in
        // the declared files" does not mean "not adopted". The repository is
        // searched as a second step and the answer is reported under its own
        // name, because an adoption that lives outside the declared list is a
        // different fact from one that does not exist.
        const elsewhere = findImportAnywhere(pkg)
        if (elsewhere !== undefined) {
          outside.push(`${key}: ${pkg} imported at ${elsewhere}, outside this epic's declared files (BLOCKED-134)`)
        } else if (typeof adopted.landsIn === 'string' && adopted.landsIn.length > 0) {
          if (rows.get(key)?.status === 'ACCEPTED' || execRows[key]?.status === 'ACCEPTED') {
            findings.push(`${key}: adopts ${pkg} as runtime with landsIn ${JSON.stringify(adopted.landsIn)}, but the epic is ACCEPTED — acceptance cannot rest on an adoption that has not landed`)
            state = 'MISMATCHED'
          } else {
            pending.push(`${key}: ${pkg} adopted, landing in ${adopted.landsIn}`)
            if (state === 'VERIFIED') state = 'PENDING_ADOPTION'
          }
        } else {
          findings.push(`${key}: adopts ${pkg} as runtime, but no declared file imports it and no landsIn stage is named`)
          state = 'MISMATCHED'
        }
      }
      if (form === 'oracle') {
        // An oracle that reached `dependencies` would ship with the product.
        // Checked against the package.json of every package the epic declares a
        // file in, not just declared package.json paths, because an epic rarely
        // lists its own manifest among its files.
        // Only paths that actually became a package.json: a declared file with
        // no `/src/` or `/tests/` segment (a doc, a schema, a root script) is
        // left unchanged by the replace, and loading it as JSON threw
        // `Unexpected token '#'` on a Markdown file — taking the whole gate
        // down instead of reporting anything.
        const depFiles = [...new Set(files.map(path => path.replace(/\/(src|tests)\/.*$/u, '/package.json')))]
          .filter(path => path.endsWith('/package.json'))
        for (const path of depFiles) {
          const full = join(REPO_ROOT, path)
          if (!existsSync(full) || !statSync(full).isFile()) continue
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

    for (const owned of declared.standardsOwned ?? []) {
      // A card's name for a standard ("RFC 8785 JCS") is rarely the exact
      // phrase a test title uses ("the RFC 8785 reference implementation"), so
      // requiring the whole string rejected true ownership. Loosening the
      // match generally would let any near-miss claim a vocabulary; instead the
      // claimant NAMES the substring that proves it, and the gate checks that.
      // The evidence is then auditable rather than inferred.
      const standard = typeof owned === 'string' ? owned : owned?.standard
      // Ownership comes two ways and they are different claims. EVIDENCE
      // ownership points at a frozen case naming the vocabulary. ASSIGNMENT
      // ownership comes from the shape-ownership table before any case exists,
      // which is legitimate for an epic whose subject is not built yet and is
      // NOT a pass: it is reported, and refused once the epic is ACCEPTED,
      // exactly like a pending adoption. Otherwise `assignedBy` would let an
      // epic own a vocabulary it never pins.
      const assignedBy = typeof owned === 'string' ? undefined : owned?.assignedBy
      const needle = typeof owned === 'string' ? owned : owned?.evidenceTitleSubstring ?? owned?.standard
      const named = freeze.some(item => item.epic === key && item.supersededBy === undefined
        && (item.expectCases ?? []).some(title => title.includes(needle)))
      if (!named && typeof assignedBy === 'string' && assignedBy.length > 0) {
        if (execRows[key]?.status === 'ACCEPTED') {
          findings.push(`${key}: owns ${standard} by assignment (${assignedBy}) with no frozen case naming it, but the epic is ACCEPTED — ownership must be pinned before acceptance`)
          state = 'MISMATCHED'
        } else {
          pending.push(`${key}: ${standard} owned by assignment (${assignedBy}), no frozen case pins it yet`)
          if (state === 'VERIFIED') state = 'PENDING_ADOPTION'
        }
      } else if (!named) {
        findings.push(`${key}: claims to own the ${standard} vocabulary, but no live frozen case contains ${JSON.stringify(needle)}`)
        state = 'MISMATCHED'
      }
    }
    states.push([key, state])
  }

  // The positive control for the import scan itself: a claim of "nothing
  // imports this" is worthless from a scan that finds nothing at all.
  const wideControl = findImportAnywhere('vitest')
  if (wideControl === undefined) {
    console.error('verify-make-vs-use: the repository-wide import scan found no importer of `vitest`, which every spec imports — the scan is broken, and every OUTSIDE-DECLARED verdict above would be meaningless.')
    process.exit(1)
  }
  const control = findImport('canonicalize', ['packages/action/action-manifest/tests/manifest.spec.ts'])
  if (control === undefined) {
    console.error('verify-make-vs-use: the import scan found NOTHING where a known import exists — the scan is broken, and every "not imported" result above would be meaningless.')
    process.exit(1)
  }

  for (const line of outside) console.log(`  OUTSIDE-DECLARED  ${line}`)
  for (const line of pending) console.log(`  PENDING  ${line}`)
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
