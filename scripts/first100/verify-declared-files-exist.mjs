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
 * stdout for triage.
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
 * @param registry - the parsed registry.
 * @param acceptedIds - ids of ACCEPTED epics.
 * @param exists - whether a repo-relative path exists in the tree.
 * @returns `{ where, path }`, where `where` is the epic id or `epic.stage`.
 */
export function missingAcceptedRegistryRefs(registry, acceptedIds, exists) {
  const missing = []
  for (const epic of registry.epics) {
    if (!acceptedIds.has(epic.id)) continue
    for (const file of epic.files ?? []) {
      const path = typeof file === 'string' ? file : file.path
      if (!exists(path)) missing.push({ where: epic.id, path })
    }
    for (const [stage, spec] of Object.entries(epic.stages ?? {})) {
      for (const path of spec.files ?? []) {
        if (!exists(path)) missing.push({ where: `${epic.id}.${stage}`, path })
      }
    }
  }
  return missing
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
  const planned = missingAcceptedRegistryRefs(JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')), accepted, exists)
  if (planned.length > 0) {
    console.log(`verify-declared-files-exist: ${String(planned.length)} registry file reference(s) of ACCEPTED epics are absent `
      + `(informational, not a failure):\n  ${planned.map(({ where, path }) => `${where} ${path}`).join('\n  ')}`)
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
