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
 * Usage: `node scripts/first100/verify-frozen-titles-in-tree.mjs`
 *
 * @module scripts/first100/verify-frozen-titles-in-tree
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')
const COMMAND_FREEZE_PATH = join(REPO_ROOT, 'spec/first100/exec/command-freeze.json')
const RENAMES_PATH = join(REPO_ROOT, 'spec/first100/exec/frozen-title-renames.json')

/**
 * The registered rename for each frozen title, old name to new.
 *
 * A renamed case is not a deleted one, and the register already exists to say
 * so — `verify-frozen-titles-resolvable.mjs` has consulted it since BLOCKED-040.
 * Omitting it here made this gate report P0-05.C's renamed case as an orphan
 * whose replacement was sitting in the register the whole time: a gate that
 * reports a recorded fact as a finding trains its reader to ignore it.
 * @returns the mapping, keyed by the old title.
 */
function registeredRenames() {
  const register = JSON.parse(readFileSync(RENAMES_PATH, 'utf8'))
  return new Map(register.entries.map(entry => [entry.oldTitle, entry.newTitle]))
}

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
  const raw = execFileSync('pnpm', ['exec', 'vitest', 'list', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const entries = JSON.parse(raw.slice(raw.indexOf('[')))
  const names = new Set()
  for (const entry of entries) {
    const segments = String(entry.name).split(' > ')
    names.add(segments.join(' '))
    names.add(segments[segments.length - 1] ?? '')
  }
  return names
}

function main() {
  const freeze = JSON.parse(readFileSync(COMMAND_FREEZE_PATH, 'utf8'))
  // Live entries only: a superseded entry describes a past state on purpose.
  const live = new Map()
  for (const entry of freeze.entries) {
    if (entry.supersededBy !== undefined) continue
    live.set(`${entry.epic}.${entry.stage}`, entry)
  }
  const producible = collectProducibleTitles()
  const renames = registeredRenames()

  const orphans = []
  for (const [key, entry] of live) {
    for (const title of entry.expectCases) {
      if (producible.has(title)) continue
      const renamed = renames.get(title)
      if (renamed !== undefined && producible.has(renamed)) continue
      orphans.push({ key, title, ...renamed === undefined ? {} : { renamed } })
    }
  }

  if (orphans.length === 0) {
    console.log(
      `verify-frozen-titles-in-tree: every live frozen title is produced by a real test `
      + `(${String(live.size)} cells against ${String(producible.size)} collected names).`,
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
