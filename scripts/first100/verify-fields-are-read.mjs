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

/**
 * Report every `verify-*.mjs` in this directory that no caller invokes.
 *
 * The same defect as an unread field, one level up: a gate nobody runs records
 * nothing, and it took a person noticing to find the last two —
 * `verify-baseline-file-references.mjs` and `verify-frozen-titles-resolvable.mjs`
 * were both built and left unwired, the second sitting red where a real
 * regression would have been indistinguishable from the standing failure.
 *
 * A caller is a `package.json` script or a workflow step naming the file, so
 * both the local gate sets and CI count. Reported, never fatal, for the same
 * reason the field scan is: a checker still being written has no caller yet.
 * @returns one line per uncalled gate.
 */
function uncalledGates() {
  const dir = join(REPO_ROOT, 'scripts/first100')
  // A `package.json` entry is a NAME, not a caller: a script nobody invokes is
  // the very shape this scan exists to catch, so being listed there does not
  // count. Only membership in an executed gate set or a workflow step does.
  const NOT_A_GATE = new Map([
    ['verify-fields-are-read.mjs', 'this scan — a reporter that always exits 0, so putting it in a gate set would add noise carrying no signal'],
    ['verify-cells-recomputable.mjs', 'exits 1 today on the KNOWN P1-02.P/F freeze drift; wiring a gate that is already red makes a later real regression indistinguishable from the standing failure (BLOCKED-057). Wire it the moment those two cells regreen — the exemption is timed, not permanent.'],
  ])
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts ?? {}
  // Reachability, not mention: start from what CI actually runs and follow
  // `pnpm run <name>` through the gate aggregates. A `package.json` entry that
  // nothing reaches is a name for a gate, not a caller of one — which is the
  // distinction the whole scan turns on.
  const workflows = join(REPO_ROOT, '.github/workflows')
  const callers = readdirSync(workflows)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map(name => readFileSync(join(workflows, name), 'utf8'))
  const reached = new Set()
  const frontier = callers.flatMap(text => [...text.matchAll(/(?:npm|pnpm) run ([\w:-]+)/g)].map(m => m[1]))
  while (frontier.length > 0) {
    const name = frontier.pop()
    if (reached.has(name) || scripts[name] === undefined) continue
    reached.add(name)
    callers.push(scripts[name])
    for (const match of scripts[name].matchAll(/(?:npm|pnpm) run ([\w:-]+)/g)) frontier.push(match[1])
  }
  // The weaker tier: a gate set someone must type. `first100:slice-gate-registry`
  // is reached by no workflow, so everything in it runs on a person remembering
  // to — worth telling apart from a gate wired to nothing at all.
  const manual = Object.values(scripts)
  return readdirSync(dir)
    .filter(name => name.startsWith('verify-') && name.endsWith('.mjs'))
    .filter(name => !callers.some(text => text.includes(`scripts/first100/${name}`)))
    .map(name => ({
      name,
      reason: NOT_A_GATE.get(name),
      inManualGateSet: manual.some(command => command.includes(`scripts/first100/${name}`)),
    }))
}

function main() {
  const uncalled = uncalledGates()
  const unexplained = uncalled.filter(gate => gate.reason === undefined && !gate.inManualGateSet)
  if (uncalled.length > 0) {
    console.log(`verify-fields-are-read: ${uncalled.length} gate(s) in scripts/first100 that nothing CI runs reaches:`)
    for (const { name, reason, inManualGateSet } of uncalled) {
      const status = reason !== undefined
        ? `deliberately not a gate: ${reason}`
        : inManualGateSet
          ? 'in a gate set no workflow runs — it fires only when someone types the command'
          : 'built, wired to nothing'
      console.log(`  ${name} -- ${status}`)
    }
  } else {
    console.log('verify-fields-are-read: every verify-*.mjs gate is reachable from something CI runs.')
  }
  if (unexplained.length > 0) {
    console.log(`  ${unexplained.length} of those reach no caller at all and carry no stated reason — a gate nobody runs records nothing.`)
  }

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
