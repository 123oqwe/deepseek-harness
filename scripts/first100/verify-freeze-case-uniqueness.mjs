/**
 * Every live frozen case string names at most one passing case across the
 * whole suite (BLOCKED-104).
 *
 * `verify-frozen-titles-resolvable` counts matches inside each entry's own
 * command run, and greening counts them inside the one observation it reads.
 * Neither sees a string that is unique inside its own files and repeated in
 * another epic's: P2-04.C.1's bare title matched one case in its argv and
 * eight across the suite, so any of the eight satisfied the cell. This gate
 * takes the count over a whole-suite report.
 *
 * Usage: `node scripts/first100/verify-freeze-case-uniqueness.mjs --report <vitest-report.json>
 * [--candidate-sha <40-hex>] [--report-out <path>]`
 *
 * Exit 0 when every live frozen string resolves to at most one passing case,
 * 1 when at least one resolves to more, and 2 when the report cannot answer:
 * absent or unparseable, missing a file a live entry's argv names, carrying a
 * failure the flake registry does not hold, or not tied to `--candidate-sha`.
 * A string matching no case is counted and printed but is not this gate's
 * red; `verify-frozen-titles-in-tree` owns that finding.
 *
 * @module scripts/first100/verify-freeze-case-uniqueness
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registeredRenames } from './frozen-title-renames.mjs'
import { checkFailureSetAgainstFlakeRegistry, parseVitestJsonReport, reportDirMatchesCandidate } from './generate-ledger.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const FLAKE_REGISTRY_PATH = join(REPO_ROOT, 'spec/first100/exec/flake-registry.json')

// The supplement sequence is part of the address (BLOCKED-226): it names the entry a reader supersedes.
function entryLabel(entry) {
  return entry.supplementSeq === undefined ? `${entry.epic}.${entry.stage}` : `${entry.epic}.${entry.stage}.${String(entry.supplementSeq)}`
}

/**
 * One row per frozen string of every live freeze entry, with its passing-case count over the report.
 *
 * A string with no passing match is resolved once through the rename
 * registered for its cell. `renames` must already exclude retired renames,
 * which `registeredRenames()` does (§12.68).
 * @param entries - command-freeze entries, live and superseded alike; superseded ones produce no row.
 * @param matchCounts - passing-case counts per matchable name, from `parseVitestJsonReport`.
 * @param renames - `epic|stage|oldTitle` -> newTitle.
 * @returns `{ label, title, raw, resolved, via }`; `label` carries the supplement sequence when present,
 *   and `via` is `null` or `rename:<newTitle>`.
 */
export function classifyFrozenCaseMatches(entries, matchCounts, renames) {
  const rows = []
  for (const entry of entries) {
    if (entry.supersededBy !== undefined) continue
    const label = entryLabel(entry)
    for (const title of entry.expectCases ?? []) {
      const raw = matchCounts.get(title) ?? 0
      const renamed = raw === 0 ? renames.get(`${entry.epic}|${entry.stage}|${title}`) : undefined
      rows.push(renamed === undefined
        ? { label, title, raw, resolved: raw, via: null }
        : { label, title, raw, resolved: matchCounts.get(renamed) ?? 0, via: `rename:${renamed}` })
    }
  }
  return rows
}

/**
 * The positional test paths of a frozen `vitest run` argv: flags, and the pattern after `-t`, are dropped.
 * @param argv - a freeze entry's `argv`.
 * @returns the file or directory targets, repo-relative as frozen.
 */
export function argvTargets(argv) {
  const runAt = argv.indexOf('run')
  const targets = []
  for (let index = runAt + 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-t' || token === '--testNamePattern') {
      index += 1
      continue
    }
    if (!token.startsWith('-')) targets.push(token)
  }
  return targets
}

/**
 * Argv targets of live entries that no file in the report lies at or under.
 *
 * Report file names are absolute on the machine that ran the suite, so a
 * target matches on a `/`-bounded tail rather than a known prefix.
 * @param entries - command-freeze entries; superseded ones are skipped.
 * @param reportFiles - `testResults[].name` from the report.
 * @returns `{ label, target }` for each target the report does not cover.
 */
export function uncoveredArgvTargets(entries, reportFiles) {
  const files = reportFiles.map(name => `/${name.replace(/^\/+/u, '')}`)
  const missing = []
  for (const entry of entries) {
    if (entry.supersededBy !== undefined) continue
    const label = entryLabel(entry)
    for (const target of argvTargets(entry.argv ?? [])) {
      const bare = target.replace(/^\.\//u, '').replace(/\/+$/u, '')
      if (!files.some(file => file.endsWith(`/${bare}`) || file.includes(`/${bare}/`))) missing.push({ label, target })
    }
  }
  return missing
}

/**
 * Why a parsed report cannot answer the uniqueness question, or `null` when it can.
 *
 * An unregistered failure removes a passing case from the counts, and an
 * undercount can only hide a red in a gate whose only red is a count above one.
 * `checkFailureSetAgainstFlakeRegistry` reports a clean report as `valid: false`,
 * so this reads `unregisteredFailures` and never `valid`.
 * @param failedFullNames - failed case names, from `parseVitestJsonReport`.
 * @param reportFiles - `testResults[].name` from the report.
 * @param entries - command-freeze entries.
 * @param flakeRegistry - the parsed `flake-registry.json`.
 * @returns the refusal message, or `null`.
 */
export function reportRefusal(failedFullNames, reportFiles, entries, flakeRegistry) {
  const { unregisteredFailures } = checkFailureSetAgainstFlakeRegistry(failedFullNames, flakeRegistry)
  if (unregisteredFailures.length > 0) {
    return `${String(unregisteredFailures.length)} failed case(s) not in the flake registry:\n  ${unregisteredFailures.join('\n  ')}`
  }
  const uncovered = uncoveredArgvTargets(entries, reportFiles)
  if (uncovered.length > 0) {
    return `the report is not whole-suite: ${String(uncovered.length)} live argv target(s) absent from it:\n  `
      + uncovered.map(({ label, target }) => `${label} ${target}`).join('\n  ')
  }
  return null
}

function option(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function refuse(message) {
  console.error(`verify-freeze-case-uniqueness: cannot decide — ${message}`)
  process.exit(2)
}

function main() {
  const reportPath = option('report')
  if (reportPath === undefined) refuse('--report <vitest-report.json> is required; this gate never picks a report itself')
  if (!existsSync(reportPath)) refuse(`--report ${reportPath} does not exist`)
  let parsed
  try {
    parsed = parseVitestJsonReport(reportPath)
  } catch (error) {
    refuse(`--report ${reportPath} is not a parseable vitest JSON report: ${String(error)}`)
  }

  const candidateSha = option('candidate-sha')
  if (candidateSha !== undefined) {
    const verdict = reportDirMatchesCandidate(reportPath, candidateSha)
    if (!verdict.ok) refuse(`--report is not tied to --candidate-sha ${candidateSha}: ${verdict.reason}`)
  }

  const entries = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const reportFiles = (parsed.report.testResults ?? []).map(file => file.name)
  const refusal = reportRefusal(parsed.failedFullNames, reportFiles, entries, JSON.parse(readFileSync(FLAKE_REGISTRY_PATH, 'utf8')))
  if (refusal !== null) refuse(refusal)

  const rows = classifyFrozenCaseMatches(entries, parsed.matchCounts, registeredRenames())
  const ambiguous = rows.filter(row => row.resolved > 1)
  const absent = rows.filter(row => row.resolved === 0)
  const liveEntries = entries.filter(entry => entry.supersededBy === undefined).length
  const cases = reportFiles.length === 0 ? 0 : (parsed.report.testResults ?? []).reduce((sum, file) => sum + (file.assertionResults ?? []).length, 0)
  const digest = createHash('sha256').update(parsed.raw).digest('hex').slice(0, 16)
  const source = `${reportPath} (${String(reportFiles.length)} files, ${String(cases)} cases, ${String(parsed.failedFullNames.size)} failed, sha256 ${digest})`
  const summary = `${String(liveEntries)} live entries, ${String(rows.length)} frozen strings against ${source} — `
    + `${String(rows.length - ambiguous.length - absent.length)} unique, ${String(absent.length)} absent, ${String(ambiguous.length)} AMBIGUOUS.`

  const reportOut = option('report-out')
  if (reportOut !== undefined) writeFileSync(reportOut, `${JSON.stringify({ report: source, ambiguous, absent }, null, 2)}\n`, 'utf8')

  if (ambiguous.length > 0) {
    const holders = new Map()
    for (const file of parsed.report.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        if (assertion.status !== 'passed') continue
        for (const name of new Set([assertion.title, assertion.fullName])) {
          if (typeof name === 'string') holders.set(name, [...holders.get(name) ?? [], `${String(assertion.fullName)}  (${String(file.name)})`])
        }
      }
    }
    console.error(`verify-freeze-case-uniqueness: ${summary}`)
    for (const row of ambiguous) {
      const named = row.via === null ? row.title : row.via.slice('rename:'.length)
      console.error(`  ${row.label}: "${row.title}" names ${String(row.resolved)} passing cases across the whole suite, so any one of them `
        + 'satisfies this cell (BLOCKED-104). Supersede the entry naming its own case by fullName:\n    '
        + (holders.get(named) ?? []).join('\n    '))
    }
    process.exit(1)
  }
  console.log(`verify-freeze-case-uniqueness: ${summary}`)
  if (absent.length > 0) console.log(`  absent (verify-frozen-titles-in-tree owns these): ${absent.map(row => `${row.label} "${row.title}"`).join('; ')}`)
}

// Only when run as a command; the spec imports the pure functions above.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
