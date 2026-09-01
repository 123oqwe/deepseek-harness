/**
 * Deterministic generator for the First-100 spec artifacts (R0-2).
 *
 * Reads the single canonical source `tests/first100/registry.json` and renders,
 * byte-deterministically (sorted keys, JSON stringify for scalars, no
 * timestamps), the seven generated artifacts under `spec/`:
 *
 *   - deepseek-harness-optimization-manifest-v1.1.yaml  (human-readable 100-row manifest)
 *   - first100-owner-map.json                           (file -> owning epic; unique)
 *   - first100-dependency-graph.json                    (100-node DAG, edges, waves)
 *   - first100-command-registry.json                    (per epic x stage focused command or explicit N/A)
 *   - first100-thresholds.yaml                          (proposals, PROPOSED_PENDING_MAINTAINER)
 *   - first100-evidence.schema.json                     (13-entry evidence schema)
 *   - first100-clause-coverage-report.json              (U3: per-ID clause-equivalence vs the v1.0 YAML;
 *                                                        source span + content digest per clause;
 *                                                        unmatched = 0; undocumented inventions = 0)
 *
 * plus `spec/first100-generated-digests.json` (sha256 of each artifact + the
 * registry) and `spec/deepseek-harness-artifact-manifest-v1.1.json` (U2 bundle
 * index: per-artifact path/role/schemaVersion/raw SHA-256/bytes/generator/
 * source digest/baseline+candidate SHA, with the Git blob OID recorded
 * separately — never mixed). The manifest is generated as a separate output so
 * the digests<->manifest hashes stay acyclic. `pnpm vitest run
 * scripts/first100/generate-specs.spec.ts` re-runs this generator and asserts
 * the committed files are byte-identical, making manual dual-maintenance
 * structurally impossible. (The registry itself is locked by
 * scripts/first100/registry-regenerate.spec.ts against the pinned vendored
 * planning sources.)
 *
 * CLI:
 *   node scripts/first100/generate-specs.ts            write artifacts + digests
 *   node scripts/first100/generate-specs.ts --check    verify committed files; exit 0/1
 *   node scripts/first100/generate-specs.ts --r0-gate  fail-closed R0 exit gate: exit 1 until every
 *                                                      R0 item is resolved AND the v1.1 envelope is SIGNED.
 *                                                      Since maintainer directive 7 the gate DIRECTLY
 *                                                      verifies the DAG (computed acyclicity) and each
 *                                                      external-evidence item — native test, pack/install,
 *                                                      packaging ledger, runner receipts, independent-review
 *                                                      receipts — from the committed files bound in
 *                                                      `spec/first100-r0-evidence.json`; a SIGNED envelope
 *                                                      is one item, never a substitute for them.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as parseYaml } from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const REGISTRY_PATH = 'tests/first100/registry.json'
const ADJUDICATION_PATH = 'tests/first100/adjudication.json'
const DIGESTS_PATH = 'spec/first100-generated-digests.json'
const R0_EVIDENCE_PATH = 'spec/first100-r0-evidence.json'

const ARTIFACT_PATHS = [
  'spec/deepseek-harness-optimization-manifest-v1.1.yaml',
  'spec/first100-owner-map.json',
  'spec/first100-dependency-graph.json',
  'spec/first100-command-registry.json',
  'spec/first100-thresholds.yaml',
  'spec/first100-evidence.schema.json',
  'spec/first100-clause-coverage-report.json',
] as const

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** Git blob OID: SHA-1 of `blob <byteLength>\0<content>` — the object-address of
 *  a file in the repository, NOT the file's raw SHA-256. Recorded separately,
 *  never interchangeable with raw file hashes (maintainer directive U2). */
const gitBlobOidOf = (bytes: Uint8Array): string => {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(bytes).digest('hex')
}

export const ARTIFACT_MANIFEST_PATH = 'spec/deepseek-harness-artifact-manifest-v1.1.json'

/** Registry extraction sources, in deterministic (sorted-path) order. */
const REGISTRY_SOURCE_FILES = [
  'spec/first100/sources/first100-requirements-matrix.md',
  'spec/first100/sources/implementation-wave-map.md',
  'spec/first100/sources/r0-decision-package.md',
] as const

/** The vendored v1.0 optimization manifest YAML — the clause source the U3
 *  coverage report proves the matrix/registry preserves per ID. */
export const V10_MANIFEST_YAML = 'spec/first100/sources/v1.0/deepseek-harness-optimization-manifest-v1.yaml'

/** The four canonical v1.0 raw files vendored byte-for-byte (U1). */
const VENDORED_V10_FILES = [
  'spec/first100/sources/v1.0/deepseek-harness-optimization-manifest-v1.yaml',
  'spec/first100/sources/v1.0/deepseek-harness-general-purpose-optimization-v1.md',
  'spec/first100/sources/v1.0/deepseek-harness-master-execution-prompt-v1.md',
  'spec/first100/sources/v1.0/deepseek-harness-artifact-manifest-v1.json',
] as const

function readBytesOrThrow(root: string, p: string): Uint8Array {
  const full = join(root, p)
  if (!existsSync(full)) throw new Error(`${p}: missing — cannot generate the artifact-manifest`)
  return readFileSync(full)
}

interface Stage {
  nOf: string | null
  files: string[]
  count: number
  reason?: string
}
interface Epic {
  id: string
  title: string
  phase: number
  priority: string
  wave: number
  predecessors: string[]
  primaryLayer: string
  layerStatus: string
  canonicalOwner: string
  files: { path: string; kind: string }[]
  must: string[]
  acceptance: string[]
  nonGoals: string[]
  verifyCommand: string | null
  stages: Record<'C' | 'P' | 'U' | 'F', Stage>
  fixtures: Record<'contract' | 'provider' | 'composition' | 'fault', string>
}
export interface Registry {
  frozenBaseline: { sha: string; shortSha: string; label: string }
  layerEnum: string[]
  groupCounts: Record<string, number>
  exitSemantics: Record<string, string>
  specOwners: Record<string, string>
  thresholdProposals: { epic: string; proposal: string; status: string }[]
  adjudicationPending: {
    count: number
    enumerated: number
    notEnumeratedFromSources: {
      claimedByDecisionPackage: number
      sourceCertified: number
      gap: number
      note: string
    }
    layerIds: string[]
    status: string
    note: string
  }
  evidenceSchema: { key: string; required: boolean; note: string; enum?: string[]; frozen?: string }[]
  epics: Epic[]
}

export interface LayerMappingEntry {
  primaryLayer: string
  rationale: string
  source: string
  /** 1-based line of the row in the committed decision-package §2 table. */
  row: number
}

export interface LayerMappingCheck {
  valid: boolean
  status: string
  approved: boolean
  missingIds: string[]
  extraIds: string[]
  layerMismatches: string[]
  noRationale: string[]
  noSource: string[]
}

export interface Adjudication {
  schema: { name: string; version: number; kind: string }
  approvedAt: string
  basis: string
  layerAdjudication: {
    status: string
    count: number
    approvedIds: string[]
    approvedLayers: Record<string, string>
    notEnumeratedFromSources: {
      claimedByDecisionPackage: number
      sourceCertified: number
      gap: number
      note: string
    }
    note: string
  }
  ownerAssignment: {
    status: string
    canonicalOwners: Record<string, string>
    humanAssignees: Record<string, string>
    note: string
  }
  thresholds: { status: string; count: number; note: string }
  sameWaveConflicts: { status: string; count: number; note: string }
  agentBUncertainties: { status: string; count: number; note: string }
  envelopeV1_1: { status: string; note: string }
  /**
   * Maintainer-approved writer serialization (Q4(a)): per canonical-owner file,
   * the sub-wave write sequence and the explicit predecessor edges that make
   * same-wave double-writes serialized instead of CONFLICT. Absent or invalid,
   * every same-wave double-write stays a real CONFLICT (fail-closed).
   */
  writeSerialization?: {
    status: string
    count: number
    canonicalOwners: Record<string, string>
    sequences: Record<string, string[]>
    predecessorEdges: [string, string][]
    directive: string
    note: string
  }
  /**
   * Q4(b) option 2: the complete 100-ID id→exact-primaryLayer mapping, derived
   * deterministically from the committed decision-package §2 table and submitted
   * as a new canonical decision source for maintainer item-by-item approval.
   * The submission is independent of the R0 gate: layerSourceGap always measures
   * adj.layerAdjudication.notEnumeratedFromSources.gap and this field's status
   * never changes it. The layer item is resolved only when the maintainer records
   * the decision (approving this mapping or providing recovered evidence) in the
   * adjudication layer.
   */
  layerMapping?: {
    status: string
    count: number
    basis: string
    note: string
    entries: Record<string, LayerMappingEntry>
  }
  /**
   * Maintainer-approved amendments to an epic's declared deliverable path
   * (BLOCKED-001 and its class): the byte-locked registry stays unedited, and
   * this overlay records the approved substitute on-disk path a Writer targets
   * instead. Absent or invalid, a Writer must build at the registry's declared
   * path unpatched.
   */
  deliverablePathPatches?: {
    status: string
    count: number
    note: string
    entries: Record<
      string,
      { stage: 'C' | 'P' | 'U' | 'F'; declaredPath: string; approvedPath: string; reason: string; approvedAt: string; basis: string }
    >
  }
}

export interface DeliverablePathPatchCheck {
  valid: boolean
  unknownIds: string[]
  declaredPathMismatches: string[]
  emptyApprovedPath: string[]
  emptyReason: string[]
}

/**
 * Validates `adj.deliverablePathPatches` against the byte-locked registry: every
 * patched id and stage must exist in the registry, the patch's declaredPath must
 * exactly match the registry's stage file it replaces (catching a stale or
 * mistyped patch), and approvedPath/reason must be non-empty. Independent of the
 * R0 gate — a patch records a maintainer-approved deliverable-path amendment, it
 * never resolves an R0 exit-gate item.
 */
export function checkDeliverablePathPatches(reg: Registry, adj: Adjudication): DeliverablePathPatchCheck {
  const entries = adj.deliverablePathPatches?.entries ?? {}
  const regById = new Map(reg.epics.map(e => [e.id, e]))
  const unknownIds: string[] = []
  const declaredPathMismatches: string[] = []
  const emptyApprovedPath: string[] = []
  const emptyReason: string[] = []
  for (const [id, p] of Object.entries(entries)) {
    const epic = regById.get(id)
    if (epic === undefined) {
      unknownIds.push(id)
      continue
    }
    const stageFiles = epic.stages[p.stage].files
    if (!stageFiles.includes(p.declaredPath)) {
      declaredPathMismatches.push(`${id}.${p.stage}: declaredPath ${p.declaredPath} not in registry stage files`)
    }
    if (p.approvedPath.trim().length === 0) emptyApprovedPath.push(id)
    if (p.reason.trim().length === 0) emptyReason.push(id)
  }
  const valid = unknownIds.length === 0 && declaredPathMismatches.length === 0 && emptyApprovedPath.length === 0 && emptyReason.length === 0
  return { valid, unknownIds, declaredPathMismatches, emptyApprovedPath, emptyReason }
}

/** One `command-freeze.json` entry, the fields `checkSharedStageCoverage` reads. */
export interface CommandFreezeEntry {
  epic: string
  stage: 'C' | 'P' | 'U' | 'F'
  files?: string[]
  coveredStages?: { epic: string; stage: 'C' | 'P' | 'U' | 'F' }[]
}

export interface SharedStageCoverageCheck {
  valid: boolean
  /** Extra covered cell is a different epic than the entry's own primary epic. */
  crossEpic: string[]
  /** Extra covered stage owns a test file of its own in the registry — it does not need to share. */
  ownsTestFile: string[]
  /** Extra covered stage has a declared file this entry's frozen test file source never references. */
  unreferencedFiles: { stage: string; file: string }[]
}

const TEST_FILE_PATTERN = /\.(spec|e2e)\.tsx?$/

/**
 * Maintainer decision BLOCKED-002 (2026-09-01): validates a command-freeze
 * entry's `coveredStages` against the byte-locked registry and the entry's own
 * frozen test file source — never a free-text or Writer-supplied claim. Every
 * extra covered (epic, stage) beyond the entry's own primary pair must be (a)
 * the same epic, (b) a stage with no test file among its own wave-map-declared
 * `stages[stage].files` (registry.json), and (c) every one of that stage's
 * declared files present as a literal path-string inside the entry's frozen
 * test file(s) real source content. A stage that owns its own test file, or
 * whose files are never mentioned anywhere in the shared test's source, never
 * qualifies: it stays subject to B7①'s original one-cell-one-observation rule.
 *
 * This is a real but limited proxy: a bare substring match catches a file
 * the shared test never mentions at all (the main gaming vector — claiming
 * coverage for something wholly unaddressed), but a common/generic filename
 * (e.g. `package.json`) can appear for an unrelated reason (fixture
 * scaffolding) without the test actually exercising that stage's specific
 * requirement. A fresh Reviewer must still confirm each reference reflects
 * genuine behavioral coverage, not incidental mention, same as any other
 * slice's review.
 */
export function checkSharedStageCoverage(reg: Registry, entry: CommandFreezeEntry, repoRoot: string): SharedStageCoverageCheck {
  const byId = new Map(reg.epics.map(e => [e.id, e]))
  const crossEpic: string[] = []
  const ownsTestFile: string[] = []
  const unreferencedFiles: { stage: string; file: string }[] = []
  const extras = (entry.coveredStages ?? []).filter(c => !(c.epic === entry.epic && c.stage === entry.stage))
  if (extras.length === 0) return { valid: true, crossEpic, ownsTestFile, unreferencedFiles }
  const sources = (entry.files ?? []).map(f => readFileSync(join(repoRoot, f), 'utf8')).join('\n')
  for (const extra of extras) {
    const label = `${extra.epic}.${extra.stage}`
    if (extra.epic !== entry.epic) {
      crossEpic.push(label)
      continue
    }
    const epic = byId.get(extra.epic)
    if (epic === undefined) {
      crossEpic.push(label)
      continue
    }
    const extraFiles = epic.stages[extra.stage].files
    if (extraFiles.some(f => TEST_FILE_PATTERN.test(f))) {
      ownsTestFile.push(label)
      continue
    }
    for (const f of extraFiles) {
      if (!sources.includes(f)) unreferencedFiles.push({ stage: label, file: f })
    }
  }
  const valid = crossEpic.length === 0 && ownsTestFile.length === 0 && unreferencedFiles.length === 0
  return { valid, crossEpic, ownsTestFile, unreferencedFiles }
}

function readRegistry(root: string): Registry {
  const text = readFileSync(join(root, REGISTRY_PATH), 'utf8')
  return JSON.parse(text) as Registry
}

function readAdjudication(root: string): Adjudication {
  const text = readFileSync(join(root, ADJUDICATION_PATH), 'utf8')
  return JSON.parse(text) as Adjudication
}

/**
 * Composes the maintainer-approved overlay over the extracted base registry.
 * The base registry stays a byte-locked extraction of the pinned planning
 * sources (AGENT_A_PROPOSED / PENDING_MAINTAINER_ADJUDICATION /
 * UNASSIGNED_UNTIL_APPROVAL); the overlay carries the approved decisions.
 * `layerStatus` for an approved id becomes ADJUDICATED (primaryLayer
 * unchanged), `canonicalOwner` becomes the approved owner, and the R0 gate
 * figures derive from the composed state.
 */
export function composeEffective(
  reg: Registry,
  adj: Adjudication,
): {
  epicLayerStatus: Record<string, string>
  epicCanonicalOwner: Record<string, string>
  pendingLayerAdjudication: number
  unassignedOwners: number
} {
  const approved = new Set(adj.layerAdjudication.approvedIds)
  const epicLayerStatus: Record<string, string> = {}
  const epicCanonicalOwner: Record<string, string> = {}
  let unassigned = 0
  for (const e of reg.epics) {
    epicLayerStatus[e.id] = approved.has(e.id) ? 'ADJUDICATED' : e.layerStatus
    const owner = adj.ownerAssignment.canonicalOwners[e.id] ?? e.canonicalOwner
    epicCanonicalOwner[e.id] = owner
    if (owner === 'UNASSIGNED_UNTIL_APPROVAL') unassigned++
  }
  const pendingLayers = Math.max(0, reg.adjudicationPending.count - approved.size)
  return {
    epicLayerStatus,
    epicCanonicalOwner,
    pendingLayerAdjudication: pendingLayers,
    unassignedOwners: unassigned,
  }
}

/**
 * Q4(b) layer-gap resolution: validates the complete 100-ID mapping submitted
 * in `adj.layerMapping` against the byte-locked registry — every id covered
 * exactly once, every entry's exact primaryLayer equal to the registry's, every
 * entry with a non-empty rationale and a line-cited source, and a known
 * decision status. This is the fail-closed validator behind the submission for
 * maintainer item-by-item approval; it is independent of the R0 gate, which is
 * left unchanged and stays red until the maintainer records the resolution
 * (mapping approval or recovered evidence).
 */
export function checkLayerMapping(reg: Registry, adj: Adjudication): LayerMappingCheck {
  const lm = adj.layerMapping
  const status = lm?.status ?? 'MISSING'
  const approved = status === 'APPROVED'
  const entries = lm?.entries ?? {}
  const regIds = new Set(reg.epics.map(e => e.id))
  const missingIds: string[] = []
  const layerMismatches: string[] = []
  const noRationale: string[] = []
  const noSource: string[] = []
  for (const e of reg.epics) {
    const entry = entries[e.id]
    if (entry === undefined) {
      missingIds.push(e.id)
      continue
    }
    if (entry.primaryLayer !== e.primaryLayer) {
      layerMismatches.push(`${e.id}: mapping=${entry.primaryLayer} registry=${e.primaryLayer}`)
    }
    if (entry.rationale.trim().length === 0) noRationale.push(e.id)
    if (entry.source.trim().length === 0) noSource.push(e.id)
  }
  const extraIds = Object.keys(entries).filter(id => !regIds.has(id))
  const knownStatus = status === 'PROPOSED_PENDING_MAINTAINER' || status === 'APPROVED'
  const valid = knownStatus
    && missingIds.length === 0
    && extraIds.length === 0
    && layerMismatches.length === 0
    && noRationale.length === 0
    && noSource.length === 0
  return { valid, status, approved, missingIds, extraIds, layerMismatches, noRationale, noSource }
}

/** Human-readable violations from `checkLayerMapping`; empty when the mapping is valid. */
export function layerMappingIssues(check: LayerMappingCheck): string[] {
  if (check.valid) return []
  const issues: string[] = []
  if (check.status !== 'PROPOSED_PENDING_MAINTAINER' && check.status !== 'APPROVED') {
    issues.push(`layerMapping: status ${check.status} is not a known decision state`)
  }
  for (const id of check.missingIds) issues.push(`layerMapping: missing id ${id}`)
  for (const id of check.extraIds) issues.push(`layerMapping: unknown id ${id}`)
  for (const m of check.layerMismatches) issues.push(`layerMapping: ${m}`)
  for (const id of check.noRationale) issues.push(`layerMapping: ${id} lacks a rationale`)
  for (const id of check.noSource) issues.push(`layerMapping: ${id} lacks a source citation`)
  return issues
}

// ---------------------------------------------------------------------------
// Minimal deterministic YAML emitter (JSON-quoted scalars; objects/arrays only)
// ---------------------------------------------------------------------------
function yamlValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return v.map(x => yamlValue(x)).join(', ')
  return JSON.stringify(v)
}
function yaml(depth: number, obj: unknown): string[] {
  const pad = '  '.repeat(depth)
  const out: string[] = []
  if (Array.isArray(obj)) {
    for (const item of obj as unknown[]) {
      if (item !== null && typeof item === 'object') {
        // A sequence item that is a mapping: first key carries the `- ` marker,
        // every subsequent key is aligned two spaces deeper under it.
        const rec = item as Record<string, unknown>
        const keys = Object.keys(rec)
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i]
          if (key === undefined) continue
          const value = rec[key]
          const keyPad = i === 0 ? `${pad}- ${key}` : `${pad}  ${key}`
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            out.push(`${keyPad}:`)
            out.push(...yaml(depth + 1, value))
          } else if (Array.isArray(value)) {
            if (value.length === 0) {
              out.push(`${keyPad}: []`)
            } else if (value.every(x => x === null || typeof x !== 'object')) {
              out.push(`${keyPad}: [${value.map(yamlValue).join(', ')}]`)
            } else {
              out.push(`${keyPad}:`)
              out.push(...yaml(depth + 1, value))
            }
          } else {
            out.push(`${keyPad}: ${yamlValue(value)}`)
          }
        }
      } else {
        out.push(`${pad}- ${yamlValue(item)}`)
      }
    }
    return out
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${pad}${k}:`)
      out.push(...yaml(depth + 1, v))
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${pad}${k}: []`)
      } else if (v.every(x => x === null || typeof x !== 'object')) {
        out.push(`${pad}${k}: [${v.map(yamlValue).join(', ')}]`)
      } else {
        out.push(`${pad}${k}:`)
        out.push(...yaml(depth + 1, v))
      }
    } else {
      out.push(`${pad}${k}: ${yamlValue(v)}`)
    }
  }
  return out
}
function toYaml(obj: unknown): string {
  return yaml(0, obj).join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Renders (each returns the exact committed bytes)
// ---------------------------------------------------------------------------
interface OwnedFile {
  owners: string[]
  waves: number[]
  status: 'SOLE' | 'SEQUENTIAL' | 'SERIALIZED' | 'CONFLICT'
  serialization?: { canonicalOwner: string; sequence: string[] }
}
interface Ownership {
  byFile: Record<string, OwnedFile>
  conflicts: { file: string; epics: string[]; waves: number[] }[]
  counts: { sole: number; sequential: number; serialized: number; conflict: number }
}

export interface SerializationViolation {
  file: string
  reason: string
}
export interface SerializationRecord {
  canonicalOwner: string
  sequence: string[]
}
export interface WriteSerializationCheck {
  /** canonical-owner files whose recorded sequence is valid -> SERIALIZED */
  serializedFiles: Map<string, SerializationRecord>
  /** canonical-owner files whose recorded sequence is invalid -> still CONFLICT */
  conflictFiles: string[]
  violations: SerializationViolation[]
}

/** Whether `seq` is a permutation of `writers` (same members, one each). */
function isPermutation(seq: string[], writers: string[]): boolean {
  if (seq.length !== writers.length) return false
  const a = [...seq].sort()
  const b = [...writers].sort()
  return a.every((x, i) => x === b[i])
}

/**
 * Validates the maintainer-approved writer serialization (Q4(a)). A same-wave
 * double-write on a canonical-owner file is CONFLICT unless the overlay records
 * a sequence that (1) names the canonical owner first, (2) is a permutation of
 * the actual writers, and (3) gives an explicit predecessor edge for every
 * same-wave adjacent pair. Fail-closed: an absent overlay, a missing sequence,
 * a dropped writer, a non-owner first write, or a missing same-wave edge all
 * keep the file a real CONFLICT.
 */
export function checkWriteSerialization(reg: Registry, adj: Adjudication): WriteSerializationCheck {
  const ws = adj.writeSerialization
  const serializedFiles = new Map<string, SerializationRecord>()
  const conflictFiles: string[] = []
  const violations: SerializationViolation[] = []
  if (ws === undefined) return { serializedFiles, conflictFiles, violations }
  const byId = new Map(reg.epics.map(e => [e.id, e]))
  const claims: Record<string, string[]> = {}
  for (const e of reg.epics) {
    for (const f of e.files) {
      if (f.kind !== 'N' && f.kind !== 'P') continue
      ;(claims[f.path] ??= []).push(e.id)
    }
  }
  for (const [file, canonicalOwner] of Object.entries(ws.canonicalOwners)) {
    const writers = claims[file]
    const seq = ws.sequences[file]
    const problems: string[] = []
    if (writers === undefined) {
      problems.push('canonical owner declared but no N/P writer claims the file')
    } else {
      if (!writers.includes(canonicalOwner)) problems.push(`canonical owner ${canonicalOwner} is not a writer of ${file}`)
      if (seq === undefined) {
        problems.push('no write sequence recorded')
      } else {
        if (!isPermutation(seq, writers)) {
          problems.push(`sequence ${JSON.stringify(seq)} is not a permutation of writers ${JSON.stringify(writers)}`)
        }
        if (seq[0] !== canonicalOwner) {
          problems.push(`canonical owner ${canonicalOwner} must write first; sequence opens with ${seq[0] ?? '<empty>'}`)
        }
        for (let i = 1; i < seq.length; i++) {
          const prev = seq[i - 1]
          const cur = seq[i]
          if (prev === undefined || cur === undefined) continue
          const prevWave = byId.get(prev)?.wave
          const curWave = byId.get(cur)?.wave
          if (prevWave !== undefined && curWave !== undefined && prevWave === curWave) {
            const hasEdge = ws.predecessorEdges.some(([e, p]) => e === cur && p === prev)
            if (!hasEdge) problems.push(`same-wave pair ${cur} <- ${prev}: no explicit predecessor edge`)
          }
        }
      }
    }
    if (problems.length === 0 && seq !== undefined) {
      serializedFiles.set(file, { canonicalOwner, sequence: seq })
    } else {
      conflictFiles.push(file)
      for (const reason of problems) violations.push({ file, reason })
    }
  }
  conflictFiles.sort()
  return { serializedFiles, conflictFiles, violations }
}

// Ownership is over the files each epic creates (N) or modifies (P); baseline
// (B) references are shared inputs and are not owned. A file with one writer is
// SOLE. Multiple writers in strictly distinct waves is SEQUENTIAL evolution (the
// program is wave-serialized). Two writers in the same wave is a real CONFLICT —
// unless the maintainer-approved `writeSerialization` overlay (Q4(a)) records a
// valid sub-wave sequence for the file, in which case it is SERIALIZED. Without
// a valid serialization the conflict is never silently resolved.
export function computeOwnership(reg: Registry, adj?: Adjudication): Ownership {
  const claims: Record<string, { epic: string; wave: number }[]> = {}
  for (const e of reg.epics) {
    for (const f of e.files) {
      if (f.kind !== 'N' && f.kind !== 'P') continue
      const entry = claims[f.path] ?? []
      entry.push({ epic: e.id, wave: e.wave })
      claims[f.path] = entry
    }
  }
  const check = adj === undefined ? undefined : checkWriteSerialization(reg, adj)
  const serializedFiles = check?.serializedFiles ?? new Map<string, SerializationRecord>()
  const byFile: Record<string, OwnedFile> = {}
  const conflicts: Ownership['conflicts'] = []
  for (const [file, list] of Object.entries(claims)) {
    list.sort((a, b) => a.wave - b.wave)
    const owners = list.map(x => x.epic)
    const waves = list.map(x => x.wave)
    const distinct = new Set(waves).size
    const serialized = serializedFiles.get(file)
    let status: OwnedFile['status']
    if (owners.length === 1) {
      status = 'SOLE'
    } else if (serialized !== undefined) {
      status = 'SERIALIZED'
    } else if (distinct === waves.length) {
      status = 'SEQUENTIAL'
    } else {
      status = 'CONFLICT'
      conflicts.push({ file, epics: owners, waves })
    }
    const owned: OwnedFile = { owners, waves, status }
    if (serialized !== undefined) owned.serialization = serialized
    byFile[file] = owned
  }
  conflicts.sort((a, b) => a.file.localeCompare(b.file))
  return {
    byFile,
    conflicts,
    counts: {
      sole: Object.values(byFile).filter(f => f.status === 'SOLE').length,
      sequential: Object.values(byFile).filter(f => f.status === 'SEQUENTIAL').length,
      serialized: Object.values(byFile).filter(f => f.status === 'SERIALIZED').length,
      conflict: Object.values(byFile).filter(f => f.status === 'CONFLICT').length,
    },
  }
}

function renderManifestYaml(reg: Registry, adj: Adjudication): string {
  const own = computeOwnership(reg, adj)
  const eff = composeEffective(reg, adj)
  const view = {
    schema: { name: 'first100-manifest', version: '1.1', kind: 'generated-from-canonical-registry-plus-adjudication' },
    frozenBaseline: reg.frozenBaseline,
    layerEnum: reg.layerEnum,
    groupCounts: reg.groupCounts,
    waveCount: 19,
    specOwners: reg.specOwners,
    // Provenance: the pending list as extracted from the pinned sources.
    adjudicationPending: reg.adjudicationPending,
    // Approved decisions (A/B/C) + what still blocks the R0 gate.
    adjudication: {
      layerAdjudication: adj.layerAdjudication,
      layerMapping: adj.layerMapping,
      ownerAssignment: adj.ownerAssignment,
      thresholds: adj.thresholds,
      sameWaveConflicts: adj.sameWaveConflicts,
      agentBUncertainties: adj.agentBUncertainties,
      envelopeV1_1: adj.envelopeV1_1,
      writeSerialization: adj.writeSerialization,
      deliverablePathPatches: adj.deliverablePathPatches,
    },
    remainingPending: {
      sameWaveConflicts: own.conflicts.length,
      unassignedOwners: eff.unassignedOwners,
      pendingLayerAdjudication: eff.pendingLayerAdjudication,
      unapprovedThresholds: adj.thresholds.status === 'APPROVED' ? 0 : reg.thresholdProposals.filter(t => t.status === 'PROPOSED_PENDING_MAINTAINER').length,
    },
    fileOwnership: {
      writtenFiles: Object.keys(own.byFile).length,
      statusCounts: own.counts,
      conflictsPendingAdjudication: own.conflicts.length,
      conflictFiles: own.conflicts.map(c => c.file),
      serializedFiles: Object.entries(own.byFile).filter(([, f]) => f.status === 'SERIALIZED').map(([path]) => path).sort(),
    },
    epics: reg.epics.map(e => ({
      id: e.id,
      title: e.title,
      phase: e.phase,
      priority: e.priority,
      wave: e.wave,
      predecessors: e.predecessors,
      primaryLayer: e.primaryLayer,
      layerStatus: eff.epicLayerStatus[e.id],
      canonicalOwner: eff.epicCanonicalOwner[e.id],
      humanAssignee: adj.ownerAssignment.humanAssignees[e.id] ?? 'UNASSIGNED',
      acceptance: e.acceptance,
      nonGoals: e.nonGoals,
      verifyCommand: e.verifyCommand,
      files: e.files,
      stages: e.stages,
      fixtures: e.fixtures,
    })),
  }
  return toYaml(view)
}

function renderOwnerMap(reg: Registry, adj: Adjudication): string {
  const own = computeOwnership(reg, adj)
  const eff = composeEffective(reg, adj)
  const canonicalEpicOwners: Record<string, unknown> = {}
  for (const e of reg.epics) {
    canonicalEpicOwners[e.id] = {
      primaryLayer: e.primaryLayer,
      layerStatus: eff.epicLayerStatus[e.id],
      canonicalOwner: eff.epicCanonicalOwner[e.id],
      humanAssignee: adj.ownerAssignment.humanAssignees[e.id] ?? 'UNASSIGNED',
    }
  }
  // Spec artifacts are owned by their spec-owner epic. They never appear in an
  // epic's N/P files (they live in stage file lists), so emit them as their own
  // section; if one did appear as a written file it must agree with the owner.
  const specFiles: Record<string, string> = {}
  for (const [f, declared] of Object.entries(reg.specOwners)) {
    const written = own.byFile[f]
    if (written !== undefined && written.owners[0] !== declared.split('.')[0]) {
      throw new Error(`spec ${f}: declared owner ${declared} conflicts with written owner ${written.owners[0]}`)
    }
    specFiles[f] = declared
  }
  const sortedByFile: Record<string, OwnedFile> = {}
  for (const k of Object.keys(own.byFile).sort()) {
    const v = own.byFile[k]
    if (v !== undefined) sortedByFile[k] = v
  }
  return (
    JSON.stringify(
      {
        schemaVersion: '1.1',
        generatedFrom: REGISTRY_PATH,
        semantics: {
          scope: 'files each epic creates (N) or modifies (P); baseline (B) references are shared inputs, not owned',
          uniqueOwnerPerWave: 'one writer -> SOLE; writers in strictly distinct waves -> SEQUENTIAL (allowed); two writers in the same wave -> CONFLICT, PENDING_MAINTAINER_ADJUDICATION, no writer silently dropped; a same-wave double-write on a canonical-owner file with a valid maintainer-approved write sequence (Q4(a)) -> SERIALIZED, and every same-wave adjacent pair must carry an explicit predecessor edge',
        },
        writtenFiles: Object.keys(own.byFile).length,
        statusCounts: own.counts,
        byFile: sortedByFile,
        specFiles,
        canonicalEpicOwners,
        writeSerialization: {
          status: adj.writeSerialization?.status ?? 'ABSENT',
          canonicalOwners: adj.writeSerialization?.canonicalOwners ?? {},
          sequences: adj.writeSerialization?.sequences ?? {},
          predecessorEdges: adj.writeSerialization?.predecessorEdges ?? [],
        },
        conflicts: own.conflicts,
        conflictStatus: 'PENDING_MAINTAINER_ADJUDICATION',
      },
      null,
      2,
    ) + '\n'
  )
}

/** Whether an epic's verifyCommand is a real executable command, as opposed to
 * the extraction note "source has no item-level executable command" left as-is. */
export function isExplicitCommand(cmd: string | null): cmd is string {
  return cmd !== null && cmd.length > 0 && !cmd.startsWith('来源没有项级可执行命令')
}

export interface DagResult {
  acyclic: boolean
  cycle: string[] | null
  missingPredecessors: string[]
  sameWavePredecessors: string[]
}

/**
 * Real dependency-graph analysis over epic predecessors: Kahn's topological sort
 * with a lexicographic frontier (deterministic), plus a DFS that returns one
 * concrete back-edge cycle when the graph is not a DAG. `acyclic` is computed,
 * never assumed: a cycle, a missing predecessor, or a same/later-wave
 * predecessor is surfaced and reflected in the rendered artifact.
 */
export function computeDag(reg: Registry, adj?: Adjudication): DagResult {
  const byId = new Map(reg.epics.map(e => [e.id, e]))
  const serializedEdgeKeys = new Set((adj?.writeSerialization?.predecessorEdges ?? []).map(([e, p]) => `${e}<-${p}`))
  const adjacency = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const e of reg.epics) {
    adjacency.set(e.id, [])
    indegree.set(e.id, 0)
  }
  const missingPredecessors: string[] = []
  const sameWavePredecessors: string[] = []
  // Source predecessor edges.
  for (const e of reg.epics) {
    for (const p of e.predecessors) {
      const pe = byId.get(p)
      if (pe === undefined) {
        missingPredecessors.push(`${e.id} <- ${p}`)
        continue
      }
      adjacency.get(p)?.push(e.id)
      indegree.set(e.id, (indegree.get(e.id) ?? 0) + 1)
      if (pe.wave >= e.wave && !serializedEdgeKeys.has(`${e.id}<-${p}`)) sameWavePredecessors.push(`${e.id} <- ${p}`)
    }
  }
  // Maintainer-approved write-serialization edges (Q4(a)): they order same-wave
  // writers on canonical-owner files, so they participate in acyclicity but are
  // never reported as violations — they ARE the adjudication. A serialization
  // edge to an unknown id is a missing predecessor.
  for (const [eid, pid] of adj?.writeSerialization?.predecessorEdges ?? []) {
    if (!byId.has(eid)) {
      missingPredecessors.push(`${eid} <- ${pid}: write-serialization references unknown epic ${eid}`)
      continue
    }
    const pe = byId.get(pid)
    if (pe === undefined) {
      missingPredecessors.push(`${eid} <- ${pid}: write-serialization references unknown epic ${pid}`)
      continue
    }
    adjacency.get(pid)?.push(eid)
    indegree.set(eid, (indegree.get(eid) ?? 0) + 1)
  }
  const frontier = [...adjacency.keys()].filter(id => (indegree.get(id) ?? 0) === 0).sort()
  const order: string[] = []
  while (frontier.length > 0) {
    const id = frontier.shift()
    if (id === undefined) break
    order.push(id)
    for (const next of adjacency.get(id)?.slice().sort() ?? []) {
      const d = (indegree.get(next) ?? 0) - 1
      indegree.set(next, d)
      if (d === 0) frontier.push(next)
    }
    frontier.sort()
  }
  const acyclic = order.length === reg.epics.length
  return { acyclic, cycle: acyclic ? null : findCycle(reg, adjacency), missingPredecessors, sameWavePredecessors }
}

/** One concrete cycle (a back-edge path) via DFS white/gray/black marking. */
function findCycle(reg: Registry, adjacency: Map<string, string[]>): string[] | null {
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>(reg.epics.map(e => [e.id, 0]))
  const stack: string[] = []
  const dfs = (id: string): string[] | null => {
    color.set(id, GRAY)
    stack.push(id)
    for (const next of adjacency.get(id)?.slice().sort() ?? []) {
      const c = color.get(next) ?? 0
      if (c === GRAY) return [...stack.slice(stack.indexOf(next)), next]
      if (c === BLACK) continue
      const path = dfs(next)
      if (path !== null) return path
    }
    stack.pop()
    color.set(id, BLACK)
    return null
  }
  for (const e of reg.epics) {
    if ((color.get(e.id) ?? 0) === 0) {
      const path = dfs(e.id)
      if (path !== null) return path
    }
  }
  return null
}

function renderDependencyGraph(reg: Registry, adj?: Adjudication): string {
  const waves: Record<number, string[]> = {}
  for (const e of reg.epics) {
    waves[e.wave] = [...(waves[e.wave] ?? []), e.id]
  }
  const waveByEpic: Record<string, number> = {}
  const edges: { from: string; to: string }[] = []
  for (const e of reg.epics) {
    waveByEpic[e.id] = e.wave
    for (const p of e.predecessors) edges.push({ from: p, to: e.id })
  }
  // The adjudicated write-serialization edges (Q4(a)) are recorded separately
  // from source predecessor edges: they are a maintainer-approved ordering of
  // same-wave writers, not YAML-documented dependencies. acyclicity is computed
  // over the UNION so the serialization cannot hide a cycle.
  const serializedWriteEdges = (adj?.writeSerialization?.predecessorEdges ?? []).map(([from, to]) => ({ from, to }))
  const dag = computeDag(reg, adj)
  const graph = {
    schemaVersion: '1.1',
    generatedFrom: REGISTRY_PATH,
    nodes: reg.epics.length,
    edges: edges.length,
    serializedWriteEdges,
    waveByEpic,
    waves,
    acyclic: dag.acyclic,
  }
  return JSON.stringify(graph, null, 2) + '\n'
}

function renderCommandRegistry(reg: Registry): string {
  const MISSING = (wave: number) => `MISSING_UNTIL_W${wave}`
  const stageTestFiles = (stage: Stage): string[] => stage.files.filter(f => f.endsWith('.spec.ts') || f.endsWith('.e2e.ts'))
  const LANES = { C: 'contract', P: 'provider', U: 'composition', F: 'fault' } as const
  const entries: Record<string, unknown> = {}
  for (const e of reg.epics) {
    const stages: Record<string, unknown> = {}
    for (const s of ['C', 'P', 'U', 'F'] as const) {
      const stage = e.stages[s]
      if (stage.nOf) {
        stages[s] = { command: 'N/A', status: 'N/A', reason: stage.reason ?? 'n/a' }
        continue
      }
      const tests = stageTestFiles(stage)
      if (tests.length > 0) {
        stages[s] = { command: `pnpm vitest run ${tests.join(' ')}`, status: 'DERIVED_FROM_FILES' }
      } else {
        stages[s] = { command: `pnpm first100:issue --id ${e.id} --lane ${LANES[s]}`, status: 'LANE_RUNNER' }
      }
    }
    entries[e.id] = {
      epicCommand: isExplicitCommand(e.verifyCommand) ? e.verifyCommand : MISSING(e.wave),
      epicCommandStatus: isExplicitCommand(e.verifyCommand) ? 'REGISTERED' : 'MISSING_UNTIL_WAVE',
      stages,
    }
  }
  return JSON.stringify({ schemaVersion: '1.1', generatedFrom: REGISTRY_PATH, entries }, null, 2) + '\n'
}

function renderThresholdsYaml(reg: Registry): string {
  const view = {
    schemaVersion: '1.1',
    status: 'PROPOSED_PENDING_MAINTAINER',
    note: 'Binding only when maintainers approve and sign manifest v1.1; until then affected rows are BLOCKED and implementers may not tune a threshold to make a test pass.',
    thresholds: reg.thresholdProposals.map(t => ({ epic: t.epic, proposal: t.proposal })),
  }
  return toYaml(view)
}

/** Typed JSON-schema property for one evidence key. Every rule the registry note
 * states as a rejection ("unknown", "unobserved", empty-log digest, non-empty
 * skip reason, forged counts, unverified signature) is encoded as a constraint,
 * never left as prose. `exitCode`'s allowed value is coupled to `exitSemantics`
 * by the schema's top-level allOf (ACCEPTED -> 0, FAIL -> >= 1, NOT_RUN/BLOCKED
 * -> null), so inconsistent forged evidence is rejected, not described. */
function evidenceProperty(reg: Registry, entry: { key: string; note: string }): Record<string, unknown> {
  const p: Record<string, unknown> = { description: entry.note }
  switch (entry.key) {
    case 'id':
      return { ...p, type: 'string', pattern: '^P[0-8]-\\d{2}$' }
    case 'lane':
      return { ...p, type: 'string', enum: ['contract', 'provider', 'composition', 'fault'] }
    case 'baselineSha':
      return { ...p, type: 'string', const: reg.frozenBaseline.sha, pattern: '^[0-9a-f]{40}$' }
    case 'command':
      return { ...p, type: 'string', minLength: 1 }
    case 'exitCode':
      return { ...p, description: `${entry.note} Coupled to exitSemantics by the top-level allOf: ACCEPTED -> 0, FAIL -> >= 1, NOT_RUN/BLOCKED -> null.` }
    case 'rawLogPath':
      return { ...p, type: 'string', pattern: '^\\.artifacts/first100/observations/[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$' }
    case 'rawLogSha256':
      return { ...p, type: 'string', pattern: '^[0-9a-f]{64}$' }
    case 'testCounts':
      return {
        ...p,
        type: 'object',
        additionalProperties: false,
        required: ['total', 'passed', 'failed', 'skipped'],
        properties: {
          total: { type: 'integer', minimum: 1 },
          passed: { type: 'integer', minimum: 0 },
          failed: { type: 'integer', minimum: 0 },
          skipped: { type: 'integer', minimum: 0 },
        },
      }
    case 'worldStateBefore':
    case 'worldStateAfter':
      return {
        ...p,
        type: 'string',
        pattern: '^git:\\{head:[0-9a-f]{40};tree:[0-9a-f]{40};porcelainLines:[0-9]+\\}$',
      }
    case 'skipReason':
      return { ...p, type: 'string', maxLength: 0 }
    case 'exitSemantics':
      return { ...p, type: 'string', enum: ['ACCEPTED', 'FAIL', 'NOT_RUN', 'BLOCKED'] }
    case 'signature':
      return { ...p, type: 'string', pattern: '^[0-9a-f]{64,}$' }
    default:
      return { ...p, type: 'string' }
  }
}

function renderEvidenceSchema(reg: Registry): string {
  const props: Record<string, unknown> = {}
  const required: string[] = []
  for (const entry of reg.evidenceSchema) {
    required.push(entry.key)
    props[entry.key] = evidenceProperty(reg, entry)
  }
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    schemaVersion: '1.1',
    title: 'first100-evidence',
    description: '13-entry evidence schema; every per-issue observation must satisfy this and be covered by a verified detached attestation.',
    type: 'object',
    additionalProperties: false,
    required,
    properties: props,
    allOf: [
      { if: { properties: { exitSemantics: { const: 'ACCEPTED' } } }, then: { properties: { exitCode: { const: 0 } } } },
      { if: { properties: { exitSemantics: { const: 'FAIL' } } }, then: { properties: { exitCode: { type: 'integer', minimum: 1 } } } },
      { if: { properties: { exitSemantics: { enum: ['NOT_RUN', 'BLOCKED'] } } }, then: { properties: { exitCode: { type: 'null' } } } },
    ],
  }
  return JSON.stringify(schema, null, 2) + '\n'
}

function renderDigests(artifactBytes: Record<string, string>, registryBytes: string): string {
  const digests: Record<string, string> = {
    [REGISTRY_PATH]: sha256(registryBytes),
  }
  for (const [p, bytes] of Object.entries(artifactBytes)) digests[p] = sha256(bytes)
  const sorted: Record<string, string> = {}
  for (const k of Object.keys(digests).sort()) {
    const v = digests[k]
    if (v !== undefined) sorted[k] = v
  }
  return JSON.stringify({ schemaVersion: '1.1', generatedFrom: REGISTRY_PATH, digests: sorted }, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Artifact-manifest v1.1 (maintainer directive Q3/U2)
// ---------------------------------------------------------------------------

export const ARTIFACT_MANIFEST_ROLES: readonly string[] = [
  'canonical-input',
  'canonical-vendored-source',
  'derived-projection',
]

export interface ArtifactManifestRecord {
  role: string
  schemaVersion: string
  bytes: number
  sha256: string
  gitBlobOid: string
  generator: string
  sourceDigest: string | null
}

export interface ArtifactManifestV11 {
  schemaVersion: '1.1'
  kind: 'deepseek-harness-artifact-manifest'
  baselineSha: string
  candidateSha: string | null
  role: string
  note: string
  artifacts: Record<string, ArtifactManifestRecord>
}

/** Deterministic composite digest over an artifact's direct source bytes
 *  (concatenation, 0x1f-separated). Order = the caller's array order. */
export function compositeDigest(parts: readonly Uint8Array[]): string {
  const chunks: Buffer[] = []
  for (const [i, p] of parts.entries()) {
    if (i > 0) chunks.push(Buffer.from([0x1f]))
    chunks.push(Buffer.from(p))
  }
  return sha256Of(Buffer.concat(chunks))
}

/** Schema-guard a parsed artifact-manifest (ajv-equivalent narrowing). A
 *  malformed manifest is a fail-closed violation, never silently accepted. */
export function checkArtifactManifestSchema(raw: unknown): string[] {
  const out: string[] = []
  if (typeof raw !== 'object' || raw === null) return ['manifest: not an object']
  const m = raw as Record<string, unknown>
  if (m.schemaVersion !== '1.1') out.push(`manifest: schemaVersion ${JSON.stringify(m.schemaVersion)} != 1.1`)
  if (m.kind !== 'deepseek-harness-artifact-manifest') out.push(`manifest: kind ${JSON.stringify(m.kind)} != deepseek-harness-artifact-manifest`)
  if (typeof m.baselineSha !== 'string' || !/^[0-9a-f]{40}$/.test(m.baselineSha)) out.push('manifest: baselineSha not a 40-hex SHA-1')
  if (m.candidateSha !== null && (typeof m.candidateSha !== 'string' || !/^[0-9a-f]{40}$/.test(m.candidateSha))) {
    out.push('manifest: candidateSha not null or a 40-hex SHA-1')
  }
  if (typeof m.role !== 'string' || m.role.length === 0) out.push('manifest: missing role')
  if (typeof m.note !== 'string') out.push('manifest: missing note')
  if (typeof m.artifacts !== 'object' || m.artifacts === null) {
    out.push('manifest: artifacts is not an object')
    return out
  }
  const artifacts = m.artifacts as Record<string, unknown>
  for (const [path, v] of Object.entries(artifacts)) {
    if (typeof v !== 'object' || v === null) {
      out.push(`${path}: record is not an object`)
      continue
    }
    const r = v as Record<string, unknown>
    if (typeof r.role !== 'string' || !ARTIFACT_MANIFEST_ROLES.includes(r.role)) out.push(`${path}: unknown role ${JSON.stringify(r.role)}`)
    if (typeof r.schemaVersion !== 'string' || r.schemaVersion.length === 0) out.push(`${path}: missing schemaVersion`)
    if (typeof r.bytes !== 'number' || !Number.isInteger(r.bytes) || r.bytes < 0) out.push(`${path}: bytes not a non-negative integer`)
    if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) out.push(`${path}: sha256 not a 64-hex digest`)
    if (typeof r.gitBlobOid !== 'string' || !/^[0-9a-f]{40}$/.test(r.gitBlobOid)) out.push(`${path}: gitBlobOid not a 40-hex SHA-1`)
    if (typeof r.generator !== 'string' || r.generator.length === 0) out.push(`${path}: missing generator`)
    if (r.sourceDigest !== null && (typeof r.sourceDigest !== 'string' || !/^[0-9a-f]{64}$/.test(r.sourceDigest))) {
      out.push(`${path}: sourceDigest not null or a 64-hex digest`)
    }
  }
  return out
}

export interface ArtifactManifestInput {
  baselineSha: string
  candidateSha: string | null
  registryBytes: Uint8Array
  adjBytes: Uint8Array
  baseArtifacts: Record<string, string>
  /** Per derived-projection path, the composite digest of the bytes it
   *  directly derives from: the 6 registry+adjudication projections use
   *  [registry, adjudication]; the clause-coverage report uses [registry, v1.0
   *  YAML]; the digests file uses [registry, adjudication, v1.0 YAML]. */
  derivedSourceDigests: Record<string, string>
  digestsJson: string
  registrySourceBytes: Record<string, Uint8Array>
  vendoredBytes: Record<string, Uint8Array>
}

export function renderArtifactManifestV11(input: ArtifactManifestInput): string {
  const {
    baselineSha, candidateSha, registryBytes, adjBytes, baseArtifacts, derivedSourceDigests,
    digestsJson, registrySourceBytes, vendoredBytes,
  } = input
  const sourceOf = (map: Record<string, Uint8Array>, p: string): Uint8Array => {
    const b = map[p]
    if (b === undefined) throw new Error(`${p}: missing source bytes for the artifact-manifest`)
    return b
  }
  const rec = (
    role: string,
    schemaVersion: string,
    bytes: Uint8Array,
    generator: string,
    sourceDigest: string | null,
  ): ArtifactManifestRecord => ({
    role,
    schemaVersion,
    bytes: bytes.length,
    sha256: sha256Of(bytes),
    gitBlobOid: gitBlobOidOf(bytes),
    generator,
    sourceDigest,
  })
  const utf8 = (s: string): Uint8Array => Buffer.from(s, 'utf8')
  const derivedSourceOf = (p: string): string => {
    const d = derivedSourceDigests[p]
    if (d === undefined) throw new Error(`${p}: missing derived source digest for the artifact-manifest`)
    return d
  }
  const registrySource = compositeDigest(REGISTRY_SOURCE_FILES.map(p => sourceOf(registrySourceBytes, p)))

  const records: Record<string, ArtifactManifestRecord> = {
    [REGISTRY_PATH]: rec('canonical-input', '1.1', registryBytes, 'scripts/first100/extract-registry.mjs', registrySource),
    [ADJUDICATION_PATH]: rec('canonical-input', '1', adjBytes, 'maintainer-approved decisions (2026-08-25 AskUserQuestion A/B/C)', null),
  }
  for (const [p, rendered] of Object.entries(baseArtifacts)) {
    records[p] = rec('derived-projection', '1.1', utf8(rendered), 'scripts/first100/generate-specs.ts', derivedSourceOf(p))
  }
  records[DIGESTS_PATH] = rec('derived-projection', '1.1', utf8(digestsJson), 'scripts/first100/generate-specs.ts', derivedSourceOf(DIGESTS_PATH))
  for (const p of VENDORED_V10_FILES) {
    records[p] = rec('canonical-vendored-source', 'v1.0', sourceOf(vendoredBytes, p), 'external-vendored (U1 byte-for-byte from ~/Downloads)', null)
  }

  const artifacts: Record<string, ArtifactManifestRecord> = {}
  for (const p of Object.keys(records).sort()) {
    const r = records[p]
    if (r !== undefined) artifacts[p] = r
  }

  const manifest: ArtifactManifestV11 = {
    schemaVersion: '1.1',
    kind: 'deepseek-harness-artifact-manifest',
    baselineSha,
    candidateSha,
    role: 'index of the complete First-100 signed bundle',
    note: 'raw sha256 (file bytes) and gitBlobOid (git object id) are separate identities, never interchangeable; candidateSha is null until R0-7 signoff names the immutable candidate; sibling projections (owner-map/dependency-graph/command-registry) are records indexed here, never themselves an artifact-manifest',
    artifacts,
  }
  return JSON.stringify(manifest, null, 2) + '\n'
}

/** Integrity-check one manifest record against the actual file bytes (or their
 *  absence). Empty array = the record is satisfied. */
export function checkArtifactManifestRecord(rec: ArtifactManifestRecord, bytes: Uint8Array | null): string[] {
  const out: string[] = []
  if (bytes === null) {
    out.push('artifact file missing')
    return out
  }
  if (bytes.length !== rec.bytes) out.push(`bytes ${bytes.length} != manifest ${rec.bytes}`)
  if (sha256Of(bytes) !== rec.sha256) out.push('raw sha256 mismatch vs manifest (tampered)')
  if (gitBlobOidOf(bytes) !== rec.gitBlobOid) out.push('gitBlobOid mismatch vs manifest')
  return out
}

export interface ArtifactManifestVerifyResult {
  ok: boolean
  violations: string[]
}

/** Read, schema-guard, and integrity-check the committed artifact-manifest
 *  against the actual file bytes on disk. Fail closed on any anomaly. */
export function verifyArtifactManifest(root: string): ArtifactManifestVerifyResult {
  const path = join(root, ARTIFACT_MANIFEST_PATH)
  if (!existsSync(path)) return { ok: false, violations: [`${ARTIFACT_MANIFEST_PATH}: missing`] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { ok: false, violations: [`${ARTIFACT_MANIFEST_PATH}: unparseable: ${e instanceof Error ? e.message : String(e)}`] }
  }
  const schemaViolations = checkArtifactManifestSchema(parsed)
  if (schemaViolations.length > 0) return { ok: false, violations: schemaViolations }
  const manifest = parsed as ArtifactManifestV11
  const out: string[] = []
  for (const [p, rec] of Object.entries(manifest.artifacts)) {
    const full = join(root, p)
    const bytes = existsSync(full) ? readFileSync(full) : null
    for (const v of checkArtifactManifestRecord(rec, bytes)) out.push(`${p}: ${v}`)
  }
  return { ok: out.length === 0, violations: out }
}

// ---------------------------------------------------------------------------
// Clause-coverage report v1.1 (maintainer directive Q3/U3)
// ---------------------------------------------------------------------------

export type ClauseChannel = 'must' | 'acceptance' | 'nonGoals'

export interface ClauseSpan {
  startLine: number
  endLine: number
}

/** One projected clause bound to its YAML source (span + content digest).
 *  `span: null` means the clause is a documented default-boundary injection —
 *  the YAML carries no non_goals for that epic, so no source line exists. */
export interface ClauseBinding {
  text: string
  digest: string
  span: ClauseSpan | null
}

export interface InventedClause {
  text: string
  digest: string
  classification: 'documented-default-boundary' | 'undocumented'
}

export interface ClauseChannelReport {
  sourceCount: number
  projectedCount: number
  unmatchedSource: ClauseBinding[]
  invented: InventedClause[]
  clauses: ClauseBinding[]
}

export interface ClauseCoverageTotals {
  epicsMapped: number
  epicsTotal: number
  channelsMapped: number
  channelsTotal: number
  unmatchedSourceClauses: number
  inventedUndocumentedClauses: number
  inventedDocumentedDefaultBoundaryClauses: number
}

export interface ClauseCoverageReportV11 {
  schemaVersion: '1.1'
  kind: 'deepseek-harness-clause-coverage-report'
  baselineSha: string
  normalization: {
    clauseSplit: string
    canonicalize: string
    sourceSpan: string
  }
  documentedBoundaryRule: string
  totals: ClauseCoverageTotals
  epics: Record<string, { [K in ClauseChannel]: ClauseChannelReport }>
}

/** The matrix/registry's documented injection when the YAML lacks non_goals. */
const DOCUMENTED_BOUNDARY_MARKER = 'YAML 来源缺失'
const DOCUMENTED_BOUNDARY_CLAUSE = '规范化边界：不引入与本项无关的垂直业务逻辑，不扩权、不跨项偷做。'

const CHANNEL_YAML_KEYS: ReadonlyArray<readonly [ClauseChannel, string]> = [
  ['must', 'changes'],
  ['acceptance', 'acceptance_criteria'],
  ['nonGoals', 'non_goals'],
] as const

interface YamlClauseItem {
  text: string
  span: ClauseSpan
}

/** Per (id, channel): the line of each `- ` list entry plus the exclusive
 *  boundary line where the item region ends (the next `  <key>:` / `- id:` /
 *  EOF). Continuation lines of multi-line scalars (e.g. the folded
 *  P0-02/changes[0]) stay inside the preceding entry's span without being
 *  counted as entries. */
interface ClauseEntryScan {
  entryLines: number[]
  boundaryLine: number
}

/** Splits a clause block on the same separator the extractor uses (`；`),
 *  trimming and dropping empties. */
const splitClauses = (s: string): string[] => s.split('；').map(c => c.trim()).filter(c => c.length > 0)

/** Strongest comparison that still allows format-only drift: strip whitespace
 *  only. Punctuation and wording are semantic and are NOT normalized away. */
const canonicalClause = (s: string): string => s.replace(/\s+/g, '')

/** Line-scans the v1.0 YAML for `- ` list-entry lines per (id, channel). The
 *  per-channel count is cross-validated against the js-yaml parse inside
 *  scanYamlClauses (fail closed on any disagreement). */
export function scanClauseEntries(yamlText: string): Map<string, Record<ClauseChannel, ClauseEntryScan>> {
  const lines = yamlText.split('\n')
  const out = new Map<string, Record<ClauseChannel, ClauseEntryScan>>()
  let id: string | null = null
  let channel: ClauseChannel | null = null
  let entryLines: number[] = []
  const flush = (boundary: number): void => {
    if (id !== null && channel !== null) {
      let rec = out.get(id)
      if (rec === undefined) {
        rec = {
          must: { entryLines: [], boundaryLine: boundary },
          acceptance: { entryLines: [], boundaryLine: boundary },
          nonGoals: { entryLines: [], boundaryLine: boundary },
        }
        out.set(id, rec)
      }
      rec[channel] = { entryLines, boundaryLine: boundary }
    }
    entryLines = []
  }
  for (const [i, line] of lines.entries()) {
    const lineNo = i + 1
    const idMatch = /^- id: (\S+)$/.exec(line)
    if (idMatch !== null) {
      flush(lineNo)
      id = idMatch[1] ?? null
      channel = null
      continue
    }
    const keyMatch = /^  [a-z_]+:$/.exec(line)
    if (keyMatch !== null) {
      flush(lineNo)
      const key = line.slice(2, -1)
      if (key === 'changes') channel = 'must'
      else if (key === 'acceptance_criteria') channel = 'acceptance'
      else if (key === 'non_goals') channel = 'nonGoals'
      else channel = null
      continue
    }
    if (id !== null && channel !== null && /^  - /.test(line)) {
      entryLines.push(lineNo)
    }
  }
  flush(lines.length)
  return out
}

/** Merges the line-scan with the js-yaml parse (the text authority) into
 *  per-(id, channel) items carrying authoritative text and exact source spans.
 *  Fails closed when the scan and parse disagree on item count or an id is
 *  missing from the parse. */
export function scanYamlClauses(yamlText: string): Map<string, Record<ClauseChannel, YamlClauseItem[]>> {
  const entries = scanClauseEntries(yamlText)
  const parsed = parseYaml(yamlText) as { issues?: Array<Record<string, unknown>> }
  const byId = new Map((parsed.issues ?? []).map(iss => [iss.id as string, iss]))
  const out = new Map<string, Record<ClauseChannel, YamlClauseItem[]>>()
  for (const [id, chans] of entries) {
    const iss = byId.get(id)
    if (iss === undefined) throw new Error(`clause-coverage: ${id} missing from YAML parse`)
    const items = {} as Record<ClauseChannel, YamlClauseItem[]>
    for (const [channel, yamlKey] of CHANNEL_YAML_KEYS) {
      const parsedItems = (iss[yamlKey] ?? []) as unknown[]
      const scan = chans[channel]
      if (parsedItems.length !== scan.entryLines.length) {
        throw new Error(`clause-coverage: ${id}/${channel} scan ${scan.entryLines.length} entries != parse ${parsedItems.length} items`)
      }
      const list: YamlClauseItem[] = []
      for (let i = 0; i < parsedItems.length; i++) {
        const raw = parsedItems[i]
        const text = typeof raw === 'string' ? raw.trim() : ''
        const startLine = scan.entryLines[i] as number
        const nextEntry = i + 1 < scan.entryLines.length ? (scan.entryLines[i + 1] as number) : scan.boundaryLine
        list.push({ text, span: { startLine, endLine: nextEntry - 1 } })
      }
      items[channel] = list
    }
    out.set(id, items)
  }
  return out
}

/** Deterministic per-ID clause-equivalence/coverage report (U3). Proves the
 *  matrix/registry projections preserve every substantive clause of the
 *  vendored v1.0 YAML: unmatched source clauses = 0, undocumented invented
 *  clauses = 0. The 156 documented default-boundary non-goals (78 epics whose
 *  YAML lacks non_goals) are surfaced separately, never hidden. */
export function renderClauseCoverageReport(reg: Registry, yamlText: string): string {
  const scanned = scanYamlClauses(yamlText)
  const parsed = parseYaml(yamlText) as { issues?: Array<Record<string, unknown>> }
  const issues = parsed.issues ?? []
  if (issues.length !== reg.epics.length) {
    throw new Error(`clause-coverage: YAML issues ${issues.length} != registry epics ${reg.epics.length}`)
  }
  const byId = new Set(issues.map(iss => iss.id as string))

  // Fail closed unless every registry epic is present in both the YAML parse
  // and the line-scan. scanYamlClauses already cross-validates per-item counts
  // against the js-yaml parse and uses js-yaml text as the authority, so per
  // item text/line agreement here would be redundant.
  for (const e of reg.epics) {
    if (!byId.has(e.id)) throw new Error(`clause-coverage: ${e.id} missing from YAML`)
    if (!scanned.has(e.id)) throw new Error(`clause-coverage: ${e.id} missing from YAML scan`)
  }

  const epics: Record<string, { [K in ClauseChannel]: ClauseChannelReport }> = {}
  let epicsMapped = 0
  let channelsMapped = 0
  let unmatchedTotal = 0
  let undocumentedTotal = 0
  let documentedTotal = 0

  for (const e of reg.epics) {
    const channelReports = {} as { [K in ClauseChannel]: ClauseChannelReport }
    let epicFullyMapped = true
    for (const [channel, _yamlKey] of CHANNEL_YAML_KEYS) {
      const yamlSourceItems = scanned.get(e.id)?.[channel] ?? []
      const yamlClauses: string[] = []
      for (const item of yamlSourceItems) yamlClauses.push(...splitClauses(item.text))
      const projected = e[channel]
      const projectedCanon = new Set(projected.map(canonicalClause))
      const yamlCanon = new Set(yamlClauses.map(canonicalClause))
      const yamlHasChannel = yamlSourceItems.length > 0

      const unmatchedSource: ClauseBinding[] = []
      for (const item of yamlSourceItems) {
        for (const clause of splitClauses(item.text)) {
          if (!projectedCanon.has(canonicalClause(clause))) {
            unmatchedSource.push({ text: clause, digest: sha256(clause), span: item.span })
          }
        }
      }

      const invented: InventedClause[] = []
      const clauses: ClauseBinding[] = []
      for (const clause of projected) {
        const canon = canonicalClause(clause)
        const isDocumentedBoundary =
          channel === 'nonGoals' && !yamlHasChannel &&
          (clause === DOCUMENTED_BOUNDARY_MARKER || clause === DOCUMENTED_BOUNDARY_CLAUSE)
        if (yamlCanon.has(canon)) {
          let span: ClauseSpan | null = null
          for (const item of yamlSourceItems) {
            if (splitClauses(item.text).some(c => canonicalClause(c) === canon)) {
              span = item.span
              break
            }
          }
          clauses.push({ text: clause, digest: sha256(clause), span })
        } else if (isDocumentedBoundary) {
          invented.push({ text: clause, digest: sha256(clause), classification: 'documented-default-boundary' })
          clauses.push({ text: clause, digest: sha256(clause), span: null })
        } else {
          invented.push({ text: clause, digest: sha256(clause), classification: 'undocumented' })
          clauses.push({ text: clause, digest: sha256(clause), span: null })
        }
      }

      channelReports[channel] = {
        sourceCount: yamlClauses.length,
        projectedCount: projected.length,
        unmatchedSource,
        invented,
        clauses,
      }
      unmatchedTotal += unmatchedSource.length
      undocumentedTotal += invented.filter(i => i.classification === 'undocumented').length
      documentedTotal += invented.filter(i => i.classification === 'documented-default-boundary').length
      const channelMapped = unmatchedSource.length === 0 && invented.every(i => i.classification === 'documented-default-boundary')
      if (channelMapped) channelsMapped++
      if (!channelMapped) epicFullyMapped = false
    }
    epics[e.id] = channelReports
    if (epicFullyMapped) epicsMapped++
  }

  const report: ClauseCoverageReportV11 = {
    schemaVersion: '1.1',
    kind: 'deepseek-harness-clause-coverage-report',
    baselineSha: reg.frozenBaseline.sha,
    normalization: {
      clauseSplit: '；',
      canonicalize: 'strip all whitespace only — punctuation and wording are semantic, never normalized away',
      sourceSpan: 'YAML line range of the source list item (all 668 clause items are single-line); span:null = documented default-boundary injection with no YAML source',
    },
    documentedBoundaryRule:
      'first100-requirements-matrix.md line 11 — "YAML 未写 non_goals 时，明确记为来源缺失，并采用 Markdown 已注入的最小默认边界"; the registry marker "YAML 来源缺失" + the boundary clause are the only invented clauses, all classified documented-default-boundary',
    totals: {
      epicsMapped,
      epicsTotal: reg.epics.length,
      channelsMapped,
      channelsTotal: reg.epics.length * CHANNEL_YAML_KEYS.length,
      unmatchedSourceClauses: unmatchedTotal,
      inventedUndocumentedClauses: undocumentedTotal,
      inventedDocumentedDefaultBoundaryClauses: documentedTotal,
    },
    epics,
  }
  return JSON.stringify(report, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Generation / verification
// ---------------------------------------------------------------------------
export interface RenderResult {
  artifacts: Record<string, string>
  digestsJson: string
  registryBytes: string
  manifestJson: string
}

export function renderArtifacts(reg: Registry, registryBytes: string, adj: Adjudication = readAdjudication(repoRoot)): RenderResult {
  const yamlBytes = readBytesOrThrow(repoRoot, V10_MANIFEST_YAML)
  const yamlText = Buffer.from(yamlBytes).toString('utf8')
  const artifacts: Record<string, string> = {
    [ARTIFACT_PATHS[0]]: renderManifestYaml(reg, adj),
    [ARTIFACT_PATHS[1]]: renderOwnerMap(reg, adj),
    [ARTIFACT_PATHS[2]]: renderDependencyGraph(reg, adj),
    [ARTIFACT_PATHS[3]]: renderCommandRegistry(reg),
    [ARTIFACT_PATHS[4]]: renderThresholdsYaml(reg),
    [ARTIFACT_PATHS[5]]: renderEvidenceSchema(reg),
    [ARTIFACT_PATHS[6]]: renderClauseCoverageReport(reg, yamlText),
  }
  const digestsJson = renderDigests(artifacts, registryBytes)
  const registrySourceBytes: Record<string, Uint8Array> = {}
  for (const p of REGISTRY_SOURCE_FILES) registrySourceBytes[p] = readBytesOrThrow(repoRoot, p)
  const vendoredBytes: Record<string, Uint8Array> = {}
  for (const p of VENDORED_V10_FILES) vendoredBytes[p] = readBytesOrThrow(repoRoot, p)
  const registryU8 = Buffer.from(registryBytes, 'utf8')
  const adjU8 = readBytesOrThrow(repoRoot, ADJUDICATION_PATH)
  const baseSource = compositeDigest([registryU8, adjU8])
  const derivedSourceDigests: Record<string, string> = {}
  for (const p of Object.keys(artifacts)) {
    derivedSourceDigests[p] = p === ARTIFACT_PATHS[6] ? compositeDigest([registryU8, yamlBytes]) : baseSource
  }
  derivedSourceDigests[DIGESTS_PATH] = compositeDigest([registryU8, adjU8, yamlBytes])
  const manifestJson = renderArtifactManifestV11({
    baselineSha: reg.frozenBaseline.sha,
    candidateSha: null,
    registryBytes: registryU8,
    adjBytes: adjU8,
    baseArtifacts: artifacts,
    derivedSourceDigests,
    digestsJson,
    registrySourceBytes,
    vendoredBytes,
  })
  return { artifacts, digestsJson, registryBytes, manifestJson }
}

export function writeArtifacts(root: string): void {
  const reg = readRegistry(root)
  const registryBytes = readFileSync(join(root, REGISTRY_PATH), 'utf8')
  const { artifacts, digestsJson, manifestJson } = renderArtifacts(reg, registryBytes)
  for (const [p, bytes] of Object.entries(artifacts)) {
    writeFileSync(join(root, p), bytes)
  }
  writeFileSync(join(root, DIGESTS_PATH), digestsJson)
  writeFileSync(join(root, ARTIFACT_MANIFEST_PATH), manifestJson)
}

export interface VerifyResult {
  ok: boolean
  diffs: { path: string; expected: string | null; actual: string | null }[]
}

/** Regenerates in memory and compares against committed files + committed digests. */
export function verifyArtifacts(root: string): VerifyResult {
  const diffs: VerifyResult['diffs'] = []
  const registryBytes = readFileSync(join(root, REGISTRY_PATH), 'utf8')
  const reg = readRegistry(root)
  const adj = readAdjudication(root)
  const { artifacts, digestsJson } = renderArtifacts(reg, registryBytes, adj)

  for (const [p, expected] of Object.entries(artifacts)) {
    const actual = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null
    if (actual !== expected) diffs.push({ path: p, expected, actual })
  }
  const committedDigests = existsSync(join(root, DIGESTS_PATH)) ? readFileSync(join(root, DIGESTS_PATH), 'utf8') : null
  if (committedDigests !== digestsJson) diffs.push({ path: DIGESTS_PATH, expected: digestsJson, actual: committedDigests })
  return { ok: diffs.length === 0, diffs }
}

/**
 * R0 external-evidence manifest row (directive 7). Each row names ONE
 * external-evidence class the R0 gate must verify directly — native test,
 * pack/install, packaging ledger, runner receipts, independent-review
 * receipts — and binds the committed evidence file's raw SHA-256. A row whose
 * evidence is not yet captured has `sha256: null` and `status: "ABSENT"`; the
 * gate fails closed on it. `status` must equal `required` for the gate to pass.
 */
export interface R0EvidenceRow {
  item: string
  role: string
  evidence: string
  status: string
  required: string
  sha256: string | null
  note?: string
}

/** Closed status vocabulary for R0-evidence rows. */
export const R0_EVIDENCE_STATUSES: readonly string[] = [
  'EXIT_0_CAPTURED',
  'OWNERS_ASSIGNED',
  'CAPTURED',
  'OPEN',
  'ABSENT',
] as const

/** Closed set of terminal (required) statuses. */
export const R0_EVIDENCE_REQUIRED: readonly string[] = [
  'EXIT_0_CAPTURED',
  'OWNERS_ASSIGNED',
  'CAPTURED',
] as const

/**
 * Schema-guard one raw row (untyped JSON) — fail closed on unknown item/status,
 * a required status that is not terminal, or a malformed hash. Returns
 * violation strings; an empty array means the row is well-formed.
 */
export function checkR0EvidenceRowSchema(raw: unknown): string[] {
  const out: string[] = []
  if (typeof raw !== 'object' || raw === null) return ['row: not an object']
  const row = raw as Record<string, unknown>
  const item = typeof row.item === 'string' ? row.item : ''
  if (item.length === 0) out.push('row: missing item')
  if (typeof row.role !== 'string' || row.role.length === 0) out.push(`${item}: missing role`)
  if (typeof row.evidence !== 'string' || row.evidence.length === 0) out.push(`${item}: missing evidence path`)
  if (typeof row.status !== 'string' || !R0_EVIDENCE_STATUSES.includes(row.status)) {
    out.push(`${item}: unknown status ${JSON.stringify(row.status)}`)
  }
  if (typeof row.required !== 'string' || !R0_EVIDENCE_REQUIRED.includes(row.required)) {
    out.push(`${item}: required ${JSON.stringify(row.required)} is not a terminal status`)
  }
  if (row.sha256 !== null && (typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256))) {
    out.push(`${item}: sha256 not a 64-hex digest`)
  }
  if (row.note !== undefined && typeof row.note !== 'string') out.push(`${item}: note not a string`)
  return out
}

/**
 * Verify one schema-valid row against the actual committed evidence bytes (or
 * their absence). Returns violation strings; an empty array means the row is
 * satisfied. `bytes` is `null` when the evidence file does not exist.
 */
export function checkR0EvidenceRow(row: R0EvidenceRow, bytes: Uint8Array | null): string[] {
  const out: string[] = []
  if (row.sha256 === null) {
    if (bytes !== null) out.push(`${row.item}: evidence present but manifest declares no committed sha256`)
  } else {
    if (bytes === null) {
      out.push(`${row.item}: evidence file missing (${row.evidence})`)
    } else if (sha256Of(bytes) !== row.sha256) {
      out.push(`${row.item}: evidence bytes tampered — sha256 mismatch vs committed manifest (${row.evidence})`)
    }
  }
  if (row.status !== row.required) {
    out.push(`${row.item}: status ${row.status} != required ${row.required}`)
  }
  return out
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Read and schema-guard the committed R0-evidence manifest. A malformed
 * manifest (missing file / unparseable / bad rows) is a fail-closed violation,
 * never silently skipped; only schema-valid rows proceed to evidence checks.
 */
export function readR0Evidence(root: string): { rows: R0EvidenceRow[]; violations: string[] } {
  const path = join(root, R0_EVIDENCE_PATH)
  if (!existsSync(path)) return { rows: [], violations: [`${R0_EVIDENCE_PATH}: missing`] }
  let manifest: { rows?: unknown }
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as { rows?: unknown }
  } catch (e) {
    return { rows: [], violations: [`${R0_EVIDENCE_PATH}: unparseable: ${e instanceof Error ? e.message : String(e)}`] }
  }
  if (!Array.isArray(manifest.rows)) return { rows: [], violations: [`${R0_EVIDENCE_PATH}: rows is not an array`] }
  const rows: R0EvidenceRow[] = []
  const violations: string[] = []
  for (const raw of manifest.rows) {
    const issues = checkR0EvidenceRowSchema(raw)
    if (issues.length > 0) {
      violations.push(...issues)
      continue
    }
    rows.push(raw as R0EvidenceRow)
  }
  return { rows, violations }
}

/**
 * Verify the committed R0-evidence manifest DIRECTLY against the committed
 * evidence files (directive 7): schema violations first, then per-row file
 * existence + raw SHA-256 + required status. The signed envelope plays no part.
 */
export function verifyR0Evidence(root: string): string[] {
  const { rows, violations } = readR0Evidence(root)
  if (violations.length > 0) return violations
  const out: string[] = []
  for (const row of rows) {
    let bytes: Uint8Array | null = null
    if (row.sha256 !== null) {
      const p = join(root, row.evidence)
      bytes = existsSync(p) ? readFileSync(p) : null
    }
    out.push(...checkR0EvidenceRow(row, bytes))
  }
  return out
}

export interface R0GateSummary {
  conflicts: { file: string; epics: string[]; waves: number[] }[]
  unassignedOwners: number
  pendingLayerAdjudication: number
  layerSourceGap: number
  unapprovedThresholds: number
  agentBUncertainties: number
  unsignedEnvelope: boolean
  missingCommandEpics: number
  /** Direct DAG verification (directive 7): cycle/missing/same-wave predecessor issues. */
  dagIssues: string[]
  /** Direct external-evidence verification (directive 7): per-item violations from the committed manifest. */
  evidenceIssues: string[]
}

/**
 * R0 exit-gate summary. These are the items that must be resolved (via R0-7 ADR)
 * before W1 may open. Layers, owners, and thresholds are measured on the
 * composed base+adjudication state, so an approved A/B clears the layer/owner
 * counts while conflicts (4) and thresholds (17) remain. The gate also surfaces
 * the items A/B/C did NOT touch and the programmatic gate cannot verify from the
 * committed registry alone:
 *   - `layerSourceGap`: adjudicated ids enumerable only from a non-vendored
 *     transcript (adjudication.json `notEnumeratedFromSources.gap`);
 *   - `agentBUncertainties`: Agent B uncertainties not yet RESOLVED;
 *   - `unsignedEnvelope`: the v1.1 envelope not yet SIGNED. Signing is the
 *     maintainer's attestation that the external-evidence slices — R0.3A
 *     clean-branch CI/pack, R0.3B packaging migration ledger, R0.4 runner
 *     dry-validation of 100 items — are complete, so requiring SIGNED
 *     transitively requires them (the generator alone cannot verify them);
 *   - `missingCommandEpics`: epics whose verifyCommand is the extraction note
 *     rather than a real command (91 MISSING_UNTIL_WAVE today).
 *   - `dagIssues`: DIRECT DAG verification (directive 7) — computed
 *     acyclicity plus missing/same-wave predecessors, never assumed;
 *   - `evidenceIssues`: DIRECT verification (directive 7) of the external
 *     evidence items (native test, pack/install, packaging ledger, runner
 *     receipts, independent-review receipts) from the committed files bound in
 *     `spec/first100-r0-evidence.json` — a SIGNED envelope is one gate item,
 *     never a substitute for these.
 * `--check` may REPORT this summary without failing on it (byte-drift is its own
 * gate); `--r0-gate` FAILS (exit 1) while any item is unresolved.
 */
export function r0GateSummary(reg: Registry, adj: Adjudication = readAdjudication(repoRoot)): R0GateSummary {
  const own = computeOwnership(reg, adj)
  const eff = composeEffective(reg, adj)
  const thresholdsApproved = adj.thresholds.status === 'APPROVED'
  const dag = computeDag(reg, adj)
  const dagIssues: string[] = []
  if (!dag.acyclic) dagIssues.push(`DAG: cycle ${dag.cycle?.join(' -> ') ?? '<unknown>'}`)
  for (const p of dag.missingPredecessors) dagIssues.push(`DAG: missing predecessor ${p}`)
  for (const p of dag.sameWavePredecessors) dagIssues.push(`DAG: same-wave predecessor ${p}`)
  return {
    conflicts: own.conflicts,
    unassignedOwners: eff.unassignedOwners,
    pendingLayerAdjudication: eff.pendingLayerAdjudication,
    layerSourceGap: adj.layerAdjudication.notEnumeratedFromSources.gap,
    unapprovedThresholds: thresholdsApproved ? 0 : reg.thresholdProposals.filter(t => t.status === 'PROPOSED_PENDING_MAINTAINER').length,
    agentBUncertainties: adj.agentBUncertainties.status === 'RESOLVED' ? 0 : adj.agentBUncertainties.count,
    unsignedEnvelope: adj.envelopeV1_1.status !== 'SIGNED',
    missingCommandEpics: reg.epics.filter(e => !isExplicitCommand(e.verifyCommand)).length,
    dagIssues,
    evidenceIssues: verifyR0Evidence(repoRoot),
  }
}

function printR0GateSummary(summary: R0GateSummary, header: string): void {
  console.error(`${header}: ${summary.conflicts.length} same-wave conflict(s), `
    + `${summary.unassignedOwners} unassigned owner(s), `
    + `${summary.pendingLayerAdjudication} layer-adjudication-pending, `
    + `${summary.layerSourceGap} non-enumerable layer gap, `
    + `${summary.unapprovedThresholds} unapproved threshold(s), `
    + `${summary.agentBUncertainties} Agent B uncertainty(ies), `
    + `${summary.unsignedEnvelope ? 'UNSIGNED' : 'SIGNED'} v1.1 envelope, `
    + `${summary.missingCommandEpics} epic(s) without an explicit command`)
  for (const c of summary.conflicts) {
    console.error(`  conflict ${c.file} <- ${c.epics.join(', ')} (waves ${c.waves.join(', ')})`)
  }
  // Direct evidence (directive 7): each line is verified from the committed
  // files, not inferred from the envelope. A DAG or evidence issue is printed
  // and FAILs the gate independently of the envelope's status.
  for (const d of summary.dagIssues) console.error(`  ${d}`)
  for (const e of summary.evidenceIssues) console.error(`  [evidence] ${e}`)
  if (summary.dagIssues.length === 0 && summary.evidenceIssues.length === 0) {
    console.error('  [evidence] DAG + native test/pack/install/ledger/runner/review receipts all verify directly')
  }
}

// CLI
const args = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes('--r0-gate')) {
    const gate = r0GateSummary(readRegistry(repoRoot))
    const pass = gate.conflicts.length === 0
      && gate.unassignedOwners === 0
      && gate.pendingLayerAdjudication === 0
      && gate.layerSourceGap === 0
      && gate.unapprovedThresholds === 0
      && gate.agentBUncertainties === 0
      && !gate.unsignedEnvelope
      && gate.missingCommandEpics === 0
      && gate.dagIssues.length === 0
      && gate.evidenceIssues.length === 0
    if (!pass) {
      printR0GateSummary(gate, 'R0 GATE FAIL')
      console.error('R0 GATE: FAIL — resolve the items above (R0-7 maintainer approval + signed v1.1 envelope + directly verified DAG/evidence receipts) before W1 may open; exit code is non-zero')
      process.exit(1)
    }
    console.log('R0 GATE: PASS — all R0 exit-gate items resolved, DAG + external evidence receipts verified directly, and the v1.1 envelope is signed')
    process.exit(0)
  }
  if (args.includes('--check')) {
    const result = verifyArtifacts(repoRoot)
    if (!result.ok) {
      for (const d of result.diffs) {
        console.error(`DRIFT ${d.path} (expected ${d.expected === null ? '<missing>' : 'bytes'} vs committed ${d.actual === null ? '<missing>' : 'bytes'})`)
      }
      process.exit(1)
    }
    const manifestResult = verifyArtifactManifest(repoRoot)
    if (!manifestResult.ok) {
      for (const v of manifestResult.violations) console.error(`MANIFEST ${v}`)
      process.exit(1)
    }
    printR0GateSummary(r0GateSummary(readRegistry(repoRoot)), 'pending-maintainer (reported, not gating)')
    console.log(`verify: all ${Object.keys(ARTIFACT_PATHS).length + 2} generated artifacts byte-identical to canonical registry; artifact-manifest v1.1 intact`)
    process.exit(0)
  }
  writeArtifacts(repoRoot)
  console.log(`generated ${ARTIFACT_PATHS.length} artifacts + digests + artifact-manifest under spec/ from ${REGISTRY_PATH}`)
}
