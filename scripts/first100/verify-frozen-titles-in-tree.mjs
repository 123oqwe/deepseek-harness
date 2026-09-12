/**
 * Refuse a frozen case title that no test in the tree can produce.
 *
 * The recomputation gate compares a cell against the observation it names, and
 * catches a deleted case only AFTER a run. This one asks the same question of
 * the source: for every live frozen title, does a test still exist that could
 * emit it?
 *
 * It exists because the rule already existed and nothing read it. Replacing a
 * frozen case requires superseding its freeze entry (BLOCKED-103), and twice in
 * one day a replacement shipped without one — P5-11's must[2] cases in the
 * morning, and P1-02's two KNOWN GAP cases in the afternoon, deleted the moment
 * their unlock signal fired. Both were caught by a person reading. The rule
 * lived in a queue entry, and the moment of deletion consulted nothing.
 *
 * **Titles come from `vitest list`, not from reading the source.** A first
 * version matched frozen titles against string literals in the test files and
 * was abandoned: `it.each` builds names from data, so the literal never appears
 * whole. Loosening the match to tolerate that produced a checker that reported
 * ZERO orphans — including the two titles known to be deleted — which is a gate
 * that cannot fail. `vitest list` collects without executing and reports the
 * exact names the suite would produce, so the comparison is an equality rather
 * than a guess.
 *
 * Collection takes about a minute and a half on this repository, which is why
 * this is a pre-push check rather than something wired into every commit.
 *
 * **Every live entry is checked, not one per cell.** Selecting by `epic.stage`
 * let a supplement hide its own base entry's orphans (BLOCKED-226); see
 * {@link findOrphans}.
 *
 * Usage: `node scripts/first100/verify-frozen-titles-in-tree.mjs`
 *
 * @module scripts/first100/verify-frozen-titles-in-tree
 */
import { frozenTitlePresent, registeredRenames } from './frozen-title-renames.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const COMMAND_FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')


/**
 * Every test name the suite can produce, as vitest reports them.
 *
 * `vitest list` joins a describe chain with ` > ` while a frozen `fullName`
 * joins with a space, so the separator is normalized here — the two spellings
 * name the same test.
 * Both spellings are collected: the full name, and the bare `it` text alone.
 * Freezes recorded before the BLOCKED-104 fullName migration hold bare titles,
 * and this gate asks only whether a test could produce the title — the
 * ambiguity BLOCKED-104 cared about belongs to greening, where a bare title may
 * match more than one case.
 * @returns the producible names, in both spellings.
 */
export function collectProducibleTitles() {
  let raw
  try {
    raw = execFileSync('pnpm', ['exec', 'vitest', 'list', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      // stderr is CAPTURED, not discarded. Discarding it made every failure of
      // this step read as a bare `Command failed` with no cause: a CI run that
      // lost the collection after four minutes reported the `execFileSync`
      // line and nothing about why, and the same command succeeds locally
      // (exit 0, ~4m40s wall, 5.5 MB of JSON), so the log was the only place
      // the difference could have been visible.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const stderr = String(/** @type {{ stderr?: unknown }} */ (error).stderr ?? '').trim()
    const signal = /** @type {{ signal?: unknown }} */ (error).signal
    throw new Error(
      `vitest list --json did not complete, so no frozen title could be checked against the tree.\n`
      + `This step loads every test file without running it; it takes minutes and is memory-hungry, `
      + `so a host that kills it reports the same "Command failed" as a genuine load error.\n`
      + `signal: ${String(signal ?? 'none')}\n`
      + `stderr:\n${stderr === '' ? '(the child wrote nothing to stderr — consistent with being killed rather than failing)' : stderr}`,
      { cause: error },
    )
  }
  const entries = JSON.parse(raw.slice(raw.indexOf('[')))
  const names = new Set()
  for (const entry of entries) {
    const segments = String(entry.name).split(' > ')
    names.add(segments.join(' '))
    names.add(segments[segments.length - 1] ?? '')
  }
  return names
}

/**
 * Every frozen title no test produces, across EVERY live freeze entry.
 *
 * **One entry per (epic, stage) was the bug (BLOCKED-226).** This used to build
 * a `Map` keyed by `epic.stage`, so each later entry for a cell overwrote the
 * earlier one and only the last survived the check. A cell with a base entry
 * and a supplement therefore had its base entry's titles read by nothing —
 * measured on P4-12.C, where the base held two titles that no test produced
 * and the gate reported zero orphans for that cell because the live supplement
 * C.2 had taken the key. BLOCKED-103's rule ("a replaced case needs its freeze
 * superseded") was being enforced against the newest entry per cell alone.
 *
 * Liveness is `supersededBy`, and that is the whole selection: an entry the
 * freeze marks superseded describes a past state on purpose, and every other
 * entry is a promise something in the tree must still be able to keep.
 * @param entries - `command-freeze.json`'s entries, live and superseded alike.
 * @param producible - every test name the suite can produce.
 * @param renames - the registered renames, from `registeredRenames`.
 * @returns one record per orphaned title, naming the entry that holds it.
 */
export function findOrphans(entries, producible, renames) {
  const orphans = []
  for (const entry of entries) {
    if (entry.supersededBy !== undefined) continue
    // The supplement sequence is part of the label because it is part of the
    // address: "P4-12.F" and "P4-12.F.2" are different promises, and a reader
    // fixing an orphan needs to know which entry to supersede.
    const key = entry.supplementSeq === undefined
      ? `${entry.epic}.${entry.stage}`
      : `${entry.epic}.${entry.stage}.${String(entry.supplementSeq)}`
    for (const title of entry.expectCases) {
      if (frozenTitlePresent(title, producible, renames, entry.epic, entry.stage)) continue
      orphans.push({ key, title })
    }
  }
  return orphans
}

function main() {
  const freeze = JSON.parse(readFileSync(COMMAND_FREEZE_PATH, 'utf8'))
  const liveCount = freeze.entries.filter((entry) => entry.supersededBy === undefined).length
  const producible = collectProducibleTitles()
  const renames = registeredRenames()

  const orphans = findOrphans(freeze.entries, producible, renames)

  if (orphans.length === 0) {
    console.log(
      `verify-frozen-titles-in-tree: every live frozen title is produced by a real test `
      + `(${String(liveCount)} live entries against ${String(producible.size)} collected names).`,
    )
    return
  }
  console.error(
    `verify-frozen-titles-in-tree: ${String(orphans.length)} frozen title(s) no test produces. A replaced or deleted case `
    + 'needs its freeze entry superseded (BLOCKED-103), not left pointing at a title that is gone:',
  )
  for (const { key, title, renamed } of orphans) {
    console.error(`  ${key}: ${title}`)
    // A registered rename that ALSO names nothing producible is worse than an
    // unregistered one: the register says the replacement exists.
    if (renamed !== undefined) console.error(`    registered rename to "${renamed}", which no test produces either`)
  }
  process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
