/**
 * Every path a live freeze entry declares in `files` exists in the tree.
 *
 * A freeze entry names the files its cell is about. When a path moves or is
 * deleted, the entry keeps pointing at nothing, and no other gate notices: ten
 * such paths survived the re-anchor until they were found and re-pointed by hand.
 * This gate fails closed on a live entry, supplements included, whose `files`
 * name a path the tree does not hold.
 *
 * It also fails a live entry whose argv runs a test that `files` does not
 * name (B-584). Staleness is judged from `files`, so `files` has to cover
 * every test the argv runs. The entries that break this on ACCEPTED rows are
 * listed in `spec/first100/exec/freeze-argv-files-exceptions.json` with an
 * expiry date, and a listed entry fails once its row is no longer ACCEPTED,
 * once the date has passed, or once it no longer breaks the rule.
 *
 * Registry references (an epic's `files` and its `stages.*.files`) are plan
 * paths, and for an unstarted epic they do not exist by construction. They are
 * never a failure here. The subset belonging to ACCEPTED epics is printed on
 * stdout for triage, after resolving each reference through the approved
 * deliverable-path patches in `tests/first100/adjudication.json`.
 *
 * Usage: `node scripts/first100/verify-declared-files-exist.mjs`
 *
 * @module scripts/first100/verify-declared-files-exist
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { additionEntries, patchEntries, resolveDeclaredPaths } from './files-overlay.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')
const ADJUDICATION_PATH = join(REPO_ROOT, 'tests/first100/adjudication.json')
const NEVER_DELIVERED_PATH = join(REPO_ROOT, 'spec/first100/exec/never-delivered.json')
const EXCEPTIONS_PATH = join(REPO_ROOT, 'spec/first100/exec/freeze-argv-files-exceptions.json')

/** Options whose next argv element is a value, not a test path. */
const ARGV_VALUE_OPTIONS = new Set(['-t', '--testNamePattern', '--config', '-c', '--project', '--dir', '--root', '-r'])

/** A test file, as this repository's vitest include patterns name them. */
const SPEC_FILE = /\.(?:spec|test|e2e|snapshot)\.[cm]?[jt]sx?$/u

/**
 * Declared `files` of live freeze entries that do not exist.
 * @param entries - command-freeze entries; superseded ones are skipped.
 * @param exists - whether a repo-relative path exists in the tree.
 * @param basenameIndex - tracked paths by file name, for the same-name-elsewhere hint.
 * @returns `{ label, path, sameNameElsewhere }` per missing path; `label` carries the supplement sequence.
 */
export function missingFreezeFiles(entries, exists, basenameIndex) {
  const missing = []
  for (const entry of entries) {
    if (entry.supersededBy !== undefined) continue
    const label = entry.supplementSeq === undefined ? `${entry.epic}.${entry.stage}` : `${entry.epic}.${entry.stage}.${String(entry.supplementSeq)}`
    for (const path of entry.files ?? []) {
      if (exists(path)) continue
      missing.push({ label, path, sameNameElsewhere: basenameIndex.get(basename(path)) ?? [] })
    }
  }
  return missing
}

/**
 * The test paths each live freeze entry's argv runs that its `files` do not
 * cover (the delegate's rule 甲, gate3 2026-09-25T22:06:36Z and 2026-09-28).
 * A path is covered when `files` lists it or a directory above it. A directory
 * argument is also covered when every test file below it in this tree is
 * listed. An argument that names no tracked file or directory is reported,
 * because what it runs cannot be judged.
 * @param entries - command-freeze entries in file order; superseded ones are skipped.
 * @param trackedPaths - every tracked path in the tree the check runs on.
 * @returns `{ index, label, uncovered }` per live entry with an uncovered argument; `index` is the entry's position in the file.
 */
export function argvPathsOutsideFiles(entries, trackedPaths) {
  const tracked = new Set(trackedPaths)
  const violations = []
  entries.forEach((entry, index) => {
    if (entry.supersededBy !== undefined) return
    const files = (entry.files ?? []).map(path => path.replace(/\/$/u, ''))
    const covered = path => files.some(file => path === file || path.startsWith(`${file}/`))
    const argv = entry.argv ?? []
    const uncovered = []
    for (let at = argv.indexOf('run') + 1; at > 0 && at < argv.length; at++) {
      const arg = argv[at]
      if (ARGV_VALUE_OPTIONS.has(arg)) {
        at++
        continue
      }
      if (arg.startsWith('-')) continue
      const path = arg.replace(/\/$/u, '')
      if (covered(path)) continue
      if (tracked.has(path)) {
        uncovered.push(path)
        continue
      }
      const below = trackedPaths.filter(file => file.startsWith(`${path}/`))
      if (below.length === 0) {
        uncovered.push(`${arg} (no tracked file or directory)`)
        continue
      }
      const unlisted = below.filter(file => SPEC_FILE.test(file) && !covered(file))
      if (unlisted.length > 0) uncovered.push(`${path}/ (unlisted below it: ${unlisted.join(', ')})`)
    }
    if (uncovered.length === 0) return
    const label = entry.supplementSeq === undefined ? `${entry.epic}.${entry.stage}` : `${entry.epic}.${entry.stage}.${String(entry.supplementSeq)}`
    violations.push({ index, label, uncovered })
  })
  return violations
}

/**
 * Judge argv-path violations against the exception table. An exception
 * excuses exactly one entry, named by its index, epic, stage and
 * `frozenAtUtc`, and only while that entry is live and still breaks the rule,
 * its row is ACCEPTED, and `today` is not after its `expiresOn`.
 * @param violations - from {@link argvPathsOutsideFiles}.
 * @param table - the parsed exception table.
 * @param entries - command-freeze entries in file order.
 * @param rowStatus - the ledger status of an epic's row, or `undefined` when the ledger has none.
 * @param today - the date the check runs, `YYYY-MM-DD` in UTC.
 * @returns `unexcused` violations and `invalid` exceptions, `{ index, reason }` each.
 */
export function judgeArgvExceptions(violations, table, entries, rowStatus, today) {
  const violating = new Set(violations.map(violation => violation.index))
  const listed = new Set()
  const invalid = []
  for (const exception of table.exceptions) {
    const entry = entries[exception.index]
    const reason = listed.has(exception.index)
      ? 'the table lists this index twice'
      : entry === undefined || entry.epic !== exception.epic || entry.stage !== exception.stage || entry.frozenAtUtc !== exception.frozenAtUtc
        ? `no freeze entry ${exception.epic}.${exception.stage} frozen at ${exception.frozenAtUtc} sits at this index`
        : entry.supersededBy !== undefined
          ? 'the entry was superseded; remove the exception'
          : !violating.has(exception.index)
            ? 'the entry no longer breaks the rule; remove the exception'
            : rowStatus(exception.epic) !== 'ACCEPTED'
              ? `the row is ${String(rowStatus(exception.epic))}, not ACCEPTED; supersede the entry with its files completed`
              : !/^\d{4}-\d\d-\d\d$/u.test(exception.expiresOn)
                ? `the exception expired on ${String(exception.expiresOn)}; supersede the entry with its files completed`
                : undefined
    listed.add(exception.index)
    if (reason !== undefined) invalid.push({ index: exception.index, reason })
  }
  return { unexcused: violations.filter(violation => !listed.has(violation.index)), invalid }
}

/**
 * The (epic, path) pairs recorded as never delivered by this lineage.
 *
 * A record must name a path the registry declares and the tree does not hold:
 * a record for a file that exists would hide a satisfied declaration, and one
 * for a path no epic declares has no subject. Both throw rather than report,
 * because a wrong record moves a row out of the missing list on a false premise.
 * @param document - the parsed `never-delivered.json`, or `undefined` when the file is absent.
 * @param declaredPaths - every `epic` + NUL + `path` pair the registry declares.
 * @param exists - whether a repo-relative path exists in the tree.
 * @returns the recorded pairs, in the same `epic` + NUL + `path` form.
 */
export function neverDeliveredPairs(document, declaredPaths, exists) {
  if (document === undefined) return new Set()
  const entries = document.entries
  if (!Array.isArray(entries)) throw new Error('never-delivered.json has no entries array')
  const pairs = new Set()
  for (const entry of entries) {
    const { epic, path, reason, rulingRef } = entry ?? {}
    if (typeof epic !== 'string' || typeof path !== 'string' || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`never-delivered: an entry needs epic, path and reason: ${JSON.stringify(entry)}`)
    }
    if (typeof rulingRef !== 'string' || rulingRef.trim() === '') {
      throw new Error(`never-delivered: ${epic} ${path} has no rulingRef, and a record without a ruling is not a record`)
    }
    if (exists(path)) throw new Error(`never-delivered: ${epic} ${path} exists in the tree, so it was delivered`)
    if (!declaredPaths.has(`${epic}\u0000${path}`)) throw new Error(`never-delivered: ${epic} does not declare ${path}`)
    pairs.add(`${epic}\u0000${path}`)
  }
  return pairs
}

/**
 * Registry file references of ACCEPTED epics that do not exist. Informational, never a failure.
 *
 * Declarations are read through `files-overlay.mjs` `resolveDeclaredPaths`, the
 * resolution the overlay and the reality set share. A declared path that exists
 * is satisfied. One that does not is declared-missing when no approved patch
 * applies to it, or when a widening patch does: a widening keeps the declared
 * path a deliverable, so an approved path beside it does not account for its
 * absence. A declaration is resolved-missing when at least one approved path is
 * absent: each approved path is a deliverable its patch approved, so one absent
 * path is one absent deliverable. Under a substitution the approved paths are
 * checked only when the declared path is absent, because a declared path still
 * present is what a substitution leaves behind. Under a widening they are
 * checked either way, because both files are deliverables, and a widening
 * declaration can be both declared-missing and resolved-missing.
 * @param registry - the parsed registry.
 * @param acceptedIds - ids of ACCEPTED epics.
 * @param exists - whether a repo-relative path exists in the tree.
 * @param patches - the deliverable-path patches, from `files-overlay.mjs` `patchEntries`.
 * @param neverDeliveredPairSet - the pairs `never-delivered.json` records, which are reported as their own class rather than as declared-missing.
 * @param additions - the approved additions, from `files-overlay.mjs` `additionEntries`; an addition is reported as its own class, never as declared-missing, and `expectedAt` decides when its absence counts: a `tree` path should be here now, a `stage` path only once the epic is ACCEPTED.
 * @returns `declaredMissing` and `neverDelivered` rows `{ where, path }`, `additionsMissing` rows `{ where, path, expectedAt }`, and `resolvedMissing` rows `{ where, path, absentApprovedPaths }`;
 *   `where` is the epic id or `epic.stage`.
 */
export function missingAcceptedRegistryRefs(registry, acceptedIds, exists, patches, neverDeliveredPairSet = new Set(), additions = []) {
  const declaredMissing = []
  const neverDelivered = []
  const resolvedMissing = []
  const additionsMissing = []
  const expectedAtOf = new Map(additions.map(addition => [`${addition.epic}\u0000${addition.path}`, addition.expectedAt]))
  for (const epic of registry.epics) {
    // An approved addition is read for every epic, accepted or not: `expectedAt`
    // says when its absence is a debt, and for a `tree` path that is today.
    for (const record of resolveDeclaredPaths(epic, patches, additions)) {
      if (record.addition !== true) continue
      if (exists(record.declaredPath)) continue
      const expectedAt = expectedAtOf.get(`${epic.id}\u0000${record.declaredPath}`)
      if (expectedAt === 'tree' || acceptedIds.has(epic.id)) {
        additionsMissing.push({ where: record.where, path: record.declaredPath, expectedAt })
      }
    }
    if (!acceptedIds.has(epic.id)) continue
    for (const { where, declaredPath, approvedPaths, widening, addition } of resolveDeclaredPaths(epic, patches, additions)) {
      if (addition === true) continue
      const declaredExists = exists(declaredPath)
      if (!declaredExists && (approvedPaths.length === 0 || widening)) {
        const row = { where, path: declaredPath }
        if (neverDeliveredPairSet.has(`${epic.id}\u0000${declaredPath}`)) neverDelivered.push(row)
        else declaredMissing.push(row)
      }
      if (declaredExists && !widening) continue
      const absentApprovedPaths = approvedPaths.filter(path => !exists(path))
      if (absentApprovedPaths.length > 0) resolvedMissing.push({ where, path: declaredPath, absentApprovedPaths })
    }
  }
  return { declaredMissing, neverDelivered, resolvedMissing, additionsMissing }
}

function main() {
  const exists = path => existsSync(join(REPO_ROOT, path))
  const basenameIndex = new Map()
  const trackedPaths = []
  for (const path of execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')) {
    if (path === '') continue
    trackedPaths.push(path)
    basenameIndex.set(basename(path), [...basenameIndex.get(basename(path)) ?? [], path])
  }
  const entries = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const missing = missingFreezeFiles(entries, exists, basenameIndex)

  const rows = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).rows
  const accepted = new Set(Object.entries(rows).filter(([, row]) => row.status === 'ACCEPTED').map(([id]) => id))
  const patches = patchEntries(JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8')))
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  const declaredPairs = new Set()
  for (const epic of registry.epics) {
    for (const { declaredPath } of resolveDeclaredPaths(epic, patches)) declaredPairs.add(`${epic.id}\u0000${declaredPath}`)
  }
  const additions = additionEntries(JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8')))
  const neverDeliveredDocument = existsSync(NEVER_DELIVERED_PATH) ? JSON.parse(readFileSync(NEVER_DELIVERED_PATH, 'utf8')) : undefined
  const recordedPairs = neverDeliveredPairs(neverDeliveredDocument, declaredPairs, exists)
  const { declaredMissing, neverDelivered, resolvedMissing, additionsMissing } = missingAcceptedRegistryRefs(registry, accepted, exists, patches, recordedPairs, additions)
  if (declaredMissing.length > 0) {
    console.log(`verify-declared-files-exist: ${String(declaredMissing.length)} registry file reference(s) of ACCEPTED epics are absent with no `
      + `substituting patch, or under a widening patch (declared-missing, informational):\n  ${declaredMissing.map(({ where, path }) => `${where} ${path}`).join('\n  ')}`)
  }
  if (additionsMissing.length > 0) {
    console.log(`verify-declared-files-exist: ${String(additionsMissing.length)} approved addition(s) name a file that is not in the tree `
      + `(informational; a "tree" path should be here already, a "stage" path is listed only once its epic is ACCEPTED):\n  `
      + additionsMissing.map(({ where, path, expectedAt }) => `${where} ${path} (expectedAt ${String(expectedAt)})`).join('\n  '))
  }
  if (neverDelivered.length > 0) {
    console.log(`verify-declared-files-exist: ${String(neverDelivered.length)} registry file reference(s) of ACCEPTED epics name a file this lineage never `
      + `carried (never-delivered, informational; recorded in spec/first100/exec/never-delivered.json with the ruling that admitted each):\n  `
      + neverDelivered.map(({ where, path }) => `${where} ${path}`).join('\n  '))
  }
  if (resolvedMissing.length > 0) {
    console.log(`verify-declared-files-exist: ${String(resolvedMissing.length)} registry file reference(s) of ACCEPTED epics are absent and so is `
      + `an approved patch target (resolved-missing, informational):\n  ${resolvedMissing.map(({ where, path, absentApprovedPaths }) => `${where} ${path} -> absent ${absentApprovedPaths.join(', ')}`).join('\n  ')}`)
  }

  if (missing.length > 0) {
    console.error(`verify-declared-files-exist: ${String(missing.length)} live freeze \`files\` path(s) do not exist:\n  `
      + missing.map(({ label, path, sameNameElsewhere }) => `${label} ${path} -- ${sameNameElsewhere.length === 0
        ? 'no tracked file has this name'
        : `same name elsewhere: ${sameNameElsewhere.join(', ')}`}`).join('\n  '))
  }
  const violations = argvPathsOutsideFiles(entries, trackedPaths)
  const table = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'))
  const { unexcused, invalid } = judgeArgvExceptions(violations, table, entries, epic => rows[epic]?.status, new Date().toISOString().slice(0, 10))
  if (unexcused.length > 0) {
    console.error(`verify-declared-files-exist: ${String(unexcused.length)} live freeze entr${unexcused.length === 1 ? 'y runs a test its' : 'ies run a test their'} \`files\` do not name; `
      + `supersede each with the paths added (B-584):\n  ${unexcused.map(({ index, label, uncovered }) => `[${String(index)}] ${label}: ${uncovered.join('; ')}`).join('\n  ')}`)
  }
  if (invalid.length > 0) {
    console.error(`verify-declared-files-exist: ${String(invalid.length)} exception(s) in spec/first100/exec/freeze-argv-files-exceptions.json no longer hold:\n  `
      + invalid.map(({ index, reason }) => `[${String(index)}] ${reason}`).join('\n  '))
  }
  if (missing.length > 0 || unexcused.length > 0 || invalid.length > 0) process.exit(1)
  const live = entries.filter(entry => entry.supersededBy === undefined).length
  console.log(`verify-declared-files-exist: every \`files\` path of ${String(live)} live freeze entries exists in the tree, and their \`files\` name every test `
    + `their argv runs, except ${String(violations.length)} excepted entr${violations.length === 1 ? 'y' : 'ies'} of ACCEPTED rows (until each one's expiresOn).`)
}

// Only when run as a command; the spec imports the pure functions above.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
