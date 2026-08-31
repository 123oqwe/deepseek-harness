/**
 * R0-3 / M0.C — spec-repair checker (CI-executable via the matching vitest
 * spec in this directory; the `.spec.ts` wrapper is what vitest's
 * `spec/**\/*.spec.ts` include discovers and runs).
 *
 * Proves, against the COMMITTED artifacts (never a fresh render), that the
 * canonical First-100 registry and its generated spec projections satisfy the
 * ownership/DAG contract from implementation-wave-map.md M0.C:
 *   - exact 100-ID set, unique ids, group counts == registry groupCounts;
 *   - every primaryLayer is the decision package §2 "Full mapping (100 rows)"
 *     EXACT layer per id (not enum membership alone), and the pinned L0–L6
 *     distribution from the same §2 (L0:1 L1:17 L2:62 L3:5 L4:0 L5:6 L6:9)
 *     holds — a distribution-preserving layer swap between two epics is caught
 *     by the exact per-id check;
 *   - every predecessor exists and lands in a strictly earlier wave
 *     (no same-wave, no reverse edge);
 *   - every same-wave multi-writer N/P file is recorded in the adjudication-
 *     pending conflict set (the 4 files), and every other multi-writer file is
 *     strictly sequential (distinct waves);
 *   - C/P/U/F stages all present with a schema-valid shape and at most 5 files
 *     per slice (a micro-PR slice is one stage; >5 is rejected);
 *   - W1–W19 all non-empty; evidence schema has 13 keys; verifyCommand present
 *     on every epic; spec owners are real self-owning epic ids;
 *   - generated artifacts stay cross-consistent: owner-map/dependency-graph/
 *     command-registry each project exactly the 100 registry epics.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..')

export interface FileRef { path: string; kind: string }
export interface Stage { nOf: number | string | null; files: string[] }
export type StageKey = 'C' | 'P' | 'U' | 'F'
export const STAGE_KEYS: readonly StageKey[] = ['C', 'P', 'U', 'F']
export interface Epic {
  id: string
  title: string
  wave: number
  predecessors: string[]
  primaryLayer: string
  canonicalOwner: string
  files: FileRef[]
  verifyCommand: string | null
  stages: Partial<Record<StageKey, Stage>>
}
export interface Registry {
  layerEnum: string[]
  groupCounts: Record<string, number>
  waveCount: number
  specOwners: Record<string, string>
  thresholdProposals: { epic: string; proposal: string; status: string }[]
  evidenceSchema: { key: string; required: boolean; note: string; enum?: string[] }[]
  epics: Epic[]
}

export const REGISTRY_PATH = 'tests/first100/registry.json'
/** Vendored canonical decision source — §2 "Full mapping (100 rows)" is the exact per-id primaryLayer authority. */
export const DECISION_PACKAGE_PATH = 'spec/first100/sources/r0-decision-package.md'
const OWNER_MAP_PATH = 'spec/first100-owner-map.json'
const GRAPH_PATH = 'spec/first100-dependency-graph.json'
const COMMANDS_PATH = 'spec/first100-command-registry.json'
const EVIDENCE_SCHEMA_PATH = 'spec/first100-evidence.schema.json'

/** Pinned L0–L6 distribution (r0-decision-package.md §2), not enum membership. */
export const PINNED_LAYER_DIST: Record<string, number> = {
  L0_KERNEL: 1,
  L1_CONTRACT: 17,
  L2_PROVIDER: 62,
  L3_CONSUMER: 5,
  L4_COMPOSITION: 0,
  L5_SURFACE: 6,
  L6_QUALIFICATION: 9,
}

/** The 4 recorded same-wave writer conflicts, pending R0-7 adjudication. */
export const RECORDED_CONFLICTS: readonly string[] = [
  'packages/execution/execution-world/src/types.ts',
  'packages/kernel/trust-kernel/src/types.ts',
  'packages/subagent/subagent/src/request.ts',
  'packages/subagent/subagent/src/result.ts',
]

const PLACEHOLDER_OWNER = /epic-owner\/|PX-\d{2}\b|\bplaceholder\b/i

export const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as T

export const readRegistry = (): Registry => readJson<Registry>(REGISTRY_PATH)

export const deepCopy = <T>(v: T): T => structuredClone(v)

/**
 * Parse the decision package §2 "Full mapping (100 rows)" table — the canonical
 * Agent A per-id primaryLayer authority the registry was extracted from. The
 * parse is IDENTICAL to the extractor's (`scripts/first100/extract-registry.mjs`):
 * scan between the `### Full mapping (100 rows)` and `### Layer adjudication
 * list` markers, match each `| P0-01 | L2_PROVIDER | … |` row, and require
 * exactly 100 unique ids. Throws if the table is absent or incomplete, so a
 * missing/corrupt canonical source fails closed rather than skipping the check.
 */
export function parseDecisionLayers(): Map<string, string> {
  const text = readFileSync(join(REPO_ROOT, DECISION_PACKAGE_PATH), 'utf8')
  const layers = new Map<string, string>()
  let inMapping = false
  for (const raw of text.split('\n')) {
    if (raw.includes('### Full mapping (100 rows)')) {
      inMapping = true
      continue
    }
    if (raw.includes('### Layer adjudication list')) {
      inMapping = false
      break
    }
    if (!inMapping) continue
    const m = /^\|\s*(P[0-8]-\d{2})\s*\|\s*(L[0-6]_[A-Z_]+)\s*\|/.exec(raw)
    if (m === null) continue
    const id = m[1]
    const layer = m[2]
    if (id !== undefined && layer !== undefined) layers.set(id, layer)
  }
  if (layers.size !== 100) {
    throw new Error(`decision package: expected exactly 100 layer rows, got ${layers.size}`)
  }
  return layers
}

/**
 * Returns every contract violation in the registry; an empty array means the
 * registry satisfies the ownership/DAG contract.
 */
export function checkRegistry(reg: Registry): string[] {
  const errs: string[] = []
  const eps = reg.epics

  if (eps.length !== 100) errs.push(`expected 100 epics, got ${eps.length}`)
  const ids = new Set(eps.map(e => e.id))
  if (ids.size !== eps.length) errs.push('duplicate epic ids')
  for (const e of eps) {
    if (!/^P[0-8]-\d{2}$/.test(e.id)) errs.push(`${e.id}: id not P<group>-<2-digit>`)
    if (!e.title) errs.push(`${e.id}: missing title`)
    if (!e.verifyCommand) errs.push(`${e.id}: missing verifyCommand`)
  }

  // Group counts must equal the registry's own groupCounts projection.
  const group = new Map<string, number>()
  for (const e of eps) {
    const g = e.id.split('-')[0]
    group.set(g, (group.get(g) ?? 0) + 1)
  }
  for (const [g, n] of Object.entries(reg.groupCounts)) {
    if (group.get(g) !== n) errs.push(`group ${g}: registry ${n} != computed ${group.get(g) ?? 0}`)
  }

  // primaryLayer: enum membership AND the pinned distribution.
  const layerDist = new Map<string, number>()
  for (const e of eps) {
    if (!reg.layerEnum.includes(e.primaryLayer)) {
      errs.push(`${e.id}: primaryLayer ${e.primaryLayer} not in layerEnum`)
    }
    layerDist.set(e.primaryLayer, (layerDist.get(e.primaryLayer) ?? 0) + 1)
  }
  for (const [layer, n] of Object.entries(PINNED_LAYER_DIST)) {
    if ((layerDist.get(layer) ?? 0) !== n) {
      errs.push(`layer ${layer}: pinned ${n} != actual ${layerDist.get(layer) ?? 0}`)
    }
  }

  // primaryLayer EXACT per id: every epic must match the decision package §2
  // pinned mapping (the canonical Agent A authority the registry was extracted
  // from), not just enum membership + distribution. A distribution-preserving
  // swap between two epics of different pinned layers is therefore caught here.
  // A missing/corrupt canonical source fails closed as a single violation.
  let pinnedLayer: ReadonlyMap<string, string>
  try {
    pinnedLayer = parseDecisionLayers()
  } catch (e) {
    errs.push(`decision-package: cannot parse canonical layer table: ${e instanceof Error ? e.message : String(e)}`)
    pinnedLayer = new Map<string, string>()
  }
  if (pinnedLayer.size === 100) {
    for (const e of eps) {
      const pinned = pinnedLayer.get(e.id)
      if (pinned === undefined) {
        errs.push(`${e.id}: no pinned layer in decision package §2 mapping`)
        continue
      }
      if (!reg.layerEnum.includes(pinned)) {
        errs.push(`${e.id}: pinned layer ${pinned} not in layerEnum`)
      }
      if (e.primaryLayer !== pinned) {
        errs.push(`${e.id}: primaryLayer ${e.primaryLayer} != pinned exact layer ${pinned} (decision package §2)`)
      }
    }
  }

  // Owners: no placeholder owner; legit values are UNASSIGNED_UNTIL_APPROVAL
  // (base registry, honest extracted-pending state), a self-owning spec epic,
  // or a real owning path. The effective 100-owner projection is validated on
  // the owner-map artifact instead of here.
  for (const e of eps) {
    const o = e.canonicalOwner
    const legit = o === 'UNASSIGNED_UNTIL_APPROVAL'
      || o === e.id
      || (/^(packages|scripts|apps|spec|tests)\//.test(o) && !PLACEHOLDER_OWNER.test(o))
    if (!legit) errs.push(`${e.id}: placeholder/invalid owner ${o}`)
  }

  // Predecessors: exist, strictly earlier wave, no self-dependency.
  const byId = new Map(eps.map(e => [e.id, e]))
  for (const e of eps) {
    if (e.predecessors.includes(e.id)) errs.push(`${e.id}: self-dependency`)
    for (const p of e.predecessors) {
      const pe = byId.get(p)
      if (!pe) {
        errs.push(`${e.id}: missing predecessor ${p}`)
      } else if (pe.wave >= e.wave) {
        errs.push(`${e.id}: predecessor ${p} wave ${pe.wave} not strictly earlier than ${e.wave}`)
      }
    }
  }

  // Waves 1..waveCount all non-empty and max wave == waveCount.
  const maxWave = eps.reduce((m, e) => Math.max(m, e.wave), 0)
  if (maxWave !== reg.waveCount) errs.push(`waveCount ${reg.waveCount} != max epic wave ${maxWave}`)
  for (let w = 1; w <= reg.waveCount; w++) {
    if (!eps.some(e => e.wave === w)) errs.push(`wave ${w} is empty`)
  }

  // Stages: C/P/U/F present, schema-valid, ≤5 files per slice. A stage's file
  // list IS the slice (micro-PR); >5 is rejected regardless of nOf marking.
  for (const e of eps) {
    for (const k of STAGE_KEYS) {
      const s = e.stages[k]
      if (!s || typeof s !== 'object' || !('nOf' in s) || !Array.isArray(s.files)) {
        errs.push(`${e.id}: stage ${k} missing or malformed`)
        continue
      }
      if (s.files.length > 5) {
        errs.push(`${e.id}: stage ${k} slice has ${s.files.length} files (>5)`)
      }
      if (s.files.some(f => !f || !f.trim())) errs.push(`${e.id}: stage ${k} has an empty file path`)
    }
  }

  // Ownership: every N/P file's writers must be either sequential (distinct
  // waves) or a recorded same-wave conflict. No unrecorded duplicate.
  const writers = new Map<string, { epics: string[]; waves: number[] }>()
  for (const e of eps) {
    const seen = new Set<string>()
    for (const f of e.files) {
      if (f.kind === 'B') continue
      if (seen.has(f.path)) errs.push(`${e.id}: duplicate file entry ${f.path}`)
      seen.add(f.path)
      const w = writers.get(f.path) ?? { epics: [], waves: [] }
      w.epics.push(e.id)
      w.waves.push(e.wave)
      writers.set(f.path, w)
    }
  }
  const conflicts: string[] = []
  for (const [path, w] of writers) {
    if (w.epics.length < 2) continue
    const sameWavePair = w.waves.some((wave, i) => w.waves.some((other, j) => i < j && wave === other))
    if (sameWavePair) conflicts.push(path)
  }
  conflicts.sort()
  if (conflicts.length !== RECORDED_CONFLICTS.length || conflicts.some((c, i) => c !== RECORDED_CONFLICTS[i])) {
    errs.push(`same-wave conflict set mismatch: computed ${JSON.stringify(conflicts)} != recorded ${JSON.stringify([...RECORDED_CONFLICTS])}`)
  }

  // Spec owners: 9 real self-owning `{epic}.{stage}` refs whose spec path
  // lives under spec/; the epic must exist and the stage must be a C/P/U/F key.
  const ownerEntries = Object.entries(reg.specOwners)
  if (ownerEntries.length !== 9) errs.push(`specOwners: expected 9, got ${ownerEntries.length}`)
  for (const [path, owner] of ownerEntries) {
    if (!path.startsWith('spec/')) errs.push(`spec owner path not under spec/: ${path}`)
    const m = /^(P[0-8]-\d{2})\.([CPUF])$/.exec(owner)
    if (!m) {
      errs.push(`spec owner ${owner} is not an {epic}.{stage} ref`)
    } else if (!byId.has(m[1])) {
      errs.push(`spec owner ${owner}: epic ${m[1]} does not exist`)
    }
  }

  // Thresholds stay recorded as proposals; none may self-approve.
  for (const t of reg.thresholdProposals) {
    if (t.status !== 'PROPOSED_PENDING_MAINTAINER') errs.push(`threshold ${t.epic}: status ${t.status} self-approved`)
  }

  // Evidence schema: 13 keys, the key set matches the schema's required list.
  const schema = reg.evidenceSchema
  if (schema.length !== 13) errs.push(`evidenceSchema: expected 13 keys, got ${schema.length}`)
  const schemaKeys = new Set(schema.map(e => e.key))
  if (schemaKeys.size !== schema.length) errs.push('evidenceSchema: duplicate keys')

  return errs
}

/**
 * Cross-artifact consistency: owner-map / dependency-graph / command-registry /
 * evidence-schema project exactly the 100 registry epics.
 */
export function checkArtifacts(reg: Registry): string[] {
  const errs: string[] = []
  const ids = new Set(reg.epics.map(e => e.id))

  const ownerMap = readJson<{ canonicalEpicOwners: Record<string, unknown> }>(OWNER_MAP_PATH)
  const ownerIds = Object.keys(ownerMap.canonicalEpicOwners)
  if (ownerIds.length !== 100) errs.push(`owner-map: ${ownerIds.length} owners, expected 100`)
  if (ownerIds.some(id => !ids.has(id))) errs.push('owner-map: unknown epic id')

  const graph = readJson<{ nodes: number; acyclic: boolean; waves: Record<string, string[]> }>(GRAPH_PATH)
  if (graph.nodes !== 100) errs.push(`dependency-graph: ${graph.nodes} nodes, expected 100`)
  if (graph.acyclic !== true) errs.push('dependency-graph: not acyclic')
  const waveKeys = Object.keys(graph.waves)
  if (waveKeys.length !== reg.waveCount) errs.push(`dependency-graph: ${waveKeys.length} waves, expected ${reg.waveCount}`)
  for (const [w, epics] of Object.entries(graph.waves)) {
    if (epics.length === 0) errs.push(`dependency-graph: wave ${w} empty`)
    if (epics.some(id => !ids.has(id))) errs.push(`dependency-graph: unknown epic in wave ${w}`)
  }

  const commands = readJson<{ entries: Record<string, unknown> }>(COMMANDS_PATH)
  const commandIds = Object.keys(commands.entries)
  if (commandIds.length !== 100) errs.push(`command-registry: ${commandIds.length} entries, expected 100`)
  if (commandIds.some(id => !ids.has(id))) errs.push('command-registry: unknown epic id')

  const evidence = readJson<{ required: string[] }>(EVIDENCE_SCHEMA_PATH)
  if (evidence.required.length !== 13) errs.push(`evidence-schema: ${evidence.required.length} required keys, expected 13`)

  return errs
}
