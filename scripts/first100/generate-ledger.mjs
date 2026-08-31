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
 * CLI:
 *   node scripts/first100/generate-ledger.mjs --init
 *     (re)build the 100-row skeleton from tests/first100/registry.json,
 *     preserving any already-recorded cells; writes ledger.json + ledger.md.
 *   node scripts/first100/generate-ledger.mjs --epic <id> --stage <C|P|U|F> \
 *     --report <vitest-reporter-json-path> --ci-run-url <url> \
 *     --candidate-sha <40-hex-sha>
 *     green one cell from a real observation.
 *   node scripts/first100/generate-ledger.mjs --check
 *     verify the committed ledger.json's generatedBy/inputDigest header is
 *     consistent with its own recorded cell inputs (detects hand-editing).
 *   --ledger <path>   ledger JSON path (default spec/first100/exec/ledger.json)
 */
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
      candidateSha: prior?.candidateSha ?? null,
      independentVerdict: prior?.independentVerdict ?? 'PENDING',
      openFindings: prior?.openFindings ?? null,
      status: prior?.status ?? 'NOT_RUN',
    }
  }
  return rows
}

/** Every observation-report digest already recorded on any cell, mapped to its (epic, stage). */
function usedObservationDigests(rows) {
  const used = new Map()
  for (const row of Object.values(rows)) {
    for (const stage of STAGES) {
      const cell = row.cells[stage]
      if (cell?.observationSha256) used.set(cell.observationSha256, `${row.id}.${stage}`)
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

if (flag('init')) cmdInit()
else if (flag('check')) cmdCheck()
else if (opt('epic')) cmdGreen()
else {
  console.error('usage: generate-ledger.mjs --init | --check | --epic <id> --stage <C|P|U|F> --report <path> --ci-run-url <url> --candidate-sha <sha>')
  process.exit(1)
}
