#!/usr/bin/env node
/**
 * First-100 canonical registry extractor (R0-1, reproducible).
 *
 * Produces the canonical `tests/first100/registry.json` by deterministically
 * parsing the vendored planning sources under `spec/first100/sources/`:
 *   - first100-requirements-matrix.md      (epic fields: files, must, acceptance, non-goal, validation, command, real-task)
 *   - implementation-wave-map.md           (wave, predecessors, C/P/U/F stages with file lists, gate, rollback)
 *   - r0-decision-package.md               (§2 full primaryLayer mapping + source-certified ambiguous ids)
 *
 * The registry is the single canonical machine-readable source of truth for all
 * 100 First-100 epics. spec/ artifacts are generated from it (R0-2).
 *
 * CLI:
 *   node scripts/first100/extract-registry.mjs                     write tests/first100/registry.json
 *   node scripts/first100/extract-registry.mjs --check             regenerate in memory; byte-compare; exit 0/1
 *   --sources <dir>   source dir (default spec/first100/sources)
 *   --out <path>      output path (default tests/first100/registry.json)
 *
 * The committed registry is byte-identical to a fresh extraction from the
 * pinned vendored sources (proven by scripts/first100/registry-regenerate.spec.ts),
 * so manual dual-maintenance is impossible.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const SOURCES_DIR = arg('--sources', join(REPO_ROOT, 'spec/first100/sources'))
const OUT_PATH = arg('--out', join(REPO_ROOT, 'tests/first100/registry.json'))
const CHECK = argv.includes('--check')

// ---------------------------------------------------------------------------
// 1. Read planning sources
// ---------------------------------------------------------------------------
const matrixText = readFileSync(join(SOURCES_DIR, 'first100-requirements-matrix.md'), 'utf8')
const waveMapText = readFileSync(join(SOURCES_DIR, 'implementation-wave-map.md'), 'utf8')
const decisionText = readFileSync(join(SOURCES_DIR, 'r0-decision-package.md'), 'utf8')

const MATRIX_SHA = '401a3c63b7639b2df0f6ef81349df28667313deaa2d4f8e777d8f7eb531ce4fa'
const WAVEMAP_SHA = '8c84597f87289fe5dfbf675dcba072149c6678cecc81a2611329b42de6c56d41'
const actualMatrixSha = sha256(matrixText)
const actualWaveSha = sha256(waveMapText)
if (actualMatrixSha !== MATRIX_SHA) throw new Error(`matrix sha mismatch: ${actualMatrixSha}`)
if (actualWaveSha !== WAVEMAP_SHA) throw new Error(`wave-map sha mismatch: ${actualWaveSha}`)

/**
 * BLOCKED-037: registry epics whose provenance is `BASE-ALIGN-v2 new-gap` --
 * never derivable from the 3 canonical pinned docs above, because they
 * describe capability gaps upstream itself introduced after those docs were
 * written. The filenames and their SHAs are hardcoded here (never read from
 * `registry.json`'s own `sourcePins`, which is an OUTPUT record, not an
 * input -- letting registry data steer what the extractor consumes would
 * reopen exactly the injection BLOCKED-035 exists to close, one level up).
 * Adding a future new-gap source (e.g. a P9-class one) means adding an
 * entry to this array plus its own SHA constant -- a real, reviewed code
 * change, never a registry.json edit alone. Each is fail-closed SHA-verified
 * the same way as the 3 canonical docs; a missing/mismatched file blocks
 * extraction entirely, exactly like a canonical doc mismatch would.
 */
const NEWGAP_MATRIX_SHA = 'REPLACE_ME_WHEN_DRAFT_IS_FINALIZED'
const NEWGAP_WAVEMAP_SHA = 'REPLACE_ME_WHEN_DRAFT_IS_FINALIZED'
const NEWGAP_SOURCES = [
  { matrix: 'base-align-v2/new-gap-matrix.md', matrixSha: NEWGAP_MATRIX_SHA, waveMap: 'base-align-v2/new-gap-wavemap.md', waveMapSha: NEWGAP_WAVEMAP_SHA },
]
/**
 * Off by default: today's committed `tests/first100/registry.json` holds
 * exactly the 100 canonical epics, and BASE-ALIGN-v2's own registry-content
 * landing (P3-13 itself) is explicitly deferred until the merge tree is CI-
 * proven clean and the new-gap doc drafts pass Tier-S panel review -- this
 * flag exists so the mechanism can be built and bidirectionally verified
 * now without changing that committed file's content one byte.
 *
 * Transitional, not a permanent feature: once P3-13's draft is finalized,
 * SHA-pinned above, and actually landed in the committed registry.json
 * (making it 101 epics), this gate must be REMOVED so new-gap loading runs
 * unconditionally -- a flag someone has to remember to pass on every
 * future `--check`/regeneration is exactly the "invariant held by an
 * agent's own diligence" shape BLOCKED-034 exists to flag. Do not ship
 * this flag as a standing feature.
 */
const INCLUDE_NEW_GAP = argv.includes('--include-new-gap')

// ---------------------------------------------------------------------------
// 2. Parse the matrix
// ---------------------------------------------------------------------------
const ID_RX = /\bP([0-8])-(\d{2})\b/
const FIELD_RX = /^- \*\*(.+?)：\*\*(.*)$/

/**
 * Parse a matrix-format doc (`### P#-## — Title` headers, then
 * `- **Label：**value` fields) into `id -> {title, line, fields}`. Shared
 * by the canonical `first100-requirements-matrix.md` and any BLOCKED-037
 * new-gap matrix doc -- identical parsing, identical trust level; the only
 * difference is which SHA-pinned file is handed in.
 */
function parseMatrixText(text) {
  const matrix = new Map()
  let currentId = null
  let currentTitle = null
  let currentLine = 0
  let currentFields = null
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const head = line.match(/^###\s+(P[0-8]-\d{2})\s+[—-]\s*(.+)$/)
    if (head) {
      if (currentId) matrix.set(currentId, { title: currentTitle, line: currentLine, fields: currentFields })
      currentId = head[1]
      currentTitle = head[2].trim()
      currentLine = i + 1
      currentFields = {}
      continue
    }
    if (!currentId) continue
    const m = line.match(FIELD_RX)
    if (m) {
      const label = m[1].trim()
      const value = m[2].trim()
      // group field labels into canonical keys
      let key = null
      if (label.startsWith('Priority / Wave')) key = 'priorityWave'
      else if (label.startsWith('Files')) key = 'files'
      else if (label.startsWith('MUST')) key = 'must'
      else if (label.startsWith('明确 non-goal')) key = 'nonGoal'
      else if (label.startsWith('Acceptance')) key = 'acceptance'
      else if (label.startsWith('Validation')) key = 'validation'
      else if (label.startsWith('验证命令')) key = 'verifyCommand'
      else if (label.startsWith('真实任务证据')) key = 'realTask'
      else if (label.startsWith('规格缺口')) key = 'specGap'
      else if (label.startsWith('PrimaryLayer')) key = 'primaryLayer' // new-gap docs only; canonical epics get primaryLayer from r0-decision-package.md
      if (key) currentFields[key] = value
    }
  }
  if (currentId) matrix.set(currentId, { title: currentTitle, line: currentLine, fields: currentFields })
  return matrix
}

const matrix = parseMatrixText(matrixText)
if (matrix.size !== 100) throw new Error(`matrix: expected 100 epic sections, got ${matrix.size}`)

const newGapMatrix = new Map()
const newGapWaveMap = new Map()
if (INCLUDE_NEW_GAP) {
  for (const src of NEWGAP_SOURCES) {
    const mText = readFileSync(join(SOURCES_DIR, src.matrix), 'utf8')
    const actualSha = sha256(mText)
    if (actualSha !== src.matrixSha) throw new Error(`${src.matrix}: sha mismatch (got ${actualSha}, expected ${src.matrixSha}) -- new-gap sources are fail-closed SHA-pinned exactly like the 3 canonical docs`)
    for (const [id, entry] of parseMatrixText(mText)) newGapMatrix.set(id, entry)
  }
}

const parseFiles = (s) => {
  const out = []
  const rx = /`([^`]+)`\s*\[([BNP])\]/g
  let m
  while ((m = rx.exec(s))) out.push({ path: m[1], kind: m[2] })
  return out
}
const splitClauses = (s) => s.split('；').map((c) => c.trim()).filter((c) => c.length > 0)
const parsePriorityWave = (s) => {
  const p = s.match(/^(P[0-8])\s*\/\s*W(\d+)\s*\/\s*(.*)$/)
  if (!p) throw new Error(`cannot parse priority/wave: ${s}`)
  const depsRaw = p[3]
  const deps = []
  const rx = /`(P[0-8]-\d{2})`/g
  let m
  while ((m = rx.exec(depsRaw))) deps.push(m[1])
  if (!depsRaw.includes('无') && depsRaw.trim().length > 0 && deps.length === 0) {
    // comma/、-separated without backticks — also collect
    for (const tok of depsRaw.split(/[、,，]/)) {
      const id = tok.match(/(P[0-8]-\d{2})/)
      if (id) deps.push(id[1])
    }
  }
  return { priority: p[1], wave: Number(p[2]), deps }
}
const parseRealTask = (s) => {
  const ev = s.match(/E([0-8])/)
  const scen = [...new Set([...s.matchAll(/S(\d{2})/g)].map((mm) => `S${mm[1]}`))].sort()
  return { evidenceClass: ev ? `E${ev[1]}` : null, scenarios: scen, note: s }
}

// ---------------------------------------------------------------------------
// 3. Parse the wave map
// ---------------------------------------------------------------------------
const WAVE_HEAD_RX = /^#{2,4}\s+W(\d{1,2})\b/
const STAGE_RX = /\*\*([CPUF])(?:\((\d+)\)|=(N\/A)):\*\*/g
// Split a markdown table row on '|' but NOT inside a backtick-code span. The
// wave-map contains file lists and prose with literal pipes inside ``...``
// (e.g. P0-05's `off|shadow|enforce`), which a naive split would corrupt.
function splitMarkdownRow(s) {
  const cells = []
  let cur = ''
  let inTick = false
  for (const ch of s) {
    if (ch === '`') inTick = !inTick
    if (ch === '|' && !inTick) {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}
const FILE_TICK_RX = /`([^`]+)`/g
const KNOWN_EXT = /\.(ts|tsx|mjs|cjs|js|json|yaml|yml|md|html|css|lock)$/
const ROOT_DOTFILES = new Set(['.gitignore', '.npmrc', '.env'])
const isFilePath = (t) => {
  if (ROOT_DOTFILES.has(t)) return true
  if (KNOWN_EXT.test(t)) return true
  return t.includes('/')
}
const expandBraces = (p) => {
  const m = p.match(/^(.*)\{(.*)\}(.*)$/)
  if (!m) return [p]
  return m[2].split(',').map((alt) => `${m[1]}${alt}${m[3]}`)
}

/**
 * Parse a wave-map-format doc (`## W<n>` wave headers, then
 * `| Title | predecessors | **C(n):**... **P(n):**... **U(n):**... **F(n):**...
 * | Gate | Rollback |` table rows) into `id -> {wave, predecessors, stages,
 * gate, rollback}`. Shared by the canonical `implementation-wave-map.md`
 * and any BLOCKED-037 new-gap wave-map doc -- identical parsing, identical
 * trust level, identical stage file-count consistency check.
 */
function parseWaveMapText(text) {
  const waveMap = new Map()
  let wave = null
  for (const raw of text.split('\n')) {
    const wh = raw.match(WAVE_HEAD_RX)
    if (wh && Number(wh[1]) >= 1 && Number(wh[1]) <= 19) {
      wave = Number(wh[1])
      continue
    }
    // canonical epic table row: | P0-01 — title | predecessor | stages | gate | rollback |
    const row = raw.match(/^\|\s*(P[0-8]-\d{2})\s+[—-]\s*(.+?)\s*\|(.+)$/)
    if (row && wave !== null) {
      const id = row[1]
      const cells = splitMarkdownRow(row[3])
      // cells[0] = title remainder (may be empty since title was captured in row[2]); then predecessor, stages, gate, rollback
      const predecessorCell = cells[0] ?? ''
      const stageCell = cells[1] ?? ''
      const gateCell = cells[2] ?? ''
      const rollbackCell = cells[3] ?? ''
      const predecessors = predecessorCell === '—' || predecessorCell === '' || predecessorCell === '无'
        ? []
        : [...new Set([...predecessorCell.matchAll(/P[0-8]-\d{2}/g)].map((m) => m[0]))]
      const stages = {}
      STAGE_RX.lastIndex = 0
      const segs = []
      let m
      while ((m = STAGE_RX.exec(stageCell))) segs.push({ key: m[1], na: m[3] === 'N/A', count: m[3] === 'N/A' ? null : Number(m[2]), pos: m.index })
      for (let i = 0; i < segs.length; i++) {
        const end = i + 1 < segs.length ? segs[i + 1].pos : stageCell.length
        const body = stageCell.slice(segs[i].pos, end)
        const fileMatches = []
        FILE_TICK_RX.lastIndex = 0
        let fm
        while ((fm = FILE_TICK_RX.exec(body))) {
          if (isFilePath(fm[1])) fileMatches.push(fm[1])
        }
        const files = fileMatches.flatMap(expandBraces)
        let reason = null
        if (segs[i].na) {
          reason = body.replace(/\*\*P=N\/A:\*\*/, '').replace(/`[^`]+`/g, '').replace(/^\s*[—\-–]\s*/, '').trim()
          if (!reason) reason = 'kernel/reference-monitor or static rule, not a replaceable provider'
        }
        stages[segs[i].key] = segs[i].na
          ? { nOf: 'N/A', reason, files: [], count: 0 }
          : { nOf: null, files, count: files.length }
      }
      // stage file-count consistency: declared count must equal expanded count
      for (const k of ['C', 'P', 'U', 'F']) {
        if (stages[k] && !stages[k].nOf && stages[k].count !== segs.find((s) => s.key === k)?.count) {
          throw new Error(`${id} stage ${k}: declared count ${segs.find((s) => s.key === k)?.count} != expanded ${stages[k].count}`)
        }
      }
      waveMap.set(id, { wave, predecessors, stages, gate: gateCell, rollback: rollbackCell })
    }
  }
  return waveMap
}

const waveMap = parseWaveMapText(waveMapText)
if (INCLUDE_NEW_GAP) {
  for (const src of NEWGAP_SOURCES) {
    const wText = readFileSync(join(SOURCES_DIR, src.waveMap), 'utf8')
    const actualSha = sha256(wText)
    if (actualSha !== src.waveMapSha) throw new Error(`${src.waveMap}: sha mismatch (got ${actualSha}, expected ${src.waveMapSha}) -- new-gap sources are fail-closed SHA-pinned exactly like the 3 canonical docs`)
    for (const [id, entry] of parseWaveMapText(wText)) newGapWaveMap.set(id, entry)
  }
}

if (waveMap.size !== 100) throw new Error(`wave-map: expected 100 epic rows, got ${waveMap.size}`)
const wavesUsed = [...new Set([...waveMap.values()].map((e) => e.wave))].sort((a, b) => a - b)
if (wavesUsed.length !== 19 || wavesUsed[0] !== 1 || wavesUsed[18] !== 19) {
  throw new Error(`wave-map: expected waves 1..19, got ${wavesUsed.join(',')}`)
}

/**
 * Merge new-gap epics into the SAME Maps the canonical 100 already live in,
 * strictly AFTER every canonical-count/wave-coverage assertion above has
 * already run against the unmerged 100 -- so those checks keep validating
 * exactly what they always validated, unaffected by anything added here.
 * From this point on, the epic-assembly loop below runs unchanged over
 * every id in `matrix`/`waveMap`: a new-gap epic is built through the exact
 * same code path as a canonical one, not a parallel or looser one.
 */
const newGapEpicIds = new Set(newGapMatrix.keys())
for (const id of newGapEpicIds) {
  if (!newGapWaveMap.has(id)) throw new Error(`${id}: present in a new-gap matrix doc but missing from its wave-map companion`)
  if (matrix.has(id)) throw new Error(`${id}: new-gap epic id collides with an existing canonical epic id`)
}
for (const [id, entry] of newGapMatrix) matrix.set(id, entry)
for (const [id, entry] of newGapWaveMap) waveMap.set(id, entry)

// ---------------------------------------------------------------------------
// 4. Parse the decision package (primaryLayer + source-certified ambiguous ids)
// ---------------------------------------------------------------------------
const LAYER_ENUM = ['L0_KERNEL', 'L1_CONTRACT', 'L2_PROVIDER', 'L3_CONSUMER', 'L4_COMPOSITION', 'L5_SURFACE', 'L6_QUALIFICATION']
const layerById = new Map()
let inMapping = false
for (const raw of decisionText.split('\n')) {
  if (raw.includes('### Full mapping (100 rows)')) { inMapping = true; continue }
  if (raw.includes('### Layer adjudication list')) { inMapping = false; break }
  if (inMapping) {
    const m = raw.match(/^\|\s*(P[0-8]-\d{2})\s*\|\s*(L[0-6]_[A-Z_]+)\s*\|/)
    if (m) layerById.set(m[1], m[2])
  }
}
if (layerById.size !== 100) throw new Error(`decision package: expected 100 layer rows, got ${layerById.size}`)

// Decision package §2.3 enumerates 32 ambiguous ids in a backtick-delimited list.
const ambiguous = new Set()
for (const raw of decisionText.split('\n')) {
  const m = raw.match(/^`(P[0-8]-\d{2}(?:, P[0-8]-\d{2})+)`/)
  if (m) for (const id of m[1].split(',')) ambiguous.add(id.trim())
}
if (ambiguous.size !== 32) throw new Error(`expected 32 explicit ambiguous ids from decision package §2.3, got ${ambiguous.size}`)
// §2.3 names the wave-map-vs-architecture-audit §5 seam and the L1-vs-L6 / L1-vs-L2 seams.
// Every id named there is deterministically ambiguous; add any not already listed
// (currently exactly P2-09, so the source-certified set is 33).
const seamText = decisionText.split('\n').find((l) => l.includes('The dominant conflict is')) ?? ''
for (const id of seamText.matchAll(/\bP[0-8]-\d{2}\b/g)) ambiguous.add(id[0])
if (ambiguous.size < 33) throw new Error(`expected at least 33 source-certified ambiguous ids (32 explicit + seam-derived), got ${ambiguous.size}`)

// ---------------------------------------------------------------------------
// 5. Spec owners (triple-confirmed) and threshold proposals
// ---------------------------------------------------------------------------
const SPEC_OWNERS = {
  'spec/trust-kernel.md': 'P0-02.C',
  'spec/capability-manifest.schema.json': 'P1-01.C',
  'spec/action-manifest.schema.json': 'P2-03.C',
  'spec/task-profile.schema.json': 'P4-02.C',
  'spec/run-plan.schema.json': 'P4-03.C',
  'spec/verification-contract.schema.json': 'P7-01.C',
  'spec/outcome-package.schema.json': 'P7-05.C',
  'spec/control-protocol.schema.json': 'P8-01.C',
  'spec/release-gates.yaml': 'P8-10.C',
}
const specOwnerEpics = new Set(Object.values(SPEC_OWNERS).map((o) => o.split('.')[0]))
if (specOwnerEpics.size !== 9) throw new Error('spec owner epics must be exactly 9')

// thresholds from wave-map §2.2 (16 rows incl. Real-model claims)
const thresholdProposals = []
let inThresholds = false
for (const raw of waveMapText.split('\n')) {
  if (raw.startsWith('| Epic | Proposed v1.1 threshold |')) { inThresholds = true; continue }
  if (inThresholds) {
    if (raw.startsWith('## ') || raw.startsWith('| Micro-PR')) { inThresholds = false; continue }
    const m = raw.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/)
    if (m && m[1].trim() !== '---') thresholdProposals.push({ epic: m[1].trim(), proposal: m[2].trim(), status: 'PROPOSED_PENDING_MAINTAINER' })
  }
}
if (thresholdProposals.length < 15) throw new Error(`expected >=15 threshold proposals, got ${thresholdProposals.length}`)

// 13-entry evidence schema derived from decision package §4.2/§4.3/§5.1.5/§5.2
const EVIDENCE_SCHEMA = [
  { key: 'id', required: true, note: 'issue id; must equal ${id}.${lane}.json filename id' },
  { key: 'lane', required: true, enum: ['contract', 'provider', 'composition', 'fault'], note: 'must equal filename lane; all 4 lanes required per issue' },
  { key: 'baselineSha', required: true, frozen: '0a53fb55bea101816fa226bb964ae2bed71c343b', note: '"unknown" rejected' },
  { key: 'command', required: true, note: 'exact real command executed' },
  { key: 'exitCode', required: true, note: 'real exit code; per-issue exitSemantics enforced' },
  { key: 'rawLogPath', required: true, note: 'confined to .artifacts/first100/observations/; non-zero size; no path traversal' },
  { key: 'rawLogSha256', required: true, note: 'digest of the raw log; empty-log sha rejected' },
  { key: 'testCounts', required: true, note: 'parsed from raw log: pass/fail/skip/total with total>0; fabrication rejected' },
  { key: 'worldStateBefore', required: true, note: '"unobserved" rejected' },
  { key: 'worldStateAfter', required: true, note: '"unobserved" rejected' },
  { key: 'skipReason', required: true, note: 'must be empty on success; non-empty skipReason rejected and never injected' },
  { key: 'exitSemantics', required: true, note: 'per-issue mapping FAIL/NOT_RUN/BLOCKED/ACCEPTED; model/executor self-report never constitutes evidence' },
  { key: 'signature', required: true, note: 'detached attestation over canonical serialization of all fields, verified against pinned trusted identity; ACCEPTED only on verified attestation' },
]

// ---------------------------------------------------------------------------
// 6. Assemble the registry
// ---------------------------------------------------------------------------
const groupCounts = {}
const newGapCounts = {}
const epics = []
const ids = [...matrix.keys()].sort()

for (const id of ids) {
  const { title, line, fields } = matrix.get(id)
  const isNewGap = newGapEpicIds.has(id)
  const { priority, wave, deps } = parsePriorityWave(fields.priorityWave || '')
  const wm = waveMap.get(id)
  if (!wm) throw new Error(`${id}: missing wave-map row`)
  // Canonical epics get primaryLayer from r0-decision-package.md's independent
  // mapping table; a new-gap epic has no entry there (it postdates that doc),
  // so it declares its own PrimaryLayer field directly in its matrix source.
  const layer = isNewGap ? fields.primaryLayer : layerById.get(id)
  if (!layer) throw new Error(`${id}: missing layer`)
  // phase comes from the ID prefix (P0-01 → phase 0); matrix `priority` is a priority class.
  const phaseNum = Number(id[1])
  // groupCounts stays exactly what it always meant -- the 100 canonical
  // epics only, checked against EXPECTED_COUNTS below unaffected by
  // anything new-gap. New-gap epics get their own, separately-labeled
  // count so nothing here silently changes an existing field's meaning.
  if (isNewGap) newGapCounts[`P${phaseNum}`] = (newGapCounts[`P${phaseNum}`] || 0) + 1
  else groupCounts[`P${phaseNum}`] = (groupCounts[`P${phaseNum}`] || 0) + 1

  const must = splitClauses(fields.must || '')
  const acceptance = splitClauses(fields.acceptance || '')
  const nonGoals = splitClauses(fields.nonGoal || '')
  const validation = splitClauses(fields.validation || '')
  if (acceptance.length === 0) throw new Error(`${id}: empty acceptance`)
  if (nonGoals.length === 0) throw new Error(`${id}: empty nonGoals`)

  // wave-map predecessors are authoritative; matrix deps retained as declared
  const declaredDeps = wm.predecessors.length ? wm.predecessors : deps
  const realTask = parseRealTask(fields.realTask || '')

  const epic = {
    id,
    title,
    phase: phaseNum,
    priority,
    wave: wm.wave,
    predecessors: declaredDeps,
    primaryLayer: layer,
    layerSource: isNewGap ? 'base-align-v2/new-gap-matrix.md (delegate-confirmed)' : 'r0-decision-package.md §2 full mapping (Agent A)',
    layerStatus: isNewGap ? 'DELEGATE_CONFIRMED' : ambiguous.has(id) ? 'PENDING_MAINTAINER_ADJUDICATION' : 'AGENT_A_PROPOSED',
    canonicalOwner: specOwnerEpics.has(id) ? id : 'UNASSIGNED_UNTIL_APPROVAL',
    files: parseFiles(fields.files || ''),
    must,
    acceptance,
    nonGoals,
    acceptanceSource: isNewGap
      ? { path: 'base-align-v2/new-gap-matrix.md', sha256: NEWGAP_MATRIX_SHA, line }
      : { path: 'first100-requirements-matrix.md', sha256: MATRIX_SHA, line },
    validation,
    verifyCommand: fields.verifyCommand || null,
    realTask,
    stages: wm.stages,
    fixtures: {
      contract: `tests/first100/fixtures/${id}.contract.spec.ts`,
      provider: `tests/first100/fixtures/${id}.provider.spec.ts`,
      composition: `tests/first100/fixtures/${id}.composition.spec.ts`,
      fault: `tests/first100/fixtures/${id}.fault.spec.ts`,
    },
    gate: wm.gate,
    rollback: wm.rollback,
    // Absent = implicitly canonical (CANONICAL_EXTRACTION_FROM_PINNED_SOURCES,
    // matching the registry's own top-level provenance.status). Present =
    // BASE-ALIGN-v2 new-gap: its equivalent obligation is tracing every
    // clause to THIS source (checkNewGapClauseCoverage in generate-specs.ts),
    // not to the v1.0 YAML the 100 canonical epics trace to.
    ...(isNewGap
      ? {
          provenance: {
            kind: 'BASE-ALIGN-v2 new-gap',
            source: { path: 'spec/first100/sources/base-align-v2/new-gap-matrix.md', sha256: NEWGAP_MATRIX_SHA },
            rationaleDoc: 'spec/first100/sources/base-align-v2/upstream-status-COMPLETE.md §三',
            authorization: 'decisions-approved.md#C8',
          },
        }
      : {}),
  }
  epics.push(epic)
}

const EXPECTED_COUNTS = { P0: 8, P1: 12, P2: 12, P3: 12, P4: 14, P5: 12, P6: 10, P7: 10, P8: 10 }
for (const [g, n] of Object.entries(EXPECTED_COUNTS)) {
  if (groupCounts[g] !== n) throw new Error(`group ${g}: expected ${n}, got ${groupCounts[g]}`)
}

// DAG sanity: every predecessor is a known id in a strictly earlier wave, no cycles
const waveById = new Map(epics.map((e) => [e.id, e.wave]))
for (const e of epics) {
  for (const dep of e.predecessors) {
    if (!waveById.has(dep)) throw new Error(`${e.id}: unknown predecessor ${dep}`)
    if (waveById.get(dep) >= e.wave) throw new Error(`${e.id}: predecessor ${dep} not in an earlier wave (${waveById.get(dep)} >= ${e.wave})`)
  }
}

const registry = {
  schema: { name: 'first100-registry', version: '1.1', kind: 'canonical-source-of-truth', generatedFrom: 'planning sources (matrix + wave-map + decision package)' },
  frozenBaseline: {
    sha: '0a53fb55bea101816fa226bb964ae2bed71c343b',
    shortSha: '0a53fb55',
    label: 'baseline-0a53fb55',
    note: 'All First-100 evidence binds to this exact SHA (upstream master tip at first100-exec BASE-ALIGN, 2026-08-31; supersedes baseline-b150a551, downgraded to audit provenance per maintainer decision A1).',
  },
  layerEnum: LAYER_ENUM,
  ownerStates: ['UNASSIGNED_UNTIL_APPROVAL'],
  groupCounts: EXPECTED_COUNTS,
  // Separate field from groupCounts by design (BLOCKED-037): groupCounts
  // keeps meaning exactly what it always meant -- the 100 canonical epics
  // -- never redefined to "the total" and never silently including
  // new-gap epics. Present only when at least one new-gap epic actually
  // exists in this build (matching sourcePins'/provenance's own
  // absent-not-zeroed convention below) -- so today's committed
  // registry.json, extracted with INCLUDE_NEW_GAP off, stays byte-for-byte
  // unchanged by this field's existence. Extractor-computed, never
  // hand-edited.
  ...(newGapEpicIds.size > 0 ? { newGapCounts } : {}),
  waveCount: 19,
  exitSemantics: {
    accept: 'ACCEPTED',
    fail: 'FAIL',
    notRun: 'NOT_RUN',
    blocked: 'BLOCKED',
    failClosedRule: 'typed deny/refuse/incompatible/uncertain states fail closed per item text; missing dependency/path/threshold/evidence is BLOCKED; unexecuted command is NOT_RUN; model/executor self-report never constitutes evidence',
    appliesTo: 'all 100 epics (uniform; per-epic override field reserved)',
  },
  sourcePins: {
    'first100-requirements-matrix.md': { sha256: MATRIX_SHA, role: 'verbatim acceptance/nonGoals/files/must/validation/command source' },
    'implementation-wave-map.md': { sha256: WAVEMAP_SHA, role: 'wave/predecessor/stage/gate/rollback source' },
    'r0-decision-package.md': { sha256: sha256(decisionText), role: 'primaryLayer mapping + source-certified ambiguous ids + R0.1/R0.4 rule set' },
    // Output only, never input (BLOCKED-037): these entries are a record of
    // what was consumed, written here after the fact from the same
    // NEWGAP_SOURCES constant the extractor already read from -- this
    // object is never read back to decide what to extract. Present only
    // when INCLUDE_NEW_GAP actually ran; absent (not merely empty) when it
    // didn't, so this field's own shape honestly reflects whether any
    // new-gap source was consulted for this specific build.
    ...(INCLUDE_NEW_GAP
      ? Object.fromEntries(NEWGAP_SOURCES.flatMap((src) => [
          [src.matrix, { sha256: src.matrixSha, role: 'BASE-ALIGN-v2 new-gap epic matrix-format source' }],
          [src.waveMap, { sha256: src.waveMapSha, role: 'BASE-ALIGN-v2 new-gap epic wave-map-format source' }],
        ]))
      : {}),
  },
  specOwners: SPEC_OWNERS,
  thresholdProposals,
  adjudicationPending: {
    count: ambiguous.size,
    enumerated: ambiguous.size,
    notEnumeratedFromSources: {
      claimedByDecisionPackage: 2,
      sourceCertified: 1,
      gap: 1,
      note: 'Decision package §2.3 claims 2 more ambiguous ids than the 32 it lists but does not enumerate them; the Agent A transcript UNCERTAINTIES table is the only source and is not vendored. P2-09 is source-certified via the §2.3 wave-vs-audit seam, leaving 1 id enumerable only from the missing transcript.',
    },
    layerIds: [...ambiguous].sort(),
    status: 'PENDING_MAINTAINER',
    note: 'Agent A chose the layers in the table; these ids must be confirmed/adjudicated (ADR) before the v1.1 envelope is signed. Enumerated ids are the 32 explicit in decision package §2.3 plus P2-09 from the named wave-vs-audit seam; the claimed 34th is not enumerable from committed sources.',
  },
  evidenceSchema: EVIDENCE_SCHEMA,
  generatedArtifacts: {
    manifest: 'spec/deepseek-harness-optimization-manifest-v1.1.yaml',
    ownerMap: 'spec/first100-owner-map.json',
    dependencyGraph: 'spec/first100-dependency-graph.json',
    commandRegistry: 'spec/first100-command-registry.json',
    thresholds: 'spec/first100-thresholds.yaml',
    evidenceSchema: 'spec/first100-evidence.schema.json',
    digests: 'spec/first100-generated-digests.json',
  },
  provenance: {
    status: 'CANONICAL_EXTRACTION_FROM_PINNED_SOURCES',
    note: 'Deterministically extracted from the pinned vendored planning sources. Extraction is reproducible (byte-identical via --check). This does NOT constitute maintainer adjudication: the source-certified ambiguous layer ids (33; the claimed 34th is transcript-only), 17 threshold proposals, and canonical owner assignment remain PENDING_MAINTAINER_ADJUDICATION until R0-7.',
    extractor: 'scripts/first100/extract-registry.mjs',
    vendoredSources: 'spec/first100/sources/',
    sourceShas: {
      'spec/first100/sources/first100-requirements-matrix.md': MATRIX_SHA,
      'spec/first100/sources/implementation-wave-map.md': WAVEMAP_SHA,
      'spec/first100/sources/r0-decision-package.md': sha256(decisionText),
    },
    reproducible: 'node scripts/first100/extract-registry.mjs --check must exit 0 (byte-identical); enforced by scripts/first100/registry-regenerate.spec.ts',
    // BLOCKED-037: an honest completion, not a redefinition, of `status`
    // above. Leaving `status: CANONICAL_EXTRACTION_FROM_PINNED_SOURCES`
    // unqualified once this registry also holds non-canonical epics would
    // let the FIRST thing any reader/auditor sees overclaim the registry's
    // own purity -- the same failure shape as a name-scoped guard calling
    // itself type-scoped. This field is the honest completion: it names
    // exactly how many epics are canonical vs. new-gap, their ids, source,
    // and authorization, right next to the status a reader hits first.
    // Present only when at least one new-gap epic actually exists in this
    // specific build (INCLUDE_NEW_GAP on); omitted, not zeroed, otherwise --
    // matching sourcePins' own honesty-about-absence convention above.
    ...(newGapEpicIds.size > 0
      ? {
          newGapEpics: {
            canonicalCount: epics.length - newGapEpicIds.size,
            newGapCount: newGapEpicIds.size,
            epicIds: [...newGapEpicIds].sort(),
            note: 'These epics did not come from the 3 canonical pinned docs above -- they describe capability gaps upstream introduced after those docs were written. Each carries its own per-epic `provenance` field (source doc + SHA, rationale doc, authorization record); see decisions-approved.md#C8 for the reserved-scope authorization that permitted adding them.',
          },
        }
      : {}),
  },
  epics,
}

const serialized = JSON.stringify(registry, null, 2) + '\n'

if (CHECK) {
  const committed = readFileSync(OUT_PATH, 'utf8')
  if (committed !== serialized) {
    console.error(`DRIFT tests/first100/registry.json: committed bytes differ from a fresh extraction of ${SOURCES_DIR}`)
    process.exit(1)
  }
  console.log('verify: registry.json byte-identical to pinned vendored sources')
  process.exit(0)
}

writeFileSync(OUT_PATH, serialized)
console.log(`wrote ${OUT_PATH}`)
console.log(`epics=${epics.length} unique=${new Set(epics.map((e) => e.id)).size} groups=${JSON.stringify(groupCounts)}`)
console.log(`ambiguous=${ambiguous.size} layers=${new Set(epics.map((e) => e.primaryLayer)).size} waves 1..19 ok`)
console.log(`evidenceSchema entries=${EVIDENCE_SCHEMA.length} thresholds=${thresholdProposals.length}`)
