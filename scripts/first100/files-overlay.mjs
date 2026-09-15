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
const ADJUDICATION_PATH = join(REPO_ROOT, 'tests/first100/adjudication.json')

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
 * The approved deliverable-path patches in `adjudication.json`, each with its epic resolved.
 *
 * A patch entry's `epic` falls back to its own key, the way generate-specs reads it.
 * Every reader uses an `approvedPath` as one repository path, so a value that
 * carries whitespace or a `#` anchor is refused here rather than read as a file
 * that does not exist. Every entry states its `kind`: `substitution` when the
 * approved path replaces the declared one, `widening` when the declared path
 * stays a deliverable and the approved path is added beside it. There is no
 * default, so a missing or misspelt field is refused here instead of being read
 * as one of the two. An entry with `supersededBy` is retired: it is validated
 * like any other, since it stays the record of what was once approved, and it is
 * left out of the result, so no resolution reads it.
 * @param adjudication - the parsed `tests/first100/adjudication.json`.
 * @returns the live patch entries.
 */
export function patchEntries(adjudication) {
  return Object.entries(adjudication.deliverablePathPatches?.entries ?? {}).map(([key, patch]) => {
    if (/\s|#/u.test(patch.approvedPath)) {
      throw new Error(`deliverablePathPatches.entries[${JSON.stringify(key)}].approvedPath must be one repository path, with no whitespace or # anchor: ${JSON.stringify(patch.approvedPath)}`)
    }
    if (patch.kind !== 'widening' && patch.kind !== 'substitution') {
      throw new Error(`deliverablePathPatches.entries[${JSON.stringify(key)}].kind must be "widening" or "substitution": ${JSON.stringify(patch.kind)}`)
    }
    if (patch.supersededBy !== undefined && (typeof patch.supersededBy !== 'string' || patch.supersededBy.trim() === '')) {
      throw new Error(`deliverablePathPatches.entries[${JSON.stringify(key)}].supersededBy must be a non-empty string saying what replaced it: ${JSON.stringify(patch.supersededBy)}`)
    }
    return { ...patch, epic: patch.epic ?? key }
  }).filter(patch => patch.supersededBy === undefined)
}

/**
 * Every declaration of an epic's registry row, resolved through the approved deliverable-path patches.
 *
 * The registry stays as extracted, and `adjudication.json` records where a
 * declared path was approved to land instead. A stage declaration resolves
 * through every patch for the same epic and stage; an epic-level declaration
 * through every patch of that epic naming the same declared path. One
 * declaration can carry several patches, each approving another deliverable,
 * so all of them apply. The overlay, the reality set and
 * verify-declared-files-exist all read declarations through this function, so
 * the three cannot resolve a patch differently.
 *
 * A declaration is `widening` when any patch that applies to it is a widening:
 * one patch saying the declared path is still a deliverable is not made false by
 * another patch on the same declaration substituting for it.
 * @param epic - the registry row.
 * @param patches - the patch entries, from {@link patchEntries}.
 * @returns one `{ where, declaredPath, approvedPaths, widening }` per declaration; `approvedPaths` is empty and `widening` false when no patch applies.
 */
export function resolveDeclaredPaths(epic, patches) {
  const resolveOne = (stage, where, declaredPath) => {
    const applicable = patches
      .filter(p => p.epic === epic.id && p.declaredPath === declaredPath && (stage === undefined || p.stage === stage))
    const approvedPaths = applicable.map(p => p.approvedPath)
    return { where, declaredPath, approvedPaths: [...new Set(approvedPaths)], widening: applicable.some(p => p.kind === 'widening') }
  }
  const records = (epic.files ?? []).map(file => resolveOne(undefined, epic.id, file.path))
  for (const [stage, spec] of Object.entries(epic.stages ?? {})) {
    for (const path of spec?.files ?? []) records.push(resolveOne(stage, `${epic.id}.${stage}`, path))
  }
  return records
}

/**
 * Every path an epic's registry row declares, plus every path an approved patch substitutes for one.
 *
 * A union, not a replacement: a patched declaration keeps its declared path,
 * because a freeze entry of the same epic can still cite it.
 * @param epic - the registry row.
 * @param patches - the patch entries, from {@link patchEntries}.
 * @returns declared and approved repo-relative paths.
 */
export function declaredPaths(epic, patches) {
  return new Set(resolveDeclaredPaths(epic, patches).flatMap(record => [record.declaredPath, ...record.approvedPaths]))
}

/**
 * Every path an epic's registry row declares, as extracted, with no patch applied.
 * @param epic - the registry row.
 * @returns declared repo-relative paths.
 */
export function declaredPathsAsExtracted(epic) {
  return declaredPaths(epic, [])
}

/**
 * Compute the overlay from the live freeze entries.
 *
 * Superseded entries are excluded: they describe a shape the epic no longer
 * promises, and carrying their files would widen the scope with replaced work.
 * @param registry - the parsed registry.
 * @param freeze - all freeze entries, superseded included; filtered here.
 * @param reasons - `{ "<epic> <path>": "<reason>" }`, supplying the human half.
 * @param patches - the patch entries, from {@link patchEntries}; a frozen path an epic declares through a patch is declared.
 * @returns overlay entries, sorted by epic then path.
 */
export function computeOverlay(registry, freeze, reasons, patches) {
  const byEpic = new Map(registry.epics.map(epic => [epic.id, epic]))
  const seen = new Map()
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined) continue
    const epic = byEpic.get(entry.epic)
    if (epic === undefined) continue
    const declared = declaredPaths(epic, patches)
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
 * Load the four inputs from their canonical paths.
 * @returns the registry, live-and-superseded freeze entries, the reason table, and the deliverable-path patches.
 */
export function loadOverlayInputs() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const reasons = JSON.parse(readFileSync(REASONS_PATH, 'utf8')).reasons
  const patches = patchEntries(JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8')))
  return { registry, freeze, reasons, patches }
}
