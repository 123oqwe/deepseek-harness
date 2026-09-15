/**
 * Every path a live freeze entry declares in `files` exists in the tree.
 *
 * A freeze entry names the files its cell is about. When a path moves or is
 * deleted, the entry keeps pointing at nothing, and no other gate notices: ten
 * such paths survived the re-anchor until they were found and re-pointed by hand.
 * This gate fails closed on a live entry, supplements included, whose `files`
 * name a path the tree does not hold.
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
import { patchEntries, resolveDeclaredPaths } from './files-overlay.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const LEDGER_PATH = join(REPO_ROOT, 'spec/first100/exec/ledger.json')
const ADJUDICATION_PATH = join(REPO_ROOT, 'tests/first100/adjudication.json')

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
 * Registry file references of ACCEPTED epics that do not exist. Informational, never a failure.
 *
 * Declarations are read through `files-overlay.mjs` `resolveDeclaredPaths`, the
 * resolution the overlay and the reality set share. A declared path that exists
 * is satisfied. One that does not is declared-missing when no approved patch
 * applies to it, or when a widening patch does: a widening keeps the declared
 * path a deliverable, so an approved path beside it does not account for its
 * absence. It is resolved-missing when at least one approved path is absent
 * too: each approved path is a deliverable its patch approved, so one absent
 * path is one absent deliverable. A widening declaration can be both.
 * @param registry - the parsed registry.
 * @param acceptedIds - ids of ACCEPTED epics.
 * @param exists - whether a repo-relative path exists in the tree.
 * @param patches - the deliverable-path patches, from `files-overlay.mjs` `patchEntries`.
 * @returns `declaredMissing` rows `{ where, path }` and `resolvedMissing` rows `{ where, path, absentApprovedPaths }`;
 *   `where` is the epic id or `epic.stage`.
 */
export function missingAcceptedRegistryRefs(registry, acceptedIds, exists, patches) {
  const declaredMissing = []
  const resolvedMissing = []
  for (const epic of registry.epics) {
    if (!acceptedIds.has(epic.id)) continue
    for (const { where, declaredPath, approvedPaths, widening } of resolveDeclaredPaths(epic, patches)) {
      if (exists(declaredPath)) continue
      if (approvedPaths.length === 0 || widening) declaredMissing.push({ where, path: declaredPath })
      const absentApprovedPaths = approvedPaths.filter(path => !exists(path))
      if (absentApprovedPaths.length > 0) resolvedMissing.push({ where, path: declaredPath, absentApprovedPaths })
    }
  }
  return { declaredMissing, resolvedMissing }
}

function main() {
  const exists = path => existsSync(join(REPO_ROOT, path))
  const basenameIndex = new Map()
  for (const path of execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')) {
    if (path === '') continue
    basenameIndex.set(basename(path), [...basenameIndex.get(basename(path)) ?? [], path])
  }
  const entries = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const missing = missingFreezeFiles(entries, exists, basenameIndex)

  const rows = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).rows
  const accepted = new Set(Object.entries(rows).filter(([, row]) => row.status === 'ACCEPTED').map(([id]) => id))
  const patches = patchEntries(JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8')))
  const { declaredMissing, resolvedMissing } = missingAcceptedRegistryRefs(JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')), accepted, exists, patches)
  if (declaredMissing.length > 0) {
    console.log(`verify-declared-files-exist: ${String(declaredMissing.length)} registry file reference(s) of ACCEPTED epics are absent with no `
      + `substituting patch, or under a widening patch (declared-missing, informational):\n  ${declaredMissing.map(({ where, path }) => `${where} ${path}`).join('\n  ')}`)
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
    process.exit(1)
  }
  const live = entries.filter(entry => entry.supersededBy === undefined).length
  console.log(`verify-declared-files-exist: every \`files\` path of ${String(live)} live freeze entries exists in the tree.`)
}

// Only when run as a command; the spec imports the pure functions above.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
