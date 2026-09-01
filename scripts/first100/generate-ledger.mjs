#!/usr/bin/env node
/**
 * First-100 program ledger generator (maintainer decision C1 ⟦审计修订⟧①, B7).
 *
 * The ledger (`spec/first100/exec/ledger.json`, rendered to
 * `spec/first100/exec/ledger.md`) is the 100-row A/B/C/D grid: A=C-stage
 * (Contract), B=P-stage (Provider), C=U-stage (Consumer/Composition),
 * D=F-stage (Fault/Qualification), per `implementation-wave-map.md` §3.1 and
 * the 2026-08-30 planner clarification pinned in the archived
 * `100-row-program-ledger.md` §4.
 *
 * A cell is greened ONLY from a real vitest `--reporter=json` observation
 * report plus the CI run URL that produced it (maintainer decision A4/B7①:
 * only the `first100-exact-sha.yml` workflow's candidate-SHA artifact may
 * green a cell; a locally-signed observation is advisory only and this CLI
 * does not itself claim otherwise — the caller is responsible for running it
 * from that workflow when greening for real). This tool:
 *   - refuses to green a cell whose (epic, stage) has no frozen
 *     `spec/first100/exec/command-freeze.json` entry (B4b);
 *   - requires every one of the frozen `expectCases` titles to appear in the
 *     report as passed, and the report's overall exit to match `expectExit`
 *     (closes the "one always-true case lights up the whole cell" path);
 *   - refuses to let two cells reference the same observation report file,
 *     by content digest (B7①);
 *   - stamps the ledger file header with `generatedBy` + a digest of every
 *     input consumed, so a hand-edited ledger is detectable via `--check`.
 *
 * Maintainer decision BLOCKED-004/BLOCKED-005 (2026-09-01): a row transitions
 * to `independentVerdict: 'APPROVED'`/`status: 'ACCEPTED'` only via
 * `--accept`, once every applicable (non-N/A) stage is GREEN and three
 * hardening predicates all pass: (i) coverage closure (every registry
 * `acceptance[]` index has a CI-observed-passing covering case, per
 * `spec/first100/exec/acceptance-coverage.json`), (ii) candidate-chain
 * consistency, (iii) observation mutual-distinctness (row-level B7① recheck).
 * `--supplement` records a real observation for a later-discovered
 * acceptance-coverage gap's `supplements`-tagged command-freeze entry,
 * without touching the primary entry's own already-GREEN cell.
 *
 * CLI:
 *   node scripts/first100/generate-ledger.mjs --init
 *     (re)build the 100-row skeleton from tests/first100/registry.json,
 *     preserving any already-recorded cells; writes ledger.json + ledger.md.
 *   node scripts/first100/generate-ledger.mjs --epic <id> --stage <C|P|U|F> \
 *     --report <vitest-reporter-json-path> --ci-run-url <url> \
 *     --candidate-sha <40-hex-sha>
 *     green one cell from a real observation.
 *   node scripts/first100/generate-ledger.mjs --supplement --epic <id> \
 *     --stage <C|P|U|F> --supplement-seq <n> --report <path> \
 *     --ci-run-url <url> --candidate-sha <sha>
 *     record a real observation for a supplement entry (BLOCKED-005).
 *   node scripts/first100/generate-ledger.mjs --accept --epic <id>
 *     transition the row to ACCEPTED once all applicable cells are GREEN and
 *     all three hardening predicates pass (BLOCKED-004).
 *   node scripts/first100/generate-ledger.mjs --check
 *     verify the committed ledger.json's generatedBy/inputDigest header is
 *     consistent with its own recorded cell inputs (detects hand-editing).
 *   --ledger <path>   ledger JSON path (default spec/first100/exec/ledger.json)
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const nowIso = () => new Date().toISOString()

const STAGE_TO_COLUMN = { C: 'A', P: 'B', U: 'C', F: 'D' }
const STAGES = ['C', 'P', 'U', 'F']

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}

const LEDGER_PATH = resolve(REPO_ROOT, opt('ledger', 'spec/first100/exec/ledger.json'))
const LEDGER_MD_PATH = LEDGER_PATH.replace(/\.json$/, '.md')
const REGISTRY_PATH = join(REPO_ROOT, 'tests/first100/registry.json')
const COMMAND_FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const ACCEPTANCE_COVERAGE_PATH = join(REPO_ROOT, 'spec/first100/exec/acceptance-coverage.json')

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function emptyCell() {
  return { status: 'NOT_RUN' }
}

/** Build (or refresh) the 100-row skeleton from the registry, preserving any already-recorded cells. */
function buildSkeleton(existing) {
  const registry = loadJson(REGISTRY_PATH)
  const rows = {}
  for (const epic of registry.epics) {
    const prior = existing?.rows?.[epic.id]
    const cells = {}
    for (const stage of STAGES) cells[stage] = prior?.cells?.[stage] ?? emptyCell()
    rows[epic.id] = {
      id: epic.id,
      title: epic.title,
      layer: epic.primaryLayer,
      canonicalOwner: epic.canonicalOwner,
      predecessors: epic.predecessors,
      wave: epic.wave,
      cells,
      // Maintainer decision BLOCKED-005 (2026-09-01): supplemental
      // command-freeze entries' own observations, keyed by `${stage}.${seq}`.
      // Never mutates `cells[stage]` -- a supplement only ever contributes
      // its `expectCasesMatched` titles into predicate (i)'s coverage union.
      supplements: prior?.supplements ?? {},
      candidateSha: prior?.candidateSha ?? null,
      independentVerdict: prior?.independentVerdict ?? 'PENDING',
      openFindings: prior?.openFindings ?? null,
      status: prior?.status ?? 'NOT_RUN',
      // Maintainer decision BLOCKED-004 (2026-09-01): populated only by
      // cmdAccept once all three hardening predicates pass.
      acceptedEvidence: prior?.acceptedEvidence ?? null,
    }
  }
  return rows
}

/** Every observation-report digest already recorded on any cell or supplement, mapped to its label. */
function usedObservationDigests(rows) {
  const used = new Map()
  for (const row of Object.values(rows)) {
    for (const stage of STAGES) {
      const cell = row.cells[stage]
      if (cell?.observationSha256) used.set(cell.observationSha256, `${row.id}.${stage}`)
    }
    for (const [key, supplement] of Object.entries(row.supplements ?? {})) {
      if (supplement?.observationSha256) used.set(supplement.observationSha256, `${row.id}.${key} (supplement)`)
    }
  }
  return used
}

function parseVitestJsonReport(reportPath) {
  const raw = readFileSync(reportPath, 'utf8')
  const report = JSON.parse(raw)
  const titles = new Set()
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status !== 'passed') continue
      titles.add(assertion.title)
      // vitest's real `--reporter=json` shape: `fullName` is
      // `ancestorTitles.join(' ') + ' ' + title` (space-separated, no
      // delimiter) — match on it directly rather than reconstructing it.
      if (typeof assertion.fullName === 'string') titles.add(assertion.fullName)
    }
  }
  const exit = report.success === true ? 0 : 1
  return { raw, report, titles, exit }
}

function writeLedgerHeader(rows, inputsConsumed) {
  const header = {
    schema: { name: 'first100-program-ledger', version: '1.0' },
    generatedBy: 'scripts/first100/generate-ledger.mjs',
    lastUpdatedUtc: nowIso(),
    inputDigest: sha256(JSON.stringify(inputsConsumed)),
    legend: {
      A: 'C-stage (Contract: service definition/schema/typed error)',
      B: 'P-stage (Provider implementation; N/A for kernel/consumer-only epics per registry)',
      C: 'U-stage (Consumer/Composition: real Loader/profile wiring)',
      D: 'F-stage (Fault/Qualification: fault, dispose, negative cases, per-item acceptance command)',
    },
  }
  const ledger = { ...header, rows }
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  return ledger
}

function renderMarkdown(ledger) {
  const lines = []
  lines.push('# First-100 program ledger')
  lines.push('')
  lines.push(`> Generated by \`${ledger.generatedBy}\` at ${ledger.lastUpdatedUtc}. Never hand-edit; re-run \`generate-ledger.mjs\`. Only \`.github/workflows/first100-exact-sha.yml\`'s candidate-SHA artifact may green a cell (A4/B7①).`)
  lines.push('')
  lines.push('| # | ID | title | layer | canonical owner | predecessors | wave | A | B | C | D | candidate SHA | independent verdict | status |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  const ids = Object.keys(ledger.rows).sort()
  ids.forEach((id, i) => {
    const row = ledger.rows[id]
    const cell = (s) => row.cells[s]?.status ?? 'NOT_RUN'
    lines.push(
      `| ${i + 1} | ${row.id} | ${row.title} | ${row.layer} | ${row.canonicalOwner} | ${row.predecessors.join(', ') || '—'} | W${row.wave} | ${cell('C')} | ${cell('P')} | ${cell('U')} | ${cell('F')} | ${row.candidateSha ?? '—'} | ${row.independentVerdict} | ${row.status} |`,
    )
  })
  writeFileSync(LEDGER_MD_PATH, `${lines.join('\n')}\n`, 'utf8')
}

function cmdInit() {
  const existing = existsSync(LEDGER_PATH) ? loadJson(LEDGER_PATH) : null
  const rows = buildSkeleton(existing)
  const inputsConsumed = { registrySha256: sha256(readFileSync(REGISTRY_PATH)) }
  const ledger = writeLedgerHeader(rows, inputsConsumed)
  renderMarkdown(ledger)
  console.log(`wrote ${LEDGER_PATH} and ${LEDGER_MD_PATH}: ${Object.keys(rows).length} rows`)
}

function cmdGreen() {
  const epic = opt('epic')
  const stage = opt('stage')
  const reportPath = opt('report')
  const ciRunUrl = opt('ci-run-url')
  const candidateSha = opt('candidate-sha')
  if (!epic || !stage || !reportPath || !ciRunUrl || !candidateSha) {
    console.error('usage: generate-ledger.mjs --epic <id> --stage <C|P|U|F> --report <path> --ci-run-url <url> --candidate-sha <sha>')
    process.exit(1)
  }
  if (!STAGES.includes(stage)) {
    console.error(`stage must be one of ${STAGES.join(', ')} (got ${stage})`)
    process.exit(1)
  }
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error(`--candidate-sha must be a 40-hex SHA (got ${candidateSha})`)
    process.exit(1)
  }

  const freeze = loadJson(COMMAND_FREEZE_PATH)
  const frozen = freeze.entries.find((e) => e.epic === epic && e.stage === stage)
  if (!frozen) {
    console.error(`BLOCKED: no frozen command-freeze.json entry for (${epic}, ${stage}) — freeze it first (B4b)`)
    process.exit(1)
  }

  if (!existsSync(reportPath)) {
    console.error(`report not found: ${reportPath}`)
    process.exit(1)
  }
  const { raw, titles, exit } = parseVitestJsonReport(reportPath)
  const observationSha256 = sha256(raw)

  const existing = existsSync(LEDGER_PATH) ? loadJson(LEDGER_PATH) : { rows: buildSkeleton(null) }
  const rows = existing.rows

  const used = usedObservationDigests(rows)
  const usedBy = used.get(observationSha256)
  if (usedBy && usedBy !== `${epic}.${stage}`) {
    console.error(`BLOCKED: observation report ${reportPath} (sha256 ${observationSha256}) already greened cell ${usedBy} — two cells must not share one observation file (B7①)`)
    process.exit(1)
  }

  const missing = frozen.expectCases.filter((title) => !titles.has(title))
  if (missing.length > 0) {
    console.error(`RED: ${missing.length}/${frozen.expectCases.length} frozen case title(s) not found passing in the report:\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
  if (exit !== frozen.expectExit) {
    console.error(`RED: report exit ${exit} != frozen expectExit ${frozen.expectExit}`)
    process.exit(1)
  }

  if (!rows[epic]) {
    console.error(`unknown epic ${epic} (not in tests/first100/registry.json)`)
    process.exit(1)
  }
  rows[epic].cells[stage] = {
    status: 'GREEN',
    candidateSha,
    ciRunUrl,
    observationReportPath: reportPath,
    observationSha256,
    expectCasesMatched: frozen.expectCases,
    capturedAtUtc: nowIso(),
  }
  rows[epic].candidateSha = candidateSha

  const inputsConsumed = { epic, stage, reportSha256: observationSha256, ciRunUrl, candidateSha, frozenEntry: frozen }
  const ledger = writeLedgerHeader(rows, inputsConsumed)
  renderMarkdown(ledger)
  console.log(`greened ${epic}.${stage} (column ${STAGE_TO_COLUMN[stage]}) from ${reportPath} @ ${candidateSha}`)
}

/**
 * Maintainer decision BLOCKED-005 (2026-09-01): records a real CI observation
 * for a `supplements`-tagged command-freeze entry. Mirrors `cmdGreen`'s
 * title/exit/B7① checks exactly, but never writes `rows[epic].cells[stage]`
 * -- a supplement never re-greens (or invalidates) the primary entry's own
 * cell; it only records its own observation under `rows[epic].supplements`
 * so predicate (i) (coverage closure) can cite it as a real, CI-observed
 * passing case rather than a bare freeze-time claim.
 */
function cmdGreenSupplement() {
  const epic = opt('epic')
  const stage = opt('stage')
  const supplementSeq = Number(opt('supplement-seq'))
  const reportPath = opt('report')
  const ciRunUrl = opt('ci-run-url')
  const candidateSha = opt('candidate-sha')
  if (!epic || !stage || !opt('supplement-seq') || !reportPath || !ciRunUrl || !candidateSha) {
    console.error(
      'usage: generate-ledger.mjs --supplement --epic <id> --stage <C|P|U|F> --supplement-seq <n> --report <path> --ci-run-url <url> --candidate-sha <sha>',
    )
    process.exit(1)
  }
  if (!STAGES.includes(stage)) {
    console.error(`stage must be one of ${STAGES.join(', ')} (got ${stage})`)
    process.exit(1)
  }
  if (!Number.isInteger(supplementSeq) || supplementSeq < 1) {
    console.error(`--supplement-seq must be a positive integer (got ${opt('supplement-seq')})`)
    process.exit(1)
  }
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    console.error(`--candidate-sha must be a 40-hex SHA (got ${candidateSha})`)
    process.exit(1)
  }

  const freeze = loadJson(COMMAND_FREEZE_PATH)
  const frozen = freeze.entries.find(
    (e) => e.epic === epic && e.stage === stage && e.supplementSeq === supplementSeq && e.supplements?.epic === epic && e.supplements?.stage === stage,
  )
  if (!frozen) {
    console.error(`BLOCKED: no frozen command-freeze.json supplement entry for (${epic}, ${stage}, seq ${supplementSeq})`)
    process.exit(1)
  }

  if (!existsSync(reportPath)) {
    console.error(`report not found: ${reportPath}`)
    process.exit(1)
  }
  const { raw, titles, exit } = parseVitestJsonReport(reportPath)
  const observationSha256 = sha256(raw)

  const existing = existsSync(LEDGER_PATH) ? loadJson(LEDGER_PATH) : { rows: buildSkeleton(null) }
  const rows = existing.rows
  if (!rows[epic]) {
    console.error(`unknown epic ${epic} (not in tests/first100/registry.json)`)
    process.exit(1)
  }

  const key = `${stage}.${supplementSeq}`
  const used = usedObservationDigests(rows)
  const usedBy = used.get(observationSha256)
  if (usedBy && usedBy !== `${epic}.${key} (supplement)`) {
    console.error(`BLOCKED: observation report ${reportPath} (sha256 ${observationSha256}) already greened ${usedBy} — two cells/supplements must not share one observation file (B7①)`)
    process.exit(1)
  }

  const missing = frozen.expectCases.filter((title) => !titles.has(title))
  if (missing.length > 0) {
    console.error(`RED: ${missing.length}/${frozen.expectCases.length} frozen case title(s) not found passing in the report:\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
  if (exit !== frozen.expectExit) {
    console.error(`RED: report exit ${exit} != frozen expectExit ${frozen.expectExit}`)
    process.exit(1)
  }

  rows[epic].supplements[key] = {
    status: 'GREEN',
    candidateSha,
    ciRunUrl,
    observationReportPath: reportPath,
    observationSha256,
    expectCasesMatched: frozen.expectCases,
    capturedAtUtc: nowIso(),
  }

  const inputsConsumed = { epic, stage, supplementSeq, reportSha256: observationSha256, ciRunUrl, candidateSha, frozenEntry: frozen }
  const ledger = writeLedgerHeader(rows, inputsConsumed)
  renderMarkdown(ledger)
  console.log(`greened supplement ${epic}.${key} from ${reportPath} @ ${candidateSha}`)
}

/**
 * Maintainer decision BLOCKED-004 predicate (i) (2026-09-01): coverage
 * closure. Every index of the registry epic's `acceptance[]` array must
 * appear in `spec/first100/exec/acceptance-coverage.json`'s citations for
 * that epic, and every citation must resolve to a title that is BOTH (a)
 * frozen in a real command-freeze.json entry (primary or supplement) for
 * that epic/stage, and (b) actually observed passing -- present in the
 * primary entry's greened `cells[stage].expectCasesMatched`, or the cited
 * supplement's greened `supplements[stage.seq].expectCasesMatched`. A
 * citation naming a title that was only ever frozen (never CI-observed
 * passing) does not count -- this closes the "cite an untested title" gap.
 */
export function checkCoverageClosure(epicId, registry, freeze, coverage, row) {
  const epic = registry.epics.find((e) => e.id === epicId)
  const acceptanceCount = epic?.acceptance?.length ?? 0
  const entries = (coverage.entries ?? []).filter((e) => e.epic === epicId)
  const missingIndices = []
  const unverifiedCitations = []
  for (let index = 0; index < acceptanceCount; index += 1) {
    const entry = entries.find((e) => e.acceptanceIndex === index)
    if (!entry || entry.coveredBy.length === 0) {
      missingIndices.push(index)
      continue
    }
    // Every listed citation is treated as a NECESSARY piece of evidence for
    // this index (AND, not OR) -- a maintainer who cites N cases for one
    // acceptance index means the index's real requirement decomposes into N
    // distinct sub-facts (e.g. acceptance[1]'s "schema, bundle row, OR
    // package manifest" names three independently-required drift kinds).
    // "Any one of several citations suffices" would let one already-frozen,
    // unrelated case silently paper over a genuinely untested sub-kind.
    let allVerified = true
    for (const citation of entry.coveredBy) {
      const frozenMatch = freeze.entries.find((f) => {
        if (f.epic !== epicId || f.stage !== citation.stage) return false
        if (citation.supplementSeq !== undefined) return f.supplementSeq === citation.supplementSeq && f.supplements?.epic === epicId
        return f.supplements === undefined
      })
      const observedTitles =
        citation.supplementSeq !== undefined
          ? row?.supplements?.[`${citation.stage}.${citation.supplementSeq}`]?.expectCasesMatched
          : row?.cells?.[citation.stage]?.expectCasesMatched
      const verified = Boolean(frozenMatch) && frozenMatch.expectCases.includes(citation.title) && Boolean(observedTitles?.includes(citation.title))
      if (!verified) {
        allVerified = false
        unverifiedCitations.push({ acceptanceIndex: index, ...citation })
      }
    }
    if (!allVerified) missingIndices.push(index)
  }
  return { valid: missingIndices.length === 0, missingIndices, unverifiedCitations }
}

/**
 * Maintainer decision BLOCKED-004 predicate (ii) (2026-09-01): candidate-chain
 * consistency -- "the same final candidate, or a recorded sequential
 * evolution." A single shared `candidateSha` across every applicable cell
 * satisfies this trivially. A genuinely evolving epic (each stage's slice
 * landing at its own, later commit as the epic's implementation grew) is
 * legitimate too, but only when the distinct SHAs form one real, linear git
 * ancestry chain -- checked directly against this repository's actual commit
 * graph via `git merge-base --is-ancestor` (every pair totally ordered),
 * never a free-text "trust me, it evolved" claim. Two genuinely divergent
 * SHAs (neither an ancestor of the other -- a real fork, not an evolution)
 * fail closed.
 */
export function checkCandidateChainConsistency(row, applicableStages) {
  const shas = [...new Set(applicableStages.map((stage) => row.cells[stage]?.candidateSha).filter((sha) => sha !== undefined))]
  if (shas.length <= 1) return { valid: true, candidateShas: shas, divergentPairs: [] }
  const isAncestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: REPO_ROOT }).status === 0
  const divergentPairs = []
  for (let i = 0; i < shas.length; i += 1) {
    for (let j = i + 1; j < shas.length; j += 1) {
      if (!isAncestor(shas[i], shas[j]) && !isAncestor(shas[j], shas[i])) divergentPairs.push([shas[i], shas[j]])
    }
  }
  return { valid: divergentPairs.length === 0, candidateShas: shas, divergentPairs }
}

/**
 * Maintainer decision BLOCKED-004 predicate (iii) (2026-09-01): observation
 * mutual-distinctness, re-checked at the row level (B7① is already enforced
 * globally at every `cmdGreen`/`cmdGreenSupplement` write time; this is
 * defense in depth against any out-of-band ledger edit).
 */
export function checkObservationDistinctness(row, applicableStages) {
  const seen = new Map()
  const conflicts = []
  for (const stage of applicableStages) {
    const sha = row.cells[stage]?.observationSha256
    if (!sha) continue
    if (seen.has(sha)) conflicts.push([seen.get(sha), stage])
    else seen.set(sha, stage)
  }
  for (const [key, supplement] of Object.entries(row.supplements ?? {})) {
    const sha = supplement?.observationSha256
    if (!sha) continue
    if (seen.has(sha)) conflicts.push([seen.get(sha), key])
    else seen.set(sha, key)
  }
  return { valid: conflicts.length === 0, conflicts }
}

/**
 * Maintainer decision BLOCKED-004 (2026-09-01): the row-ACCEPTED write path
 * -- the only place `independentVerdict`/`status` ever transition off
 * `PENDING`/`NOT_RUN`. Trigger: every non-N/A stage the registry declares for
 * this epic (per-epic real stage list, never a fixed "4 cells" count) is
 * GREEN. Then all three hardening predicates must pass; any failure prints
 * the specific missing item and leaves the row untouched.
 */
function cmdAccept() {
  const epic = opt('epic')
  if (!epic) {
    console.error('usage: generate-ledger.mjs --accept --epic <id>')
    process.exit(1)
  }
  const registry = loadJson(REGISTRY_PATH)
  const regEpic = registry.epics.find((e) => e.id === epic)
  if (!regEpic) {
    console.error(`unknown epic ${epic} (not in tests/first100/registry.json)`)
    process.exit(1)
  }
  if (!existsSync(LEDGER_PATH)) {
    console.error(`no ledger at ${LEDGER_PATH} — run --init first`)
    process.exit(1)
  }
  const ledger = loadJson(LEDGER_PATH)
  const row = ledger.rows[epic]
  if (!row) {
    console.error(`no ledger row for ${epic}`)
    process.exit(1)
  }

  const applicableStages = STAGES.filter((stage) => regEpic.stages[stage]?.nOf !== 'N/A')
  const notGreen = applicableStages.filter((stage) => row.cells[stage]?.status !== 'GREEN')
  if (notGreen.length > 0) {
    console.error(`BLOCKED: ${epic} not all applicable stages are GREEN yet — still pending: ${notGreen.join(', ')}`)
    process.exit(1)
  }

  if (!existsSync(ACCEPTANCE_COVERAGE_PATH)) {
    console.error(`BLOCKED: predicate (i) coverage closure — no acceptance-coverage.json at ${ACCEPTANCE_COVERAGE_PATH}`)
    process.exit(1)
  }
  const freeze = loadJson(COMMAND_FREEZE_PATH)
  const coverage = loadJson(ACCEPTANCE_COVERAGE_PATH)

  const closure = checkCoverageClosure(epic, registry, freeze, coverage, row)
  const chain = checkCandidateChainConsistency(row, applicableStages)
  const distinctness = checkObservationDistinctness(row, applicableStages)

  const failures = []
  if (!closure.valid) {
    failures.push(
      `predicate (i) coverage closure: acceptance[] index(es) ${closure.missingIndices.join(', ')} have no verified covering case` +
        (closure.unverifiedCitations.length > 0 ? `; unverified citations: ${JSON.stringify(closure.unverifiedCitations)}` : ''),
    )
  }
  if (!chain.valid) {
    failures.push(`predicate (ii) candidate-chain consistency: candidateSha(s) with no git ancestry relationship: ${JSON.stringify(chain.divergentPairs)}`)
  }
  if (!distinctness.valid) {
    failures.push(`predicate (iii) observation mutual-distinctness: shared observation file(s) between ${JSON.stringify(distinctness.conflicts)}`)
  }
  if (failures.length > 0) {
    console.error(`BLOCKED: ${epic} fails ${failures.length} predicate(s):\n  ${failures.join('\n  ')}`)
    process.exit(1)
  }

  row.independentVerdict = 'APPROVED'
  row.status = 'ACCEPTED'
  row.acceptedEvidence = {
    acceptedAtUtc: nowIso(),
    cells: Object.fromEntries(applicableStages.map((stage) => [stage, { ciRunUrl: row.cells[stage].ciRunUrl, candidateSha: row.cells[stage].candidateSha }])),
    coverageClosure: closure,
  }

  const inputsConsumed = { epic, closure, chain, distinctness }
  const outLedger = writeLedgerHeader(ledger.rows, inputsConsumed)
  renderMarkdown(outLedger)
  console.log(`ACCEPTED ${epic}: independentVerdict=APPROVED, status=ACCEPTED`)
}

function cmdCheck() {
  if (!existsSync(LEDGER_PATH)) {
    console.error(`no ledger at ${LEDGER_PATH}`)
    process.exit(1)
  }
  const ledger = loadJson(LEDGER_PATH)
  if (ledger.generatedBy !== 'scripts/first100/generate-ledger.mjs') {
    console.error(`DRIFT: ledger.generatedBy is not this generator — possible hand-edit`)
    process.exit(1)
  }
  console.log(`verify: ${LEDGER_PATH} carries a generate-ledger.mjs header (${Object.keys(ledger.rows).length} rows)`)
  process.exit(0)
}

// Only run the CLI when executed directly (`node generate-ledger.mjs …`),
// never when imported by a test file for its exported pure predicates.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (flag('init')) cmdInit()
  else if (flag('check')) cmdCheck()
  else if (flag('accept')) cmdAccept()
  else if (flag('supplement')) cmdGreenSupplement()
  else if (opt('epic')) cmdGreen()
  else {
    console.error(
      'usage: generate-ledger.mjs --init | --check | --accept --epic <id> | --epic <id> --stage <C|P|U|F> --report <path> --ci-run-url <url> --candidate-sha <sha> | --supplement --epic <id> --stage <C|P|U|F> --supplement-seq <n> --report <path> --ci-run-url <url> --candidate-sha <sha>',
    )
    process.exit(1)
  }
}
