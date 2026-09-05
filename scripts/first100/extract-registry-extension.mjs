#!/usr/bin/env node
/**
 * Stage-0 registry extension: generate the Phase-9 rows (items 101-109).
 *
 * Authorized by maintainer decision C3 (`spec/first100/exec/decisions-approved.md`,
 * verbatim 「按推荐全批」 2026-08-31), whose audit revision requires this step
 * BEFORE any P9 slice starts: without a registry row, a P9 slice in progress is
 * lost at the next compaction, because nothing can look it up.
 *
 * **Why a separate file rather than more rows in `registry.json`.** C3 permits
 * either, and the code decides between them. `generate-ledger.mjs` documents the
 * nine extension items as "tracked as VERIFIED/scheduled-BLOCKED outside this
 * ledger, not as ACCEPTED ledger rows", and derives
 * `totals.totalEpics = ledger rows + P9_EXTENSION_ITEM_COUNT`. Folding P9 into
 * `registry.json` would make the ledger skeleton 110 rows and the total 119, and
 * would put the nine items on the ACCEPTED track that the same comment says they
 * are not on. The extension therefore stays its own file, which is what the
 * existing arithmetic already assumes.
 *
 * **The cost of that choice, stated rather than papered over.**
 * `EXEC-STATE.json`'s `registryDigest` covers `registry.json` alone, so this
 * file is NOT under that seal. What protects it instead is reproducibility:
 * the source matrix is SHA-pinned here, and `--check` regenerates from that
 * pinned source and fails closed on any byte of difference, so an edit to
 * either the matrix or this output is caught. That is weaker than being inside
 * `registryDigest` in one specific way -- nothing forces `--check` to run --
 * and extending the digest to cover both files is the real fix. It is left
 * undone deliberately rather than claimed: `syncExecState` would have to hash
 * two paths, and that edit belongs with the regreening work that already needs
 * to touch the ledger.
 *
 * The matrix is parsed by `./matrix-parse.mjs` -- the SAME function
 * `extract-registry.mjs` uses on the canonical document, not a copy, because two
 * parsers over one document format drift apart silently.
 *
 * CLI:
 *   node scripts/first100/extract-registry-extension.mjs [--check]
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMatrixText } from './matrix-parse.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_PATH = join(REPO_ROOT, 'spec/first100/sources/first100-requirements-matrix-extension-101plus.md')
const OUT_PATH = join(REPO_ROOT, 'tests/first100/registry-extension.json')

/**
 * The extension matrix's pinned digest.
 *
 * Fail-closed exactly like the three canonical sources: a source that decides
 * nine epic definitions must not be editable without a gate reporting it.
 */
const SOURCE_SHA256 = 'e6e327fa58b01bc0fef1d99d4b4105d29bcfa10a69cd453989c99b11e572f1fb'

/**
 * The upstream-coverage triage, and its pin.
 *
 * `extract-registry.mjs` already pins this file (BLOCKED-043) because it is the
 * sole evidence behind the program's terminal-state requirement for the nine P9
 * items, and before that pin a fabricated verdict could be appended without any
 * gate noticing. It is pinned again here because this generator now READS it.
 *
 * What it contains is a scope triage -- which items upstream already ships, in
 * part or whole -- NOT a terminal state. Recording it as VERIFIED would assert a
 * check nobody ran, which is the defect BLOCKED-106 exists for. Each row instead
 * carries the verbatim line that mentions it, so a later reader adjudicates from
 * the source rather than from this generator's paraphrase.
 */
const TRIAGE_PATH = join(REPO_ROOT, 'spec/first100/sources/base-align-v2/upstream-status-COMPLETE.md')
const TRIAGE_SHA256 = '2858c273340502af8819d8493cad6cc8854b63e19914d0b5dd38e4f42465f57c'

/** Items C3 additionally cleared to run in parallel with R10, ahead of W20-W22. */
const PARALLEL_CLEARED = new Set(['P9-01', 'P9-02', 'P9-03', 'P9-04', 'P9-05', 'P9-06', 'P9-07'])

const EXPECTED_ITEMS = 9

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Split a matrix field's `；`-separated clauses into a list.
 * @param value - the raw field text.
 * @returns the clauses, trimmed, without empties.
 */
export function splitClauses(value) {
  if (!value) return []
  return value
    .split(/[；;]/)
    .map(clause => clause.trim().replace(/[。.]$/, ''))
    .filter(clause => clause.length > 0)
}

/**
 * Parse the `Priority / Wave / 依赖` field.
 *
 * The wave is read from the document rather than assumed: C3 orders these into
 * W20-W22, and a generator that hard-coded one wave would silently disagree with
 * the source it claims to derive from.
 * @param value - the raw field text, e.g. `P9 / W20 / P0-06。`
 * @returns the priority, wave number, and predecessor ids.
 */
export function parsePriorityWave(value) {
  const parts = value.split('/').map(part => part.trim())
  const priority = parts[0] ?? ''
  const waveMatch = (parts[1] ?? '').match(/W(\d+)/)
  const predecessorText = parts.slice(2).join('/')
  const predecessors = [...predecessorText.matchAll(/\bP\d-\d{2}\b/g)].map(match => match[0])
  return { priority, wave: waveMatch ? Number(waveMatch[1]) : null, predecessors }
}

/**
 * Parse the `Files` field into `{path, kind}` entries.
 * @param value - the raw field text.
 * @returns the declared files.
 */
export function parseFiles(value) {
  const files = []
  for (const match of value.matchAll(/`([^`]+)`\s*\[([BNP])\]/g)) {
    files.push({ path: match[1], kind: match[2] })
  }
  return files
}

/**
 * Find the triage line that mentions an item.
 *
 * The document groups items -- one line can cover `P9-04/05/06/07/08/09` -- so a
 * row's evidence is whichever line names it, quoted rather than summarized.
 * @param id - the P9 item id.
 * @param triageText - the pinned triage document.
 * @returns the verbatim line, or null when the document does not mention it.
 */
export function triageLineFor(id, triageText) {
  const shortId = id.replace('P9-', '')
  for (const line of triageText.split('\n')) {
    if (!line.trim().startsWith('-')) continue
    if (line.includes(id)) return line.trim()
    // Grouped form: `P9-04/05/06/07/08/09 = 全缺`.
    const grouped = line.match(/P9-\d{2}(?:\/\d{2})+/)
    if (grouped && grouped[0].slice(3).split('/').includes(shortId)) return line.trim()
  }
  return null
}

function build() {
  const text = readFileSync(SOURCE_PATH, 'utf8')
  const actual = sha256(text)
  if (actual !== SOURCE_SHA256) {
    throw new Error(
      `${SOURCE_PATH}: sha mismatch (got ${actual}, expected ${SOURCE_SHA256}) -- the extension matrix is fail-closed SHA-pinned exactly like the canonical sources`,
    )
  }

  const triageText = readFileSync(TRIAGE_PATH, 'utf8')
  const triageActual = sha256(triageText)
  if (triageActual !== TRIAGE_SHA256) {
    throw new Error(
      `${TRIAGE_PATH}: sha mismatch (got ${triageActual}, expected ${TRIAGE_SHA256}) -- the P9 triage decides a terminal-state answer and must not be editable without a gate reporting it`,
    )
  }

  const parsed = parseMatrixText(text)
  const p9 = [...parsed].filter(([id]) => id.startsWith('P9-'))
  if (p9.length !== EXPECTED_ITEMS) {
    throw new Error(`extension matrix: expected ${EXPECTED_ITEMS} P9 sections, got ${p9.length}`)
  }

  const epics = []
  for (const [id, entry] of p9) {
    const fields = entry.fields
    const { priority, wave, predecessors } = parsePriorityWave(fields.priorityWave ?? '')
    if (wave === null) throw new Error(`${id}: no wave in "Priority / Wave / 依赖"`)
    epics.push({
      id,
      title: entry.title,
      phase: 9,
      priority,
      wave,
      predecessors,
      files: parseFiles(fields.files ?? ''),
      must: splitClauses(fields.must),
      acceptance: splitClauses(fields.acceptance),
      nonGoal: fields.nonGoal ?? '',
      validation: fields.validation ?? '',
      verifyCommand: fields.verifyCommand ?? '',
      // C3 approved the W20-W22 ordering for all nine, and SEPARATELY cleared
      // P9-01..07 to run in parallel with R10. P9-08 and P9-09 are not cleared
      // for early start, so the distinction is recorded per row rather than
      // left to a reader to remember.
      parallelWithR10: PARALLEL_CLEARED.has(id),
      // The program's terminal state asks each P9 item to be VERIFIED or
      // scheduled-BLOCKED. Nothing has been observed yet, so the honest initial
      // value is neither.
      terminalState: 'NOT_STARTED',
      // The upstream triage, quoted from the pinned source. It adjusts SCOPE --
      // P9-02 is largely shipped upstream already, P9-01 and P9-03 partly -- and
      // says nothing about whether this item has been verified here, which is
      // what `terminalState` is for.
      upstreamTriage: triageLineFor(id, triageText),
    })
  }
  // Every item must be adjudicated by the triage, and a silent `null` would let
  // an item with no upstream verdict look the same as one the document simply
  // did not reach. The triage is the sole evidence behind these nine terminal
  // states, so an unmentioned item is a gap to report, not a blank to store.
  const unadjudicated = epics.filter(epic => epic.upstreamTriage === null).map(epic => epic.id)
  if (unadjudicated.length > 0) {
    throw new Error(`no upstream-triage line mentions ${unadjudicated.join(', ')} -- the triage is the sole evidence for these items' terminal state`)
  }

  epics.sort((left, right) => left.id.localeCompare(right.id))

  // Two independent sources say which items may start early, and they must
  // agree: C3's text names P9-01..07, and the matrix independently places
  // exactly those in W20 (P9-08 is W21, P9-09 is W22). Neither is derived from
  // the other, so a disagreement means one of them moved and the split is no
  // longer what was approved -- which is precisely the moment to stop rather
  // than pick a side.
  const earliestWave = Math.min(...epics.map(epic => epic.wave))
  const inEarliestWave = epics.filter(epic => epic.wave === earliestWave).map(epic => epic.id)
  const cleared = epics.filter(epic => epic.parallelWithR10).map(epic => epic.id)
  if (inEarliestWave.join(',') !== cleared.join(',')) {
    throw new Error(
      `C3's parallel-cleared set [${cleared.join(', ')}] disagrees with the matrix's W${earliestWave} membership [${inEarliestWave.join(', ')}] -- one of the two moved`,
    )
  }

  return {
    schema: { name: 'first100-registry-extension', version: '1.0' },
    generatedBy: 'scripts/first100/extract-registry-extension.mjs',
    authorization: {
      decision: 'C3',
      record: 'spec/first100/exec/decisions-approved.md',
      approvedUtc: '2026-08-31T14:50:00.000Z',
      verbatim: '按推荐全批',
      scope: 'W20-W22 ordering for P9-01..09; P9-01..07 additionally cleared to run parallel with R10, not counted toward the 100/100 gate',
    },
    source: { path: 'spec/first100/sources/first100-requirements-matrix-extension-101plus.md', sha256: SOURCE_SHA256 },
    triageSource: { path: 'spec/first100/sources/base-align-v2/upstream-status-COMPLETE.md', sha256: TRIAGE_SHA256 },
    counts: { items: epics.length, parallelCleared: epics.filter(epic => epic.parallelWithR10).length },
    epics,
  }
}

function main() {
  const built = build()
  const serialized = `${JSON.stringify(built, null, 2)}\n`
  if (process.argv.includes('--check')) {
    const existing = readFileSync(OUT_PATH, 'utf8')
    if (existing !== serialized) {
      console.error(`${OUT_PATH} is not what the pinned source regenerates -- rerun without --check`)
      process.exit(1)
    }
    console.log(`verify: ${OUT_PATH} matches regeneration from the pinned extension matrix (${built.counts.items} items)`)
    return
  }
  writeFileSync(OUT_PATH, serialized, 'utf8')
  console.log(
    `wrote ${OUT_PATH}: ${built.counts.items} P9 items, ${built.counts.parallelCleared} cleared to run parallel with R10, waves ${[...new Set(built.epics.map(epic => epic.wave))].sort((a, b) => a - b).map(wave => `W${wave}`).join(' ')}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
