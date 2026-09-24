#!/usr/bin/env node
/**
 * BLOCKED-040 mechanical gate: every command-freeze.json frozen expectCases
 * title must either still be collected by its own frozen argv command
 * (a real `vitest run ... --reporter=json` execution, exactly the mechanism
 * generate-ledger.mjs's own cmdGreen/cmdSupplement trust), or have a
 * registered rename in frozen-title-renames.json mapping the old title to
 * the new one.
 *
 * Predicate (iii) in generate-ledger.mjs binds an ACCEPTED cell to the
 * frozen observation report, not to live-tree resolvability -- a later
 * stage renaming an it()/test() title an earlier, already-frozen stage
 * depended on does not invalidate that earlier ACCEPTED cell. But nothing
 * mechanically detected that drift class before BLOCKED-040: P0-05's P-stage
 * work (commit e39d97ad64ab1508094a66b2e67b758e020e1f25) renamed a title
 * P0-05.C's own frozen command-freeze.json entry depends on, and it was
 * found by chance, not by any gate. This script is that gate, run on demand
 * (not wired into slice-gate, matching verify-baseline-file-references.mjs's
 * precedent) against the live working tree.
 *
 * A real `vitest run --reporter=json` execution is required, not a static
 * grep of the target file(s): a materially large fraction of this
 * codebase's frozen titles come from `it.each`/`test.each` printf-style
 * templates (e.g. `it.each([...])('rejects an invalid first version %j', ...)`)
 * whose expanded title text (`rejects an invalid first version {"major":0...}`)
 * exists only at runtime, never as source text. Matching against each
 * assertion's real `title` and `fullName` (vitest's own
 * `ancestorTitles.join(' ') + ' ' + title`) is the same mechanism
 * generate-ledger.mjs's parseVitestJsonReport already trusts, so this gate
 * reuses that definition rather than inventing a second one.
 *
 * Entries with byte-identical argv run once and share the result -- most
 * command-freeze.json entries share a target with a sibling stage.
 *
 * CLI:
 *   node scripts/first100/verify-frozen-titles-resolvable.mjs
 *     [--report <path>]        write full JSON findings to this path
 *     [--from-report <path>]   resolve titles from a full-suite vitest report bound to
 *                              this tree instead of running each command (see below)
 *
 * **Report mode.** With `--from-report`, a command's titles come from the files its
 * path filters select in a full-suite `--reporter=json` report instead of a run. The
 * report binds only when its directory name carries a commit that is HEAD or an
 * ancestor of it, it records no failed suite, and every file in it has cases;
 * otherwise every command runs. A bound report still sends a command to a real run
 * when a test file it selects in this tree is missing from the report, when a unit
 * of a selected file (`packages/<group>/<package>`, `apps/<app>`, `tests/<dir>`,
 * `scripts/<dir>`) changed since that commit, uncommitted changes included, or when
 * a shared test input changed. It then proves something narrower than a run: the
 * names CI emitted at that commit, with every change since confined to units no
 * selected file belongs to. Names generated from another unit's data, and cases a
 * file defines on one platform only, can differ, so the final gate set before a
 * push runs without this flag.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const RENAMES_PATH = join(REPO_ROOT, 'spec/first100/exec/frozen-title-renames.json')

const cliArgs = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = cliArgs.indexOf(`--${name}`)
  return i >= 0 && cliArgs[i + 1] !== undefined ? cliArgs[i + 1] : fallback
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Runs a frozen entry's own argv and collects every assertion's title/fullName,
 * any status.
 *
 * **The report is written to a FILE and read from disk (§12.56).** Collecting
 * it from stdout meant buffering every run's whole JSON in this process, and
 * with one entry's report reaching megabytes the gate stopped completing at
 * all: measured, it died mid-gate at 216 freeze entries after passing at 209.
 * The cost grew with the freeze file, which grows every working day, so the
 * gate was on a path to failing for a reason that has nothing to do with what
 * it checks.
 *
 * What it checks is unchanged. `--outputFile` is vitest's own flag for the
 * same reporter, the run stays sequential (a shared host makes parallel runs
 * a source of load-dependent reds, §12.35), and the caller's `runCache` still
 * collapses the 216 entries onto their 133 unique commands.
 *
 * An argv frozen as a config and its files names no reporter (P4-05.U.4), and
 * vitest writes `--outputFile` only for a reporter that produces a file, so the
 * run gets `--reporter=json` appended. The freeze itself is not changed.
 */
function runAndCollectTitles(argvList) {
  const [cmd, ...args] = argvList
  const reporter = args.includes('--reporter=json') ? [] : ['--reporter=json']
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-frozen-titles-'))
  const reportPath = join(scratch, 'report.json')
  try {
    const result = spawnSync(cmd, [...args, ...reporter, '--outputFile', reportPath], { cwd: REPO_ROOT, encoding: 'utf8' })
    if (result.error) {
      return { ok: false, error: `failed to spawn ${JSON.stringify(argvList)}: ${result.error.message}`, titles: new Set() }
    }
    let report
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'))
    } catch (err) {
      return {
        ok: false,
        error: `${JSON.stringify(argvList)} did not write a parseable --reporter=json report to ${reportPath} (exit ${result.status}): ${err.message}`,
        titles: new Set(),
      }
    }
    return collectTitles(report)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * The titles one parsed vitest report resolves, how many cases each names, and the full names of those cases.
 * @param report - a parsed `--reporter=json` document.
 * @returns the resolvable names, their per-name case counts, and per name the `fullName` of each case it names.
 */
export function collectTitles(report) {
  const titles = new Set()
  // How many cases each name can resolve to. A bare `title` shared by several
  // cases counts once per case; a `fullName` carries its describe chain and so
  // counts once. A frozen string whose count exceeds 1 is satisfiable by a case
  // other than the one it means (BLOCKED-104).
  const matchCounts = new Map()
  const countMatch = (name) => matchCounts.set(name, (matchCounts.get(name) ?? 0) + 1)
  // What an entry's `-t` pattern is matched against (see frozenTestNamePattern).
  const fullNamesByName = new Map()
  const addFullName = (name, fullName) => fullNamesByName.set(name, [...(fullNamesByName.get(name) ?? []), fullName])
  for (const file of report.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (typeof a.title === 'string') {
        titles.add(a.title)
        countMatch(a.title)
      }
      // vitest's real `--reporter=json` shape: `fullName` is
      // `ancestorTitles.join(' ') + ' ' + title` (space-separated, no
      // delimiter) -- generate-ledger.mjs's parseVitestJsonReport matches on
      // it directly rather than reconstructing it; this gate does the same.
      if (typeof a.fullName === 'string') {
        titles.add(a.fullName)
        if (a.fullName !== a.title) countMatch(a.fullName)
        if (typeof a.title === 'string') addFullName(a.title, a.fullName)
        if (a.fullName !== a.title) addFullName(a.fullName, a.fullName)
      }
    }
  }
  return { ok: true, titles, matchCounts, fullNamesByName }
}

/**
 * An entry's `-t` / `--testNamePattern`, compiled as vitest compiles it.
 *
 * Read from vitest 4.1.8: mri takes `-t v`, `-t=v`, `--testNamePattern v` and
 * `--testNamePattern=v` (`vitest/dist/chunks/cac.C9xsMMkH.js:84-107`);
 * `addCommand` refuses a repeated value and strips one surrounding pair of `"`
 * or `'` (`removeQuotes`, same file :2190-2200 and :2272-2280); `resolveConfig`
 * compiles it with `new RegExp(value)` and no flags
 * (`vitest/dist/chunks/coverage.DM_a_rWm.js:359`). The runner then skips every
 * test whose full name does not `match` it (`interpretTaskModes` and
 * `getTaskFullName`, `@vitest/runner/dist/chunk-artifact.js:964` and :1006),
 * and that full name is the string the json reporter records as `fullName`
 * (`vitest/dist/chunks/index.UpGiHP7g.js:3560-3569`).
 * @param argv - a frozen argv.
 * @returns `{ pattern }`, `{ reason }` when vitest would not accept the value, or `undefined` when the argv names none.
 */
export function frozenTestNamePattern(argv) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-t' || token === '--testNamePattern') {
      values.push(argv[index + 1])
      index += 1
    } else if (token.startsWith('-t=') || token.startsWith('--testNamePattern=')) {
      values.push(token.slice(token.indexOf('=') + 1))
    }
  }
  if (values.length === 0) return undefined
  const [value] = values
  if (values.length > 1 || value === undefined) return { reason: 'names -t more than once or with no value, which vitest does not run' }
  const quoted = (value[0] === '"' && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))
  try {
    return { pattern: new RegExp(quoted ? value.slice(1, -1) : value) }
  } catch (error) {
    return { reason: `-t ${JSON.stringify(value)} is not a regular expression vitest can compile: ${error.message}` }
  }
}

/**
 * The frozen names an entry's `-t` pattern would leave skipped.
 *
 * vitest reports a test the pattern does not select as skipped and still exits
 * 0, and this gate collects titles of any status, so a pattern selecting none of
 * an entry's cases (an unescaped `acceptance[1]` is the character class `[1]`)
 * would read as resolvable. A name counts as selected when a full name it
 * resolves to in the run matches the pattern.
 * @param pattern - from {@link frozenTestNamePattern}.
 * @param names - frozen names the run resolves, a registered rename already applied.
 * @param fullNamesByName - from {@link collectTitles}.
 * @returns the names none of whose full names the pattern matches.
 */
export function casesSkippedByPattern(pattern, names, fullNamesByName) {
  return names.filter(name => !(fullNamesByName.get(name) ?? []).some(fullName => fullName.match(pattern) !== null))
}

/**
 * Paths every default vitest run reads, so a change to any of them since the report's commit sends every command to a
 * real run: the config, the heavy-suite list the config imports, the lockfile and the base tsconfig.
 * `package.json` is left out on purpose: its script entries change often and do not change which tests exist or
 * what they are named, while a dependency change reaches the lockfile.
 */
const SHARED_TEST_INPUTS = ['vitest.config.ts', 'scripts/coverage-exempt.ts', 'pnpm-lock.yaml', 'tsconfig.base.json']

/** `vitest.config.ts`'s `testIncludes`, as repository-path patterns. */
const TEST_INCLUDES = [
  /^packages\/[^/]+\/[^/]+\/tests\/.+\.spec\.tsx?$/u,
  /^apps\/[^/]+\/tests\/.+\.spec\.ts$/u,
  /^scripts\/.+\.spec\.ts$/u,
  /^tests\/.+\.spec\.ts$/u,
]

/**
 * The unit a changed path invalidates in report mode.
 * @param path - a repository-relative path.
 * @returns `packages/<group>/<package>`, `apps/<app>`, `tests/<dir>` or `scripts/<dir>`, otherwise the path's directory (`.` at the root).
 */
export function unitOf(path) {
  const match = /^(packages\/[^/]+\/[^/]+|apps\/[^/]+|tests\/[^/]+|scripts\/[^/]+)\//u.exec(path)
  if (match !== null) return match[1]
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '.' : path.slice(0, slash)
}

/**
 * The path filters of a frozen `pnpm exec vitest run` command. vitest reads each filter as a substring of a test
 * file's path.
 * @param argv - the frozen argv.
 * @returns `{ filters }`, or `{ reason }` when report mode cannot stand in for the command.
 */
export function commandFilters(argv) {
  if (argv.length < 4 || argv[0] !== 'pnpm' || argv[1] !== 'exec' || argv[2] !== 'vitest' || argv[3] !== 'run') {
    return { reason: 'not a `pnpm exec vitest run` command' }
  }
  const filters = []
  for (let index = 4; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--reporter=json') continue
    // `-t` narrows which cases pass, not which are reported: vitest lists the others as skipped.
    if (arg === '-t') {
      index += 1
      continue
    }
    if (arg.startsWith('-')) return { reason: `flag ${arg} is not one report mode reads` }
    filters.push(arg)
  }
  return filters.length === 0 ? { reason: 'no path filter, so the command runs every test file' } : { filters }
}

/**
 * A report file's repository path.
 * @param name - the absolute test-file path the report records.
 * @param treeFiles - the paths this tree has.
 * @returns the longest suffix of `name` the tree has; otherwise the suffix from its first `packages`, `apps`, `scripts` or `tests` segment (a file deleted since the report's commit); otherwise `null`.
 */
export function repositoryPath(name, treeFiles) {
  const parts = name.split('/')
  for (let index = 0; index < parts.length; index += 1) {
    const candidate = parts.slice(index).join('/')
    if (treeFiles.has(candidate)) return candidate
  }
  const top = parts.findIndex(part => part === 'packages' || part === 'apps' || part === 'scripts' || part === 'tests')
  return top === -1 ? null : parts.slice(top).join('/')
}

/**
 * Whether a frozen command's titles can come from the full-suite report.
 *
 * The command runs for real when a path it selects in this tree is missing from the report, when any unit (see
 * {@link unitOf}) of a selected file changed since the report's commit, when a shared test input changed, or when it
 * selects nothing in the report.
 * @param argv - the frozen argv.
 * @param context - from the report binding: `reportFiles` (`{ path, assertionResults }`), `testFiles`, `changedUnits`, `sharedInputsChanged`.
 * @returns `{ testResults }` to collect titles from, or `{ reasons }` the command must run.
 */
export function planCommand(argv, context) {
  const parsed = commandFilters(argv)
  if (parsed.filters === undefined) return { reasons: [parsed.reason] }
  const selects = path => parsed.filters.some(filter => path.includes(filter))
  const reasons = []
  if (context.sharedInputsChanged.length > 0) reasons.push(`shared test input changed: ${context.sharedInputsChanged.join(', ')}`)
  const fromReport = context.reportFiles.filter(file => selects(file.path))
  if (fromReport.length === 0) reasons.push('selects no file in the report')
  const reported = new Set(fromReport.map(file => file.path))
  const missing = context.testFiles.filter(path => selects(path) && !reported.has(path))
  if (missing.length > 0) reasons.push(`not in the report: ${missing.join(', ')}`)
  const units = new Set([...reported, ...context.testFiles.filter(selects)].map(unitOf))
  const changed = [...units].filter(unit => context.changedUnits.has(unit)).sort()
  if (changed.length > 0) reasons.push(`changed since the report: ${changed.join(', ')}`)
  return reasons.length > 0 ? { reasons } : { testResults: fromReport.map(file => ({ assertionResults: file.assertionResults })) }
}

/**
 * Binds a full-suite report to this tree for report mode. Every refusal names its reason, and the caller then runs
 * every command, so an unusable report never skips the check.
 * @param reportPath - the `--from-report` path; its directory name must carry a commit token, as generate-ledger's report directories do.
 * @returns `{ ok: true, commit, context }` for {@link planCommand}, or `{ ok: false, reason }`.
 */
function loadReportContext(reportPath) {
  const git = args => spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  const directory = basename(dirname(reportPath))
  const tokens = (directory.match(/[0-9a-f]{10,40}/gu) ?? []).filter(token => !/^[0-9]+$/u.test(token))
  if (tokens.length === 0) return { ok: false, reason: `report directory "${directory}" carries no commit token` }
  let commit
  for (const token of tokens) {
    const resolved = git(['rev-parse', '--verify', '--quiet', `${token}^{commit}`])
    if (resolved.status === 0 && git(['merge-base', '--is-ancestor', resolved.stdout.trim(), 'HEAD']).status === 0) {
      commit = resolved.stdout.trim()
      break
    }
  }
  if (commit === undefined) return { ok: false, reason: `report directory token(s) ${tokens.join(', ')} name no commit that is HEAD or an ancestor of it` }
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'))
  } catch (error) {
    return { ok: false, reason: `${reportPath} is not a readable JSON report: ${error.message}` }
  }
  const files = report.testResults ?? []
  if ((report.numFailedTestSuites ?? 0) !== 0) return { ok: false, reason: `the report records ${String(report.numFailedTestSuites)} failed suite(s)` }
  if (files.length === 0) return { ok: false, reason: 'the report has no test files' }
  const empty = files.filter(file => (file.assertionResults ?? []).length === 0)
  if (empty.length > 0) return { ok: false, reason: `${String(empty.length)} report file(s) record no cases, e.g. ${empty[0].name}` }
  const listed = git(['ls-files', '--cached', '--others', '--exclude-standard'])
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'])
  const diff = git(['diff', '--name-only', commit, 'HEAD'])
  if (listed.status !== 0 || status.status !== 0 || diff.status !== 0) return { ok: false, reason: 'git could not list this tree or its changes' }
  const treeFiles = listed.stdout.split('\n').filter(Boolean)
  const treeSet = new Set(treeFiles)
  const changed = [
    ...diff.stdout.split('\n'),
    ...status.stdout.split('\n').map(line => line.slice(3).split(' -> ').pop() ?? ''),
  ].filter(Boolean)
  const reportFiles = files.map(file => ({ path: repositoryPath(file.name, treeSet), assertionResults: file.assertionResults }))
  const unmapped = reportFiles.filter(file => file.path === null)
  if (unmapped.length > 0) return { ok: false, reason: `${String(unmapped.length)} report file(s) map to no repository path` }
  return {
    ok: true,
    commit,
    context: {
      reportFiles,
      testFiles: treeFiles.filter(path => TEST_INCLUDES.some(pattern => pattern.test(path))),
      changedUnits: new Set(changed.map(unitOf)),
      sharedInputsChanged: SHARED_TEST_INPUTS.filter(path => changed.includes(path)),
    },
  }
}

function main() {
  const freeze = loadJson(FREEZE_PATH)
  const renames = loadJson(RENAMES_PATH)

  const renameIndex = new Map()
  let totalRetiredRenames = 0
  for (const r of renames.entries) {
    // A RETIRED rename covers nothing (§12.68). It is kept in the register so
    // a wrong call stays visible, but indexing it would go on telling this
    // verifier that a dead title had merely moved — which is exactly how three
    // P4-08 titles read as resolvable for a day while having no live subject.
    if (r.retired !== undefined) {
      totalRetiredRenames += 1
      continue
    }
    renameIndex.set(`${r.epic}|${r.stage}|${r.oldTitle}`, r)
  }

  const fromReportPath = opt('from-report')
  const reportMode = fromReportPath === undefined ? undefined : loadReportContext(resolve(REPO_ROOT, fromReportPath))
  if (reportMode !== undefined && !reportMode.ok) console.log(`report mode refused (${reportMode.reason}); running every command`)
  let resolvedFromReport = 0

  const runCache = new Map()
  const runResultFor = (argvList) => {
    const key = JSON.stringify(argvList)
    if (!runCache.has(key)) {
      const plan = reportMode?.ok === true ? planCommand(argvList, reportMode.context) : undefined
      if (plan?.testResults !== undefined) {
        resolvedFromReport += 1
        runCache.set(key, collectTitles({ testResults: plan.testResults }))
      } else {
        console.log(`running ${argvList.join(' ')} ...${plan === undefined ? '' : ` (report mode: ${plan.reasons.join('; ')})`}`)
        runCache.set(key, runAndCollectTitles(argvList))
      }
    }
    return runCache.get(key)
  }

  const entries = {}
  let totalTitles = 0
  let totalUnresolved = 0
  let totalAmbiguous = 0
  let totalDuplicated = 0
  let totalRenameCovered = 0
  let totalUnselected = 0
  let entriesWithProblems = 0

  for (const e of freeze.entries) {
    // A superseded entry's titles are retired by construction: supersession
    // records that a later entry replaced this one for the same (epic, stage),
    // which is a different fact from a title being renamed without a register
    // record. Checking them would report every supersession as drift.
    if (e.supersededBy !== undefined) continue

    const key = `${e.epic}.${e.stage}`
    const run = runResultFor(e.argv)

    if (!run.ok) {
      entriesWithProblems += 1
      entries[key] = { argv: e.argv, runError: run.error, unresolved: [], ambiguous: [], renameCovered: [] }
      continue
    }

    const unresolved = []
    const ambiguous = []
    // `expectCases` is a list matched as a set, so a repeated string expresses
    // a multiplicity nothing honours (BLOCKED-104). Reported per entry, before
    // the per-title loop, because it is a property of the freeze rather than of
    // the observation.
    const duplicated = []
    const seenInEntry = new Map()
    for (const title of e.expectCases) seenInEntry.set(title, (seenInEntry.get(title) ?? 0) + 1)
    for (const [title, count] of seenInEntry) {
      if (count > 1) {
        totalDuplicated += 1
        duplicated.push({ title, count })
      }
    }
    const renameCovered = []
    for (const title of e.expectCases) {
      totalTitles += 1
      if (run.titles.has(title)) {
        const count = run.matchCounts.get(title) ?? 0
        if (count > 1) {
          totalAmbiguous += 1
          ambiguous.push({ title, count })
        }
        continue
      }
      const renameEntry = renameIndex.get(`${e.epic}|${e.stage}|${title}`)
      if (renameEntry) {
        totalRenameCovered += 1
        if (run.titles.has(renameEntry.newTitle)) {
          renameCovered.push({ oldTitle: title, newTitle: renameEntry.newTitle, renamedInCommit: renameEntry.renamedInCommit })
        } else {
          totalUnresolved += 1
          unresolved.push({
            title,
            reason: `registered rename's newTitle is ALSO not resolvable: ${JSON.stringify(renameEntry.newTitle)}`,
          })
        }
        continue
      }
      totalUnresolved += 1
      unresolved.push({ title, reason: 'not found in the frozen command\'s real vitest --reporter=json output and no registered rename' })
    }

    // The entry's own -t must select every case it freezes, or the command skips them and exits 0.
    const unselected = []
    const label = e.supplementSeq === undefined ? key : `${key}.${String(e.supplementSeq)}`
    const testName = frozenTestNamePattern(e.argv)
    if (testName?.reason !== undefined) {
      unselected.push({ entry: label, title: null, reason: testName.reason })
    } else if (testName !== undefined) {
      const resolved = e.expectCases.flatMap((title) => {
        if (run.titles.has(title)) return [{ title, name: title }]
        const renamed = renameIndex.get(`${e.epic}|${e.stage}|${title}`)?.newTitle
        return renamed !== undefined && run.titles.has(renamed) ? [{ title, name: renamed }] : []
      })
      const skipped = new Set(casesSkippedByPattern(testName.pattern, resolved.map(({ name }) => name), run.fullNamesByName))
      for (const { title, name } of resolved.filter((pair) => skipped.has(pair.name))) {
        unselected.push({
          entry: label,
          title,
          reason: `the entry's -t ${String(testName.pattern)} matches none of ${JSON.stringify(run.fullNamesByName.get(name))}, `
            + 'so vitest reports it skipped and still exits 0; escape the regular-expression characters in the -t value',
        })
      }
    }
    totalUnselected += unselected.length

    if (unresolved.length > 0 || ambiguous.length > 0 || duplicated.length > 0 || unselected.length > 0) {
      entriesWithProblems += 1
      entries[key] = { argv: e.argv, unresolved, ambiguous, duplicated, renameCovered, unselected }
    }
  }

  const findings = {
    summary: {
      totalEntries: freeze.entries.length,
      uniqueCommandsRun: runCache.size,
      retiredRenames: totalRetiredRenames,
      entriesWithProblems,
      totalTitles,
      totalUnresolved,
      totalAmbiguous,
      totalDuplicated,
      totalRenameCovered,
      totalUnselected,
    },
    entries,
  }

  if (reportMode?.ok === true) {
    findings.summary.resolvedFromReport = { commit: reportMode.commit, commands: resolvedFromReport, run: runCache.size - resolvedFromReport }
  }
  const reportPath = opt('report')
  if (reportPath) writeFileSync(resolve(REPO_ROOT, reportPath), `${JSON.stringify(findings, null, 2)}\n`, 'utf8')

  console.log(
    `command-freeze.json: ${freeze.entries.length} entries, ${runCache.size} unique command(s) run, `
      + `${totalTitles} frozen titles, ${totalRenameCovered} covered by a registered rename, `
      + `${totalUnresolved} UNRESOLVED, ${totalAmbiguous} AMBIGUOUS, ${totalDuplicated} DUPLICATED, `
      + `${totalUnselected} NOT SELECTED by the entry's -t.`,
  )
  if (reportMode?.ok === true) {
    console.log(`report mode: ${String(resolvedFromReport)} command(s) resolved from the report at ${reportMode.commit.slice(0, 10)}, ${String(runCache.size - resolvedFromReport)} run`)
  }
  if (entriesWithProblems > 0) {
    console.error('UNRESOLVED (fail-closed):')
    for (const [key, e] of Object.entries(entries)) {
      if (e.runError) console.error(`  ${key}: ${e.runError}`)
      for (const u of e.unresolved) console.error(`  ${key}: ${JSON.stringify(u.title)} -- ${u.reason}`)
      for (const dup of e.duplicated ?? []) {
        console.error(
          `  ${key}: ${JSON.stringify(dup.title)} -- listed ${dup.count} times in one expectCases, which is matched as a SET, so the repeat is discarded; if the repeats mean different runs of one suite, name each by its fullName (BLOCKED-104)`,
        )
      }
      for (const a of e.ambiguous ?? []) {
        console.error(
          `  ${key}: ${JSON.stringify(a.title)} -- names ${a.count} passing cases, so any ONE of them satisfies it and this epic's own case could be deleted without reddening; use the case's fullName (BLOCKED-104)`,
        )
      }
      for (const u of e.unselected ?? []) {
        console.error(`  ${u.entry}: ${u.title === null ? '' : `${JSON.stringify(u.title)} -- `}${u.reason}`)
      }
    }
  }

  process.exit(entriesWithProblems > 0 ? 1 : 0)
}

// Only when run as a command; the spec imports the pure functions. Real paths on both sides: the spec runs a copy
// under the OS temp directory, which is a symlink on macOS.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main()
