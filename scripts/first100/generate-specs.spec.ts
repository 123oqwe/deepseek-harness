/**
 * Spec-artifact generation gate (R0-2).
 *
 * Proves `spec/deepseek-harness-optimization-manifest-v1.1.yaml`,
 * `spec/first100-owner-map.json`, `spec/first100-dependency-graph.json`,
 * `spec/first100-command-registry.json`, `spec/first100-thresholds.yaml`,
 * `spec/first100-evidence.schema.json`, and `spec/first100-generated-digests.json`
 * are deterministic renders of the canonical registry composed with the
 * maintainer-approved adjudication overlay (`tests/first100/adjudication.json`):
 *   - committed artifacts are byte-identical to a fresh render (no dual maintenance);
 *   - rendering is deterministic (two renders are byte-equal);
 *   - structural invariants hold (100 nodes, 13 evidence keys, 100 command entries);
 *   - the adjudication overlay carries the A (33 layers) / B (100 owners) / C
 *     (humans UNASSIGNED) approvals; the base registry stays honest (AGENT_A_PROPOSED
 *     / PENDING_MAINTAINER_ADJUDICATION / UNASSIGNED_UNTIL_APPROVAL);
 *   - the R0 exit gate honestly FAILS on the items still pending after A/B/C
 *     (0 same-wave conflicts after Q4(a) writer-serialization / 0 unassigned owners /
 *     0 layer-adjudication-pending / 1 layer source gap / 17 unapproved thresholds /
 *     4 Agent B uncertainties / UNSIGNED envelope / 91 missing commands) — the
 *     gate must not self-pass before R0-7; the 4→0 conflict drop is genuine
 *     (base registry without the overlay still reports 4), never a silence knob;
 *   - the dependency graph's acyclicity is a real topological-sort result, not a
 *     hardcoded true: a cycle, a missing predecessor, or a same-wave predecessor
 *     injected into a mutated registry is detected by the DAG analysis;
 *   - every manifest row is internally consistent: id -> layerStatus ->
 *     canonicalOwner -> humanAssignee, each compared per row (not "somewhere in
 *     the file").
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'

import {
  ARTIFACT_MANIFEST_PATH,
  V10_MANIFEST_YAML,
  checkArtifactManifestRecord,
  checkArtifactManifestSchema,
  checkLayerMapping,
  checkR0EvidenceRow,
  checkR0EvidenceRowSchema,
  checkWriteSerialization,
  computeDag,
  computeOwnership,
  composeEffective,
  layerMappingIssues,
  r0GateSummary,
  readR0Evidence,
  renderArtifacts,
  renderClauseCoverageReport,
  scanYamlClauses,
  verifyArtifactManifest,
  verifyArtifacts,
  verifyR0Evidence,
  type Adjudication,
  type ArtifactManifestRecord,
  type Registry,
  type R0EvidenceRow,
} from './generate-specs.ts'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')
const REGISTRY_PATH = 'tests/first100/registry.json'

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const readRegistry = (): { registryBytes: string; reg: Registry } => {
  const registryBytes = readFileSync(join(REPO_ROOT, REGISTRY_PATH), 'utf8')
  return { registryBytes, reg: JSON.parse(registryBytes) as Registry }
}

/** Indexing a RenderResult.artifacts record is string|undefined under noUncheckedIndexedAccess. */
function mustGet(artifacts: Record<string, string>, path: string): string {
  const v = artifacts[path]
  if (v === undefined) throw new Error(`missing rendered artifact ${path}`)
  return v
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const bytesSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const blobOid = (bytes: Uint8Array): string =>
  createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex')

/** A schema-valid artifact-manifest record over `payload`, for hermetic checks. */
function manifestRecordFixture(payload: string, overrides: Partial<ArtifactManifestRecord> = {}): ArtifactManifestRecord {
  const bytes = enc(payload)
  return {
    role: 'derived-projection',
    schemaVersion: '1.1',
    bytes: bytes.length,
    sha256: bytesSha256(bytes),
    gitBlobOid: blobOid(bytes),
    generator: 'test',
    sourceDigest: null,
    ...overrides,
  }
}

/** Writes a self-contained manifest (one indexed `spec/data.json`) under `root`. */
function writeHermeticManifest(root: string, payload: string, recordOverrides: Partial<ArtifactManifestRecord> = {}): void {
  mkdirSync(join(root, 'spec'), { recursive: true })
  const manifest = {
    schemaVersion: '1.1',
    kind: 'deepseek-harness-artifact-manifest',
    baselineSha: '0'.repeat(40),
    candidateSha: null,
    role: 'test',
    note: 'hermetic',
    artifacts: { 'spec/data.json': manifestRecordFixture(payload, recordOverrides) },
  }
  writeFileSync(join(root, ARTIFACT_MANIFEST_PATH), JSON.stringify(manifest))
}

describe('first100 spec generation', () => {
  it('green: committed spec artifacts are byte-identical to a fresh render of the registry', () => {
    const result = verifyArtifacts(REPO_ROOT)
    expect(result.ok, result.diffs.map(d => `DRIFT ${d.path}`).join('\n')).toBe(true)
    expect(result.diffs).toHaveLength(0)
  })

  it('green: rendering is deterministic (byte-equal across runs)', () => {
    const { registryBytes, reg } = readRegistry()
    const first = renderArtifacts(reg, registryBytes)
    const second = renderArtifacts(reg, registryBytes)
    expect(second.artifacts).toEqual(first.artifacts)
    expect(second.digestsJson).toBe(first.digestsJson)
  })

  it('green: the digests file matches the rendered artifacts byte-for-byte', () => {
    const { registryBytes, reg } = readRegistry()
    const { artifacts, digestsJson } = renderArtifacts(reg, registryBytes)
    const digests = JSON.parse(digestsJson) as { digests: Record<string, string> }
    for (const [path, bytes] of Object.entries(artifacts)) {
      expect(digests.digests[path]).toBe(sha256(bytes))
    }
    expect(digests.digests[REGISTRY_PATH]).toBe(sha256(registryBytes))
  })

  it('green: structural invariants hold (100 nodes, 13 evidence keys, 100 commands, 19 waves)', () => {
    const { registryBytes, reg } = readRegistry()
    const { artifacts } = renderArtifacts(reg, registryBytes)

    const graph = JSON.parse(mustGet(artifacts, 'spec/first100-dependency-graph.json')) as {
      nodes: number
      acyclic: boolean
      waves: Record<string, string[]>
    }
    expect(graph.nodes).toBe(100)
    // The committed graph's acyclicity is a real computed result, not a hardcode:
    // the artifact must agree with a fresh topological-sort analysis.
    const dag = computeDag(reg)
    expect(dag.acyclic).toBe(true)
    expect(dag.cycle).toBeNull()
    expect(dag.missingPredecessors).toEqual([])
    expect(dag.sameWavePredecessors).toEqual([])
    expect(graph.acyclic).toBe(dag.acyclic)
    expect(Object.keys(graph.waves)).toHaveLength(19)

    const evidence = JSON.parse(mustGet(artifacts, 'spec/first100-evidence.schema.json')) as { required: string[] }
    expect(evidence.required).toHaveLength(13)

    const commands = JSON.parse(mustGet(artifacts, 'spec/first100-command-registry.json')) as {
      entries: Record<string, unknown>
    }
    expect(Object.keys(commands.entries)).toHaveLength(100)
  })

  it('honesty: the evidence schema is typed, not presence-only (constraints encode the rejection rules)', () => {
    const { registryBytes, reg } = readRegistry()
    const { artifacts } = renderArtifacts(reg, registryBytes)
    const schema = JSON.parse(mustGet(artifacts, 'spec/first100-evidence.schema.json')) as {
      required: string[]
      properties: Record<string, Record<string, unknown>>
      allOf: unknown[]
    }
    expect(schema.required).toHaveLength(13)
    const props = schema.properties
    expect((props['id'] as { pattern?: string }).pattern).toBe('^P[0-8]-\\d{2}$')
    expect((props['lane'] as { enum?: string[] }).enum).toEqual(['contract', 'provider', 'composition', 'fault'])
    const baseline = props['baselineSha'] as { const?: string; pattern?: string }
    expect(baseline.const).toBe(reg.frozenBaseline.sha)
    expect(baseline.pattern).toBe('^[0-9a-f]{40}$')
    expect((props['command'] as { minLength?: number }).minLength).toBe(1)
    // exitCode is not a bare string: its value is coupled to exitSemantics by allOf.
    expect((props['exitCode'] as { type?: string }).type).toBeUndefined()
    expect(schema.allOf).toHaveLength(3)
    expect((props['rawLogPath'] as { pattern?: string }).pattern).toBeTruthy()
    expect((props['rawLogSha256'] as { pattern?: string }).pattern).toBe('^[0-9a-f]{64}$')
    expect((props['signature'] as { pattern?: string }).pattern).toBe('^[0-9a-f]{64,}$')
    const counts = props['testCounts'] as { type?: string; required?: string[] }
    expect(counts.type).toBe('object')
    expect(counts.required).toEqual(['total', 'passed', 'failed', 'skipped'])
    // Maintainer hardening (2026-08-27): world states must be well-formed
    // git:{head;tree;porcelainLines} records — "unobserved" and any old short
    // format fail the pattern, not just a literal equality check.
    const worldPattern = '^git:\\{head:[0-9a-f]{40};tree:[0-9a-f]{40};porcelainLines:[0-9]+\\}$'
    expect((props['worldStateBefore'] as { pattern?: string }).pattern).toBe(worldPattern)
    expect((props['worldStateAfter'] as { pattern?: string }).pattern).toBe(worldPattern)
    expect((props['skipReason'] as { maxLength?: number }).maxLength).toBe(0)
    expect((props['exitSemantics'] as { enum?: string[] }).enum).toEqual(['ACCEPTED', 'FAIL', 'NOT_RUN', 'BLOCKED'])
  })

  it('honesty: a cycle in a mutated registry is detected (real acyclicity)', () => {
    const { reg } = readRegistry()
    const [a, b] = reg.epics
    a!.predecessors = [b!.id]
    b!.predecessors = [a!.id]
    const dag = computeDag(reg)
    expect(dag.acyclic).toBe(false)
    expect(dag.cycle).not.toBeNull()
  })

  it('honesty: a missing predecessor in a mutated registry is detected', () => {
    const { reg } = readRegistry()
    const e = reg.epics[1]!
    e.predecessors = ['P9-99']
    const dag = computeDag(reg)
    expect(dag.missingPredecessors).toContain(`${e.id} <- P9-99`)
  })

  it('honesty: a same-wave predecessor in a mutated registry is detected', () => {
    const { reg } = readRegistry()
    const waveWithTwo = [...new Set(reg.epics.map(e => e.wave))].find(
      w => reg.epics.filter(e => e.wave === w).length >= 2,
    )!
    const [a, b] = reg.epics.filter(e => e.wave === waveWithTwo)
    b!.predecessors = [a!.id]
    const dag = computeDag(reg)
    expect(dag.sameWavePredecessors).toContain(`${b!.id} <- ${a!.id}`)
  })

  it('honesty: the R0 exit gate FAILS on the items still pending after A/B/C', () => {
    const { reg } = readRegistry()
    const gate = r0GateSummary(reg)
    // A (33 layers), B (100 owners), and Q4(a) writer-serialization are approved
    // via the overlay: gate counts are 0. The 4→0 conflict drop is genuine — the
    // base registry without the overlay still reports 4 (tested separately).
    expect(gate.conflicts).toHaveLength(0)
    expect(gate.unassignedOwners).toBe(0)
    expect(gate.pendingLayerAdjudication).toBe(0)
    // The items A/B/C did NOT touch are reported and keep the gate red.
    expect(gate.layerSourceGap).toBe(1)
    // Thresholds stay PROPOSED_PENDING_MAINTAINER (never approved): still 17.
    expect(gate.unapprovedThresholds).toBe(17)
    expect(gate.agentBUncertainties).toBe(4)
    expect(gate.unsignedEnvelope).toBe(true)
    expect(gate.missingCommandEpics).toBe(91)
    const pass = gate.conflicts.length === 0
      && gate.unassignedOwners === 0
      && gate.pendingLayerAdjudication === 0
      && gate.layerSourceGap === 0
      && gate.unapprovedThresholds === 0
      && gate.agentBUncertainties === 0
      && !gate.unsignedEnvelope
      && gate.missingCommandEpics === 0
    expect(pass).toBe(false)
  })

  it('honesty: the base registry is NOT self-approved; only the overlay carries approvals', () => {
    const { reg } = readRegistry()
    for (const t of reg.thresholdProposals) {
      expect(t.status).toBe('PROPOSED_PENDING_MAINTAINER')
    }
    expect(reg.adjudicationPending.status).toBe('PENDING_MAINTAINER')
    expect(reg.adjudicationPending.count).toBe(33)
    expect(reg.adjudicationPending.enumerated).toBe(33)
    expect(reg.adjudicationPending.notEnumeratedFromSources.gap).toBe(1)
    for (const e of reg.epics) {
      expect(['AGENT_A_PROPOSED', 'PENDING_MAINTAINER_ADJUDICATION']).toContain(e.layerStatus)
      expect(['UNASSIGNED_UNTIL_APPROVAL', e.id]).toContain(e.canonicalOwner)
    }
  })

  it('adjudication: the overlay records A/B/C and the composed state resolves layers+owners', () => {
    const { reg } = readRegistry()
    const adj = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/first100/adjudication.json'), 'utf8')) as Adjudication
    expect(adj.layerAdjudication.status).toBe('ADJUDICATED')
    expect(adj.layerAdjudication.count).toBe(33)
    expect(new Set(adj.layerAdjudication.approvedIds).size).toBe(33)
    expect(adj.layerAdjudication.approvedIds).toEqual([...reg.adjudicationPending.layerIds].sort())
    expect(adj.ownerAssignment.status).toBe('ADJUDICATED')
    expect(Object.keys(adj.ownerAssignment.canonicalOwners)).toHaveLength(100)
    for (const e of reg.epics) {
      expect(adj.ownerAssignment.canonicalOwners[e.id]).toBeTruthy()
      expect(adj.ownerAssignment.humanAssignees[e.id]).toBe('UNASSIGNED')
    }
    // 9 spec owners self-own; the other 91 are assigned to an owning package/tooling path.
    const selfOwned = Object.entries(adj.ownerAssignment.canonicalOwners).filter(([id, o]) => id === o)
    expect(selfOwned).toHaveLength(9)
    // Thresholds/conflicts/envelope stay honest in the overlay. The 4 same-wave
    // conflicts are RESOLVED only via the Q4(a) write-serialization record.
    expect(adj.thresholds.status).toBe('PROPOSED_PENDING_MAINTAINER')
    expect(adj.thresholds.count).toBe(17)
    expect(adj.sameWaveConflicts.status).toBe('RESOLVED')
    expect(adj.sameWaveConflicts.count).toBe(0)
    expect(adj.writeSerialization?.status).toBe('ADJUDICATED')
    expect(Object.keys(adj.writeSerialization?.canonicalOwners ?? {})).toHaveLength(4)
    expect(adj.envelopeV1_1.status).toBe('UNSIGNED')
  })

  const readAdjudicationForTest = (): Adjudication =>
    JSON.parse(readFileSync(join(REPO_ROOT, 'tests/first100/adjudication.json'), 'utf8')) as Adjudication
  const EXECUTION_TYPES = 'packages/execution/execution-world/src/types.ts'
  const REQUEST_TS = 'packages/subagent/subagent/src/request.ts'
  const RESULT_TS = 'packages/subagent/subagent/src/result.ts'

  it('adjudication: Q4(a) write-serialization validates all 4 same-wave files; the 4→0 drop is genuine (base registry alone still reports 4)', () => {
    const { reg } = readRegistry()
    const adj = readAdjudicationForTest()
    const check = checkWriteSerialization(reg, adj)
    expect(check.serializedFiles.size).toBe(4)
    expect(check.conflictFiles).toEqual([])
    expect(check.violations).toEqual([])
    // Base registry WITHOUT the overlay: the raw same-wave double-writes remain 4 CONFLICTs.
    expect(computeOwnership(reg).conflicts).toHaveLength(4)
    // Overlay applied: the 4 canonical-owner files become SERIALIZED; conflicts genuinely drop to 0.
    const serialized = computeOwnership(reg, adj)
    expect(serialized.conflicts).toHaveLength(0)
    expect(Object.values(serialized.byFile).filter(f => f.status === 'SERIALIZED')).toHaveLength(4)
    for (const f of Object.values(serialized.byFile)) {
      if (f.status !== 'SERIALIZED') continue
      const s = f.serialization
      if (s === undefined) continue
      expect(f.owners).toContain(s.canonicalOwner)
      expect(s.sequence[0]).toBe(s.canonicalOwner)
    }
    // The union graph (source preds + serialization edges) stays acyclic and reports no same-wave violations.
    const dag = computeDag(reg, adj)
    expect(dag.acyclic).toBe(true)
    expect(dag.sameWavePredecessors).toEqual([])
  })

  it('adjudication: dropping a writer from a recorded sequence keeps the file a CONFLICT', () => {
    const { reg } = readRegistry()
    const adj = readAdjudicationForTest()
    const ws = adj.writeSerialization
    if (ws === undefined) throw new Error('precondition: writeSerialization present')
    const mutated: Adjudication = {
      ...adj,
      writeSerialization: { ...ws, sequences: { ...ws.sequences, [EXECUTION_TYPES]: ['P3-01', 'P3-04', 'P3-05'] } },
    }
    const check = checkWriteSerialization(reg, mutated)
    expect(check.serializedFiles.size).toBe(3)
    expect(check.conflictFiles).toContain(EXECUTION_TYPES)
    expect(check.violations.some(v => v.file === EXECUTION_TYPES && v.reason.includes('not a permutation'))).toBe(true)
    expect(computeOwnership(reg, mutated).conflicts.some(c => c.file === EXECUTION_TYPES)).toBe(true)
  })

  it('adjudication: a non-canonical-owner first write keeps the file a CONFLICT', () => {
    const { reg } = readRegistry()
    const adj = readAdjudicationForTest()
    const ws = adj.writeSerialization
    if (ws === undefined) throw new Error('precondition: writeSerialization present')
    const mutated: Adjudication = {
      ...adj,
      writeSerialization: { ...ws, sequences: { ...ws.sequences, [EXECUTION_TYPES]: ['P3-09', 'P3-01', 'P3-04', 'P3-05'] } },
    }
    const check = checkWriteSerialization(reg, mutated)
    expect(check.conflictFiles).toContain(EXECUTION_TYPES)
    expect(check.violations.some(v => v.file === EXECUTION_TYPES && v.reason.includes('must write first'))).toBe(true)
    expect(computeOwnership(reg, mutated).conflicts.some(c => c.file === EXECUTION_TYPES)).toBe(true)
  })

  it('adjudication: a missing same-wave predecessor edge keeps the file a CONFLICT', () => {
    const { reg } = readRegistry()
    const adj = readAdjudicationForTest()
    const ws = adj.writeSerialization
    if (ws === undefined) throw new Error('precondition: writeSerialization present')
    const mutated: Adjudication = {
      ...adj,
      writeSerialization: {
        ...ws,
        predecessorEdges: ws.predecessorEdges.filter(([e, p]) => !(e === 'P5-08' && p === 'P5-07')),
      },
    }
    const check = checkWriteSerialization(reg, mutated)
    // The P5-08<-P5-07 edge is required by BOTH request.ts and result.ts (each
    // sequence contains the same-wave P5-07 -> P5-08 pair), so dropping it
    // fails both files closed.
    expect(check.serializedFiles.size).toBe(2)
    expect(check.conflictFiles).toContain(REQUEST_TS)
    expect(check.conflictFiles).toContain(RESULT_TS)
    expect(check.violations.some(v => v.file === REQUEST_TS && v.reason.includes('no explicit predecessor edge'))).toBe(true)
    expect(check.violations.some(v => v.file === RESULT_TS && v.reason.includes('no explicit predecessor edge'))).toBe(true)
    const owned = computeOwnership(reg, mutated)
    expect(owned.conflicts.some(c => c.file === REQUEST_TS)).toBe(true)
    expect(owned.conflicts.some(c => c.file === RESULT_TS)).toBe(true)
  })

  it('adjudication: without the write-serialization overlay every same-wave double-write stays a real CONFLICT', () => {
    const { reg } = readRegistry()
    const adj = readAdjudicationForTest()
    const withoutWs: Adjudication = JSON.parse(JSON.stringify(adj)) as Adjudication
    delete (withoutWs as { writeSerialization?: unknown }).writeSerialization
    const check = checkWriteSerialization(reg, withoutWs)
    expect(check.serializedFiles.size).toBe(0)
    expect(check.violations).toEqual([])
    expect(computeOwnership(reg, withoutWs).conflicts).toHaveLength(4)
  })

  it('adjudication: every manifest row is internally consistent (id → layerStatus → canonicalOwner → humanAssignee)', () => {
    const { registryBytes, reg } = readRegistry()
    const { artifacts } = renderArtifacts(reg, registryBytes)
    const manifest = mustGet(artifacts, 'spec/deepseek-harness-optimization-manifest-v1.1.yaml')
    const adj = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/first100/adjudication.json'), 'utf8')) as Adjudication
    const eff = composeEffective(reg, adj)
    const parsed = yaml.load(manifest) as {
      epics: { id: string; layerStatus: string; canonicalOwner: string; humanAssignee: string }[]
    }
    expect(parsed.epics).toHaveLength(100)
    const rows = new Map(parsed.epics.map(r => [r.id, r]))
    for (const e of reg.epics) {
      const row = rows.get(e.id)
      expect(row, `manifest missing row for ${e.id}`).toBeDefined()
      // Per-row exact compare: the id, layer, owner, and assignee must belong to
      // the same epic row — not merely each occur somewhere in the file.
      expect(row!.layerStatus, `${e.id} layerStatus`).toBe(eff.epicLayerStatus[e.id])
      expect(row!.canonicalOwner, `${e.id} canonicalOwner`).toBe(eff.epicCanonicalOwner[e.id])
      expect(row!.humanAssignee, `${e.id} humanAssignee`).toBe(adj.ownerAssignment.humanAssignees[e.id] ?? 'UNASSIGNED')
    }
    // The owner-map artifact is also per-epic; spot-check one approved layer + one owner.
    const ownerMap = JSON.parse(mustGet(artifacts, 'spec/first100-owner-map.json')) as {
      canonicalEpicOwners: Record<string, { layerStatus: string; canonicalOwner: string; humanAssignee: string }>
    }
    expect(Object.keys(ownerMap.canonicalEpicOwners)).toHaveLength(100)
    for (const id of adj.layerAdjudication.approvedIds) {
      expect(ownerMap.canonicalEpicOwners[id]?.layerStatus).toBe('ADJUDICATED')
    }
    expect(ownerMap.canonicalEpicOwners['P3-01']?.canonicalOwner).toBe('packages/execution/execution-world')
  })
})

describe('layer gap resolution (Q4(b) option 2: complete 100-ID mapping)', () => {
  const readAdj = (): Adjudication =>
    JSON.parse(readFileSync(join(REPO_ROOT, 'tests/first100/adjudication.json'), 'utf8')) as Adjudication

  /** Deterministic parse of the committed decision-package §2 full-mapping table. */
  const section2Rows = (): { id: string; primaryLayer: string; rationale: string; source: string; row: number }[] => {
    const lines = readFileSync(join(REPO_ROOT, 'spec/first100/sources/r0-decision-package.md'), 'utf8').split('\n')
    const header = lines.findIndex(l => /^\|\s*id\s*\|\s*primaryLayer\s*\|\s*rationale\s*\|\s*source\s*\|$/.test(l))
    expect(header).toBeGreaterThan(-1)
    const rows: { id: string; primaryLayer: string; rationale: string; source: string; row: number }[] = []
    for (let i = header + 2; i < lines.length; i++) {
      const m = /^\| (P\d+-\d+) \| (L\d+_\w+) \| (.+?) \| (.+?) \|$/.exec(lines[i]!)
      if (!m) break
      rows.push({ id: m[1]!, primaryLayer: m[2]!, rationale: m[3]!, source: m[4]!, row: i + 1 })
    }
    return rows
  }

  it('overlay layerMapping covers exactly the 100 registry ids with exact layers + rationale + source', () => {
    const { reg } = readRegistry()
    const adj = readAdj()
    expect(adj.layerMapping?.status).toBe('PROPOSED_PENDING_MAINTAINER')
    expect(adj.layerMapping?.count).toBe(100)
    const entries = adj.layerMapping?.entries ?? {}
    const ids = Object.keys(entries)
    expect(ids).toHaveLength(100)
    expect(ids).toEqual(reg.epics.map(e => e.id))
    for (const e of reg.epics) {
      const entry = entries[e.id]
      expect(entry, `entry for ${e.id}`).toBeDefined()
      expect(entry!.primaryLayer, `${e.id} exact primaryLayer`).toBe(e.primaryLayer)
      expect(entry!.rationale.trim().length).toBeGreaterThan(0)
      expect(entry!.source).toMatch(/:[0-9]+/)
    }
    // The 33 adjudicated ids agree with layerAdjudication.approvedLayers.
    for (const id of adj.layerAdjudication.approvedIds) {
      expect(entries[id]?.primaryLayer).toBe(adj.layerAdjudication.approvedLayers[id])
    }
  })

  it('overlay layerMapping is a faithful projection of the committed §2 table (reproducible from source)', () => {
    const s2 = section2Rows()
    expect(s2).toHaveLength(100)
    const entries = readAdj().layerMapping?.entries ?? {}
    for (const row of s2) {
      const entry = entries[row.id]
      expect(entry, `entry for ${row.id}`).toBeDefined()
      expect(entry!.primaryLayer, row.id).toBe(row.primaryLayer)
      expect(entry!.rationale, row.id).toBe(row.rationale)
      expect(entry!.source, row.id).toBe(row.source)
      expect(entry!.row, row.id).toBe(row.row)
    }
  })

  it('checkLayerMapping reports the committed mapping valid but unapproved (gate stays honestly red)', () => {
    const { reg } = readRegistry()
    const adj = readAdj()
    const check = checkLayerMapping(reg, adj)
    expect(check.valid).toBe(true)
    expect(check.approved).toBe(false)
    expect(check.missingIds).toEqual([])
    expect(check.extraIds).toEqual([])
    expect(check.layerMismatches).toEqual([])
    expect(check.noRationale).toEqual([])
    expect(check.noSource).toEqual([])
    expect(layerMappingIssues(check)).toEqual([])
    // The submission does NOT touch the R0 gate: layerSourceGap still measures
    // the honest transcript gap and stays 1 (resolved only by a genuine
    // maintainer decision — path-2 mapping approval or recovered evidence).
    expect(r0GateSummary(reg, adj).layerSourceGap).toBe(1)
  })

  it('fail-closed: a dropped id, mutated layer, or removed section is a violation', () => {
    const { reg } = readRegistry()
    const base = readAdj()
    const baseEntries = structuredClone(base.layerMapping?.entries ?? {})
    // Dropped id -> missing (entries rebuilt without the id).
    const dropId = reg.epics[0]!.id
    const dropped = {
      ...base,
      layerMapping: {
        ...base.layerMapping!,
        entries: Object.fromEntries(Object.entries(baseEntries).filter(([id]) => id !== dropId)),
      },
    }
    const c1 = checkLayerMapping(reg, dropped)
    expect(c1.valid).toBe(false)
    expect(c1.missingIds).toContain(dropId)
    // Mutated exact layer -> layerMismatch.
    const mutId = reg.epics[5]!.id
    const original = baseEntries[mutId]!.primaryLayer
    const other = reg.layerEnum.find(l => l !== original)!
    const mut = {
      ...base,
      layerMapping: {
        ...base.layerMapping!,
        entries: { ...baseEntries, [mutId]: { ...baseEntries[mutId]!, primaryLayer: other } },
      },
    }
    const c2 = checkLayerMapping(reg, mut)
    expect(c2.valid).toBe(false)
    expect(c2.layerMismatches.some(m => m.startsWith(mutId))).toBe(true)
    // Removed section -> all 100 missing, status MISSING.
    const { layerMapping: _removed, ...withoutLm } = base
    const c3 = checkLayerMapping(reg, withoutLm)
    expect(c3.valid).toBe(false)
    expect(c3.status).toBe('MISSING')
    expect(c3.missingIds).toHaveLength(100)
    // An APPROVED-but-broken mapping must still fail the gate closed.
    const badApprovedId = reg.epics[2]!.id
    const badApproved = {
      ...base,
      layerMapping: {
        ...base.layerMapping!,
        status: 'APPROVED',
        entries: Object.fromEntries(Object.entries(baseEntries).filter(([id]) => id !== badApprovedId)),
      },
    }
    // An APPROVED-but-broken mapping is still invalid (fail-closed at the validator).
    expect(checkLayerMapping(reg, badApproved).valid).toBe(false)
    // The committed overlay is untouched by the mutations above.
    expect(baseEntries).toEqual(base.layerMapping?.entries)
  })

  it('gate independence: the mapping submission does not alter the R0 gate; the layer item is the maintainer’s to resolve', () => {
    const { reg } = readRegistry()
    const base = readAdj()
    const gap = base.layerAdjudication.notEnumeratedFromSources.gap
    // PROPOSED (committed state): the R0 gate is unchanged — layerSourceGap is
    // the maintainer-authored measured transcript gap (1), never re-scoped by the
    // submission.
    expect(r0GateSummary(reg, base).layerSourceGap).toBe(gap)
    // Flipping the mapping status has NO effect on the gate: resolving the layer
    // item is a genuine maintainer decision (Q4(b) path-2 item-by-item approval
    // or recovered evidence), recorded by the maintainer — not a field this
    // submission toggles.
    const approved = structuredClone(base)
    approved.layerMapping!.status = 'APPROVED'
    expect(r0GateSummary(reg, approved).layerSourceGap).toBe(gap)
    // The mapping validator stays fail-closed independently of the gate: an
    // APPROVED-but-incomplete mapping is invalid.
    const stale = structuredClone(base)
    stale.layerMapping!.status = 'APPROVED'
    stale.layerMapping!.entries = {}
    expect(checkLayerMapping(reg, stale).valid).toBe(false)
  })
})

describe('first100 R0 gate direct evidence (directive 7)', () => {
  const BASELINE_SHA = 'a52bb243b8e1e7a32603797239954bb8c04702b4e0f222171c7a62650edac310'

  const rowFixture = (over: Partial<R0EvidenceRow> = {}): R0EvidenceRow => ({
    item: 'nativeTestFullSuite',
    role: 'native full-suite test receipt',
    evidence: 'docs/audit/baseline-b150a551.md',
    status: 'OPEN',
    required: 'EXIT_0_CAPTURED',
    sha256: BASELINE_SHA,
    ...over,
  })

  it('green: the committed R0-evidence manifest is schema-clean and names the honest open items directly', () => {
    expect(readR0Evidence(REPO_ROOT).violations).toEqual([])
    const issues = verifyR0Evidence(REPO_ROOT)
    // The packaging-ledger, nativeTestFullSuite (pwsh idle-inference race
    // fix, commit 2b82aba798), runnerDryReceipt (real CI dry-validate
    // capture, run 33421399399), and packInstall (real CI build+pack+verify,
    // run 33423117821) rows are terminal and pass.
    expect(issues.some(i => i.startsWith('packagingLedger'))).toBe(false)
    expect(issues.some(i => i.startsWith('nativeTestFullSuite'))).toBe(false)
    expect(issues.some(i => i.startsWith('runnerDryReceipt'))).toBe(false)
    expect(issues.some(i => i.startsWith('packInstall'))).toBe(false)
    // The genuinely open item is reported BY NAME — no envelope proxy.
    expect(issues.some(i => i.startsWith('independentReviewReceipts') && i.includes('ABSENT'))).toBe(true)
    // DAG + every external-evidence class is verified directly; the envelope is still its own item.
    const gate = r0GateSummary(readRegistry().reg)
    expect(gate.dagIssues).toEqual([])
    expect(gate.evidenceIssues.length).toBeGreaterThan(0)
    expect(gate.unsignedEnvelope).toBe(true)
  })

  it('red: tampered evidence bytes are rejected (sha256 mismatch vs the committed manifest)', () => {
    const issues = checkR0EvidenceRow(rowFixture(), new TextEncoder().encode('tampered-bytes'))
    expect(issues.some(i => i.includes('tampered'))).toBe(true)
  })

  it('red: a missing evidence file for a bound row is rejected', () => {
    const issues = checkR0EvidenceRow(rowFixture(), null)
    expect(issues.some(i => i.includes('evidence file missing'))).toBe(true)
  })

  it('red: evidence present but the manifest declares no committed sha256 is rejected', () => {
    const issues = checkR0EvidenceRow(rowFixture({ sha256: null }), new TextEncoder().encode('x'))
    expect(issues.some(i => i.includes('no committed sha256'))).toBe(true)
  })

  it('red: a non-terminal status is rejected independently of the evidence bytes', () => {
    const issues = checkR0EvidenceRow(rowFixture({ status: 'OPEN' }), new TextEncoder().encode('anything'))
    expect(issues.some(i => i.includes('status OPEN != required EXIT_0_CAPTURED'))).toBe(true)
  })

  it('red: an unknown status value is rejected by the schema guard', () => {
    const issues = checkR0EvidenceRowSchema({ item: 'x', role: 'r', evidence: 'e', status: 'BOGUS', required: 'CAPTURED', sha256: null })
    expect(issues.some(i => i.includes('unknown status'))).toBe(true)
  })

  it('red: a missing item field is rejected by the schema guard', () => {
    const issues = checkR0EvidenceRowSchema({ role: 'r', evidence: 'e', status: 'OPEN', required: 'CAPTURED', sha256: null })
    expect(issues.some(i => i.includes('missing item'))).toBe(true)
  })

  it('red: a required status that is not terminal is rejected by the schema guard', () => {
    const issues = checkR0EvidenceRowSchema({ item: 'x', role: 'r', evidence: 'e', status: 'OPEN', required: 'OPEN', sha256: null })
    expect(issues.some(i => i.includes('not a terminal status'))).toBe(true)
  })

  it('red: the R0 gate directly reports a DAG cycle injected into a mutated registry', () => {
    const { reg } = readRegistry()
    const [a, b] = reg.epics
    a!.predecessors = [b!.id]
    b!.predecessors = [a!.id]
    const gate = r0GateSummary(reg)
    expect(gate.dagIssues.some(i => i.startsWith('DAG: cycle'))).toBe(true)
  })

  // ---- artifact-manifest v1.1 (maintainer directive Q3/U2) ----

  it('green: the artifact-manifest v1.1 render is deterministic and the committed copy is intact', () => {
    const { registryBytes, reg } = readRegistry()
    const first = renderArtifacts(reg, registryBytes)
    const second = renderArtifacts(reg, registryBytes)
    expect(second.manifestJson).toBe(first.manifestJson)
    const rendered = JSON.parse(first.manifestJson) as { artifacts: Record<string, unknown> }
    const committed = JSON.parse(readFileSync(join(REPO_ROOT, ARTIFACT_MANIFEST_PATH), 'utf8')) as { artifacts: Record<string, unknown> }
    expect(Object.keys(rendered.artifacts).sort()).toEqual(Object.keys(committed.artifacts).sort())
    const verified = verifyArtifactManifest(REPO_ROOT)
    expect(verified.ok, verified.violations.join('\n')).toBe(true)
  })

  it('red: a missing indexed artifact fails closed (record checked against null bytes)', () => {
    const issues = checkArtifactManifestRecord(manifestRecordFixture('payload-v1.2'), null)
    expect(issues.some(i => i.includes('artifact file missing'))).toBe(true)
  })

  it('red: tampered bytes fail closed against the manifest record', () => {
    const issues = checkArtifactManifestRecord(manifestRecordFixture('payload-v1.2'), enc('payload-V1.2'))
    expect(issues.some(i => i.includes('raw sha256 mismatch'))).toBe(true)
    expect(issues.some(i => i.includes('gitBlobOid mismatch'))).toBe(true)
  })

  it('red: a stale sha256 in the manifest record is rejected', () => {
    const issues = checkArtifactManifestRecord(manifestRecordFixture('payload-v1.2', { sha256: '0'.repeat(64) }), enc('payload-v1.2'))
    expect(issues.some(i => i.includes('raw sha256 mismatch'))).toBe(true)
  })

  it('red: unknown schema/version, kind, role, and baselineSha are rejected by the schema guard', () => {
    const base = { schemaVersion: '1.1', kind: 'deepseek-harness-artifact-manifest', baselineSha: '0'.repeat(40), candidateSha: null, role: 'r', note: 'n', artifacts: {} }
    expect(checkArtifactManifestSchema({ ...base, schemaVersion: '2.0' }).some(i => i.includes('schemaVersion') && i.includes('2.0'))).toBe(true)
    expect(checkArtifactManifestSchema({ ...base, kind: 'other' }).some(i => i.includes('kind'))).toBe(true)
    expect(checkArtifactManifestSchema({ ...base, baselineSha: 'not-a-sha' }).some(i => i.includes('baselineSha'))).toBe(true)
    const badRole = checkArtifactManifestSchema({ ...base, artifacts: { 'spec/x.json': manifestRecordFixture('x', { role: 'bogus' }) } })
    expect(badRole.some(i => i.includes('unknown role'))).toBe(true)
  })

  it('red: verifyArtifactManifest fails closed on a tampered on-disk artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-artifact-manifest-'))
    try {
      writeHermeticManifest(root, 'payload-v1.2')
      writeFileSync(join(root, 'spec/data.json'), enc('payload-v1.2'))
      expect(verifyArtifactManifest(root).ok).toBe(true)
      writeFileSync(join(root, 'spec/data.json'), enc('payload-V1.2'))
      const result = verifyArtifactManifest(root)
      expect(result.ok).toBe(false)
      expect(result.violations.some(v => v.includes('spec/data.json') && v.includes('raw sha256 mismatch'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('red: verifyArtifactManifest fails closed on a missing indexed artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-artifact-manifest-'))
    try {
      writeHermeticManifest(root, 'payload-v1.2')
      const result = verifyArtifactManifest(root)
      expect(result.ok).toBe(false)
      expect(result.violations.some(v => v.includes('spec/data.json') && v.includes('artifact file missing'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

interface ClauseReportChannel {
  sourceCount: number
  projectedCount: number
  unmatchedSource: { text: string }[]
  invented: { text: string; classification: string }[]
  clauses: { text: string; digest: string; span: { startLine: number; endLine: number } | null }[]
}
interface ClauseReportShape {
  totals: {
    epicsMapped: number
    epicsTotal: number
    channelsMapped: number
    channelsTotal: number
    unmatchedSourceClauses: number
    inventedUndocumentedClauses: number
    inventedDocumentedDefaultBoundaryClauses: number
  }
  epics: Record<string, Record<'must' | 'acceptance' | 'nonGoals', ClauseReportChannel>>
}

describe('first100 U3 clause coverage (maintainer directive Q3/U3)', () => {
  const CLAUSE_REPORT_PATH = 'spec/first100-clause-coverage-report.json'
  const readYaml = (): string => readFileSync(join(REPO_ROOT, V10_MANIFEST_YAML), 'utf8')
  const parseReport = (json: string): ClauseReportShape => JSON.parse(json) as ClauseReportShape

  it('green: 100/100 epics mapped, 300/300 channels, unmatched=0, invented=0 undocumented / 156 documented', () => {
    const { reg } = readRegistry()
    const report = parseReport(renderClauseCoverageReport(reg, readYaml()))
    expect(report.totals).toEqual({
      epicsMapped: 100,
      epicsTotal: 100,
      channelsMapped: 300,
      channelsTotal: 300,
      unmatchedSourceClauses: 0,
      inventedUndocumentedClauses: 0,
      inventedDocumentedDefaultBoundaryClauses: 156,
    })
    expect(Object.keys(report.epics).length).toBe(100)
    for (const [id, channels] of Object.entries(report.epics)) {
      for (const name of ['must', 'acceptance', 'nonGoals'] as const) {
        const c = channels[name]
        expect(c.unmatchedSource.length, `${id}/${name} unmatched`).toBe(0)
        for (const clause of c.clauses) expect(clause.digest, `${id}/${name} digest`).toMatch(/^[0-9a-f]{64}$/)
        for (const inv of c.invented) expect(inv.classification, `${id}/${name} classification`).toBe('documented-default-boundary')
      }
    }
  })

  it('green: a multi-line folded clause item spans both lines and folds with a single space', () => {
    const yamlText = 'issues:\n- id: M-01\n  changes:\n  - 第一行开头；续到第二行\n    第二行结尾\n  - 单行项\n  acceptance_criteria:\n  - 验收一\n'
    const scanned = scanYamlClauses(yamlText)
    const must = scanned.get('M-01')?.must ?? []
    expect(must.length).toBe(2)
    expect(must[0]).toEqual({ text: '第一行开头；续到第二行 第二行结尾', span: { startLine: 4, endLine: 5 } })
    expect(must[1]).toEqual({ text: '单行项', span: { startLine: 6, endLine: 6 } })
    const acceptance = scanned.get('M-01')?.acceptance ?? []
    expect(acceptance[0]).toEqual({ text: '验收一', span: { startLine: 8, endLine: 8 } })
  })

  it('red: a registry clause dropped from an epic is reported as unmatched source', () => {
    const { reg } = readRegistry()
    const mutated: Registry = JSON.parse(JSON.stringify(reg)) as Registry
    const first = mutated.epics[0]
    if (first === undefined) throw new Error('registry has no epics')
    first.must = first.must.slice(1)
    const report = parseReport(renderClauseCoverageReport(mutated, readYaml()))
    expect(report.totals.unmatchedSourceClauses).toBeGreaterThan(0)
    expect(report.epics[first.id]?.must.unmatchedSource.length).toBeGreaterThan(0)
  })

  it('red: an injected undocumented projected clause is classified undocumented and counted', () => {
    const { reg } = readRegistry()
    const mutated: Registry = JSON.parse(JSON.stringify(reg)) as Registry
    const first = mutated.epics[0]
    if (first === undefined) throw new Error('registry has no epics')
    const injected = '未经任何来源认证的虚构 MUST 条款'
    first.must = [...first.must, injected]
    const report = parseReport(renderClauseCoverageReport(mutated, readYaml()))
    expect(report.totals.inventedUndocumentedClauses).toBe(1)
    expect(report.epics[first.id]?.must.invented.some(i => i.classification === 'undocumented' && i.text === injected)).toBe(true)
  })

  it('red: a registry epic absent from the YAML fails closed', () => {
    const { reg } = readRegistry()
    const mutated: Registry = JSON.parse(JSON.stringify(reg)) as Registry
    const first = mutated.epics[0]
    if (first === undefined) throw new Error('registry has no epics')
    mutated.epics.push({ ...first, id: 'ZZ-99' })
    expect(() => renderClauseCoverageReport(mutated, readYaml())).toThrow(/YAML issues 100 != registry epics 101/)
  })

  it('green: the manifest gives the clause-coverage report its own derived sourceDigest (registry+v1.0 YAML), distinct from the base projections and the digests file', () => {
    const { registryBytes, reg } = readRegistry()
    const rendered = renderArtifacts(reg, registryBytes)
    const manifest = JSON.parse(rendered.manifestJson) as { artifacts: Record<string, { sourceDigest: string | null }> }
    const clauseRec = manifest.artifacts[CLAUSE_REPORT_PATH]
    const baseRec = manifest.artifacts['spec/deepseek-harness-optimization-manifest-v1.1.yaml']
    const digestsRec = manifest.artifacts['spec/first100-generated-digests.json']
    expect(clauseRec?.sourceDigest).toBeTruthy()
    expect(baseRec?.sourceDigest).toBeTruthy()
    expect(digestsRec?.sourceDigest).toBeTruthy()
    expect(clauseRec?.sourceDigest).not.toBe(baseRec?.sourceDigest)
    expect(digestsRec?.sourceDigest).not.toBe(baseRec?.sourceDigest)
    expect(digestsRec?.sourceDigest).not.toBe(clauseRec?.sourceDigest)
    const committed = JSON.parse(readFileSync(join(REPO_ROOT, ARTIFACT_MANIFEST_PATH), 'utf8')) as { artifacts: Record<string, { sourceDigest: string | null }> }
    expect(committed.artifacts[CLAUSE_REPORT_PATH]?.sourceDigest).toBe(clauseRec?.sourceDigest)
  })
})
