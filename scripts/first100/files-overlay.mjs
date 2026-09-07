/**
 * The append-only record of the files an epic really touched (§12.4, B4(e)).
 *
 * `files[]` is the plan, pinned at authoring time and immutable. The overlay is
 * the record of reality, and their union is the epic's scope. BLOCKED-134
 * measured what happens when only the first exists: 80 of 121 live freeze
 * entries cite a file the declaration never named, so a check computed from
 * `files[]` alone reports "this epic never touched X" for an X it did touch —
 * true whether or not the epic caused whatever is being ruled on.
 *
 * Three narrower mechanisms came before this one — `SCAFFOLD_FILES`,
 * `TEST_FILES_ADDED`, `FILES_REPLACED` in `extract-registry.mjs` — and between
 * them they recorded three files. They were not ceremony; they were the right
 * idea, maintained three times in a hundred-epic program. Their vocabulary
 * survives here as `reason`, and this module is the one place that answers the
 * question.
 *
 * **Generated, never hand-written.** The overlay is derived from the live
 * freeze entries, which are themselves observed rather than declared, so a path
 * cannot enter it by being typed. What a human supplies is the `reason` for a
 * `source` entry, which is the only part a machine cannot know.
 *
 * @module scripts/first100/files-overlay
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const REASONS_PATH = join(REPO_ROOT, 'spec/first100/exec/files-overlay-reasons.json')

/** What kind of file an overlay entry records, which decides who must explain it. */
export const OVERLAY_KINDS = ['test', 'fixture', 'doc', 'manifest', 'scaffold', 'source']

/**
 * Classify one repo-relative path.
 *
 * Order matters: a spec file under `src/` is a test, not source, and a
 * package.json inside a tests directory is still a manifest. The one
 * consequential boundary is `source`, because those are the entries §12.4
 * requires a human to explain and the delegate to read.
 * @param path - the repo-relative path.
 * @returns the overlay kind.
 */
export function classifyOverlayPath(path) {
  if (/(?:^|\/)(?:tests?|__tests__)\//u.test(path) || /\.(?:spec|e2e)\.[cm]?[jt]sx?$/u.test(path)) return 'test'
  if (/(?:^|\/)(?:fixtures?|snapshots)\//u.test(path)) return 'fixture'
  if (/\.md$/u.test(path) || /(?:^|\/)README/u.test(path)) return 'doc'
  if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|cordis[^/]*\.ya?ml|.*\.i18n\.yaml)$/u.test(path)) return 'manifest'
  // `scaffold` is NOT inferred from the path. A first draft returned it for
  // every `src/index.ts`, which would have classified `core/session/src/index.ts`
  // and `core/agent/src/index.ts` — hot-zone product files §12.4 names
  // specifically for the delegate's read-through — as convention-forced
  // barrels needing no explanation. Scaffold is an ADMISSION with an
  // authorization behind it (B4(f)), so it is something a reason says, not
  // something a filename proves.
  return 'source'
}

/**
 * Every path an epic's registry row declares, across the epic list and stages.
 * @param epic - the registry row.
 * @returns declared repo-relative paths.
 */
export function declaredPaths(epic) {
  const declared = new Set((epic.files ?? []).map(file => file.path))
  for (const stage of Object.values(epic.stages ?? {})) {
    for (const path of stage?.files ?? []) declared.add(path)
  }
  return declared
}

/**
 * Compute the overlay from the live freeze entries.
 *
 * Superseded entries are excluded: they describe a shape the epic no longer
 * promises, and carrying their files would widen the scope with replaced work.
 * @param registry - the parsed registry.
 * @param freeze - all freeze entries, superseded included; filtered here.
 * @param reasons - `{ "<epic> <path>": "<reason>" }`, supplying the human half.
 * @returns overlay entries, sorted by epic then path.
 */
export function computeOverlay(registry, freeze, reasons) {
  const byEpic = new Map(registry.epics.map(epic => [epic.id, epic]))
  const seen = new Map()
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined) continue
    const epic = byEpic.get(entry.epic)
    if (epic === undefined) continue
    const declared = declaredPaths(epic)
    for (const path of entry.files ?? []) {
      if (declared.has(path)) continue
      const key = `${entry.epic} ${path}`
      const stage = entry.supplementSeq === undefined ? entry.stage : `${entry.stage}.${String(entry.supplementSeq)}`
      const existing = seen.get(key)
      if (existing === undefined) {
        seen.set(key, { epic: entry.epic, path, kind: classifyOverlayPath(path), stages: [stage], reason: reasons[key] })
      } else if (!existing.stages.includes(stage)) {
        existing.stages.push(stage)
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.epic.localeCompare(b.epic) || a.path.localeCompare(b.path))
}

/**
 * Load the three inputs from their canonical paths.
 * @returns the registry, live-and-superseded freeze entries, and the reason table.
 */
export function loadOverlayInputs() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const reasons = JSON.parse(readFileSync(REASONS_PATH, 'utf8')).reasons
  return { registry, freeze, reasons }
}
