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
 * A reference an approved deliverable-path patch replaces is resolved through
 * the patch: a stage reference uses the patch for the same epic and stage, and
 * an epic-level reference uses any patch of that epic naming the same declared
 * path. A patched reference whose approved path exists is reported as patched,
 * not as absent; one whose approved path is absent too stays absent.
 * @param registry - the parsed registry.
 * @param acceptedIds - ids of ACCEPTED epics.
 * @param exists - whether a repo-relative path exists in the tree.
 * @param patches - the patch entries, each with its `epic` resolved.
 * @returns `absent` rows `{ where, path }`, carrying `approvedPath` when a patch named an absent target, and
 *   `patched` rows `{ where, path, approvedPath }`; `where` is the epic id or `epic.stage`.
 */
export function missingAcceptedRegistryRefs(registry, acceptedIds, exists, patches) {
  const absent = []
  const patched = []
  const resolve = (epicId, stage, where, path) => {
    if (exists(path)) return
    const patch = patches.find(p => p.epic === epicId && p.declaredPath === path && (stage === undefined || p.stage === stage))
    if (patch === undefined) absent.push({ where, path })
    else if (exists(patch.approvedPath)) patched.push({ where, path, approvedPath: patch.approvedPath })
    else absent.push({ where, path, approvedPath: patch.approvedPath })
  }
  for (const epic of registry.epics) {
    if (!acceptedIds.has(epic.id)) continue
    for (const file of epic.files ?? []) resolve(epic.id, undefined, epic.id, typeof file === 'string' ? file : file.path)
    for (const [stage, spec] of Object.entries(epic.stages ?? {})) {
      for (const path of spec.files ?? []) resolve(epic.id, stage, `${epic.id}.${stage}`, path)
    }
  }
  return { absent, patched }
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
  // A patch entry's epic falls back to its own key, as generate-specs reads it.
  const patches = Object.entries(JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8')).deliverablePathPatches?.entries ?? {})
    .map(([key, patch]) => ({ ...patch, epic: patch.epic ?? key }))
  const { absent, patched } = missingAcceptedRegistryRefs(JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')), accepted, exists, patches)
  if (patched.length > 0) {
    console.log(`verify-declared-files-exist: ${String(patched.length)} registry file reference(s) of ACCEPTED epics are replaced by an approved `
      + `deliverable-path patch whose target exists (informational):\n  ${patched.map(({ where, path, approvedPath }) => `${where} ${path} patched -> ${approvedPath}`).join('\n  ')}`)
  }
  if (absent.length > 0) {
    console.log(`verify-declared-files-exist: ${String(absent.length)} registry file reference(s) of ACCEPTED epics are absent `
      + `(informational, not a failure):\n  ${absent.map(({ where, path, approvedPath }) => `${where} ${path}${approvedPath === undefined ? '' : ` (patched -> ${approvedPath}, also absent)`}`).join('\n  ')}`)
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
