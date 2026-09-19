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

const ADDITION_STAGES = /^[CPUF](\.\d+)?$/u

/**
 * The approved additions: a file a stage must change that the registry declares nowhere.
 *
 * The fifth record class, and the only one that adds a deliverable rather than
 * describing what happened to a declared one. It carries no `declaredPath`
 * precisely because there is none to point at: a substitution replaces a
 * declaration, a widening stands beside one, and both refuse an entry with no
 * declared path to anchor to. Validation mirrors `patchEntries`, plus the two
 * fields only an addition has: the stage it belongs to, because `where` is
 * built from it and a misspelt stage would name a cell that does not exist, and
 * the ruling that approved it, because an addition with no ruling is an
 * undeclared deliverable with nobody's name on it. `declaredBy` is a list and
 * not a sentence so a reader can test it, and `expectedAt` says whether the
 * path is one the tree already holds or one the stage will create, which is
 * the difference between a gate reporting its absence and expecting it. An entry with
 * `supersededBy` is validated and then left out, exactly as a retired patch is.
 * @param adjudication - the parsed `tests/first100/adjudication.json`.
 * @returns the live addition entries.
 */
export function additionEntries(adjudication) {
  return Object.entries(adjudication.approvedAdditions?.entries ?? {}).map(([key, addition]) => {
    if (typeof addition.path !== 'string' || /\s|#/u.test(addition.path)) {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].path must be one repository path, with no whitespace or # anchor: ${JSON.stringify(addition.path)}`)
    }
    if (typeof addition.stage !== 'string' || !ADDITION_STAGES.test(addition.stage)) {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].stage must be C, P, U or F, optionally with a supplement sequence: ${JSON.stringify(addition.stage)}`)
    }
    if (typeof addition.rulingRef !== 'string' || addition.rulingRef.trim() === '') {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].rulingRef must name the ruling that approved it: ${JSON.stringify(addition.rulingRef)}`)
    }
    if (!Array.isArray(addition.declaredBy)) {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].declaredBy must be the list of epics that declare the path today, empty when none do: ${JSON.stringify(addition.declaredBy)}`)
    }
    if (addition.expectedAt !== 'tree' && addition.expectedAt !== 'stage') {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].expectedAt must be "tree" for a file that exists today or "stage" for one the stage creates: ${JSON.stringify(addition.expectedAt)}`)
    }
    if (addition.supersededBy !== undefined && (typeof addition.supersededBy !== 'string' || addition.supersededBy.trim() === '')) {
      throw new Error(`approvedAdditions.entries[${JSON.stringify(key)}].supersededBy must be a non-empty string saying what replaced it: ${JSON.stringify(addition.supersededBy)}`)
    }
    return { ...addition, epic: addition.epic ?? key }
  }).filter(addition => addition.supersededBy === undefined)
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
 * @param additions - the approved additions, from {@link additionEntries}; omitted, nothing is added and every caller reads what it read before.
 * @returns one `{ where, declaredPath, approvedPaths, widening }` per declaration, plus one `{ …, addition: true }` per approved addition; `approvedPaths` is empty and `widening` false when no patch applies.
 */
export function resolveDeclaredPaths(epic, patches, additions = []) {
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
  // An addition is its own declaration: it enters as `declaredPath` so every
  // caller that unions declared and approved paths picks it up unchanged. A
  // path this epic already declares is refused rather than silently doubled,
  // because a record that says nothing is a record nobody has to keep true.
  const declaredHere = new Set(records.map(record => record.declaredPath))
  for (const addition of additions) {
    if (addition.epic !== epic.id) continue
    if (declaredHere.has(addition.path)) {
      throw new Error(`approvedAdditions: ${epic.id} already declares ${addition.path}, so the addition records nothing`)
    }
    records.push({ where: `${epic.id}.${addition.stage}`, declaredPath: addition.path, approvedPaths: [], widening: false, addition: true })
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
 * @param additions - the addition entries, from {@link additionEntries}; omitted, only the registry's own declarations are read.
 * @returns declared and approved repo-relative paths.
 */
export function declaredPaths(epic, patches, additions = []) {
  return new Set(resolveDeclaredPaths(epic, patches, additions).flatMap(record => [record.declaredPath, ...record.approvedPaths]))
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
export function computeOverlay(registry, freeze, reasons, patches, additions = []) {
  const byEpic = new Map(registry.epics.map(epic => [epic.id, epic]))
  const seen = new Map()
  for (const entry of freeze) {
    if (entry.supersededBy !== undefined) continue
    const epic = byEpic.get(entry.epic)
    if (epic === undefined) continue
    const declared = declaredPaths(epic, patches, additions)
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
 * @returns the registry, live-and-superseded freeze entries, the reason table, the deliverable-path patches, and the approved additions.
 */
export function loadOverlayInputs() {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'))
  const freeze = JSON.parse(readFileSync(FREEZE_PATH, 'utf8')).entries
  const reasons = JSON.parse(readFileSync(REASONS_PATH, 'utf8')).reasons
  const adjudication = JSON.parse(readFileSync(ADJUDICATION_PATH, 'utf8'))
  const patches = patchEntries(adjudication)
  const additions = additionEntries(adjudication)
  return { registry, freeze, reasons, patches, additions }
}
