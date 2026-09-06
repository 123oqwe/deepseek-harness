/**
 * Find fields this program WRITES into its own records and never READS back.
 *
 * Six times in one day a defect had the same shape: a fact was recorded in a
 * file, and nothing consulted it. `ledgerDigest` was written and never
 * compared; `absorbedFlakes` left a trace nobody checked; `parallelWithR10`
 * said which epics were released and no gate read it; `openFindings` sat in the
 * very row `--green` was writing to. Each was found by a person noticing, which
 * is the property that makes it a recurring defect rather than six unrelated
 * ones.
 *
 * This scan is the mechanical version of that noticing. It takes every field
 * name appearing in the program's own JSON records and asks whether any script
 * mentions it somewhere other than where it is written. A name that appears
 * only at its write site is a candidate: something the program tells itself and
 * then never asks.
 *
 * **It reports candidates, not defects, and it does not exit non-zero.** A
 * field can be legitimately write-only — evidence recorded for a human reader,
 * or for a consumer outside these scripts — and a gate that failed on those
 * would be turned off within a week. What it buys is that the list is derived
 * rather than remembered: a hand-maintained register of unread fields would
 * itself become a file nobody reads, which is the joke this program cannot
 * afford to make twice.
 *
 * Usage: `node scripts/first100/verify-fields-are-read.mjs`
 *
 * @module scripts/first100/verify-fields-are-read
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')

/** The records this program writes about itself. */
const RECORD_PATHS = [
  'spec/first100/exec/ledger.json',
  'spec/first100/exec/command-freeze.json',
  'spec/first100/exec/p9-verification.json',
  'spec/first100/exec/flake-registry.json',
  'spec/first100/exec/EXEC-STATE.json',
]

/**
 * Field names that are evidence for a human reader, not inputs to a check.
 *
 * Listed with the reason, because an unexplained exemption is how a real
 * finding gets silenced. Anything not here and not read is worth a look.
 */
const WRITTEN_FOR_READERS = new Map([
  ['note', 'freeze prose, read by people reviewing a stage'],
  ['mutationDescription', 'evidence text inside sensitivityProof'],
  ['failureSummary', 'evidence text inside sensitivityProof'],
  ['unrelatedNote', 'why a flake is unrelated to the slice; read at review'],
  ['registeredBy', 'attribution'],
  ['registeredAtUtc', 'attribution'],
  ['capturedAtUtc', 'when a cell was recorded'],
  ['frozenAtUtc', 'when a command was frozen'],
  ['observedAtUtc', 'when an occurrence was seen'],
  ['lastUpdatedUtc', 'when the state file was written'],
  ['title', 'the epic title, for the rendered table'],
  ['detail', 'human-facing explanation inside a finding'],
])

/** Every key name occurring anywhere in `value`, at any depth. */
function collectKeys(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into)
    return into
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key)
      collectKeys(nested, into)
    }
  }
  return into
}

/** Every script that could read one of these fields. */
function scriptSources() {
  const dir = join(REPO_ROOT, 'scripts/first100')
  return readdirSync(dir)
    .filter(name => name.endsWith('.mjs') || name.endsWith('.ts'))
    .map(name => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
}

function main() {
  const keys = new Set()
  for (const path of RECORD_PATHS) {
    try {
      collectKeys(JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')), keys)
    } catch {
      // A record this program has not created yet is not a finding: the scan
      // reports on what exists, and a missing file has no fields to be unread.
    }
  }
  const sources = scriptSources()
  const unread = []
  for (const key of [...keys].sort()) {
    // An epic id or a stage letter is a VALUE used as a key; skip those rather
    // than reporting every row in the ledger as an unread field.
    if (/^(P\d-\d\d|[CPUF]|\d+)$/.test(key)) continue
    if (WRITTEN_FOR_READERS.has(key)) continue
    const mentions = sources.filter(source => source.text.includes(key))
    if (mentions.length === 0) unread.push({ key, where: 'no script mentions it at all' })
    else if (mentions.length === 1) unread.push({ key, where: `only ${mentions[0].name}` })
  }

  if (unread.length === 0) {
    console.log('verify-fields-are-read: every recorded field is mentioned by at least two scripts.')
    return
  }
  console.log(`verify-fields-are-read: ${unread.length} field(s) written into the program's records with little or no reader:`)
  for (const { key, where } of unread) console.log(`  ${key} -- ${where}`)
  console.log('Each is a CANDIDATE, not a defect: some are evidence for people. A field that should gate something and does not is the defect.')
}

main()
