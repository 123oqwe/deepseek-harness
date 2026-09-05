/**
 * Behavior of the per-epic start-of-work readiness gate.
 *
 * The gate replaces the program's wave barrier, so a false READY would let two
 * epics write one file concurrently and produce a merge conflict neither
 * epic's frozen command covers. Every case here therefore proves a rejection
 * path: each condition refuses independently, and each undecidable input
 * refuses rather than defaulting to a pass.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = 'scripts/first100/check-ready.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Build a throwaway repository root holding only the two inputs the gate reads,
 * so a case can state exactly the registry and ledger it is about.
 * @param registry - the epic rows to write to `tests/first100/registry.json`.
 * @param ledgerRows - the ledger rows to write to `spec/first100/exec/ledger.json`.
 * @returns the absolute path of the prepared root.
 */
function fixture(registry: unknown[], ledgerRows: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'first100-ready-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, 'tests/first100'), { recursive: true })
  mkdirSync(join(root, 'spec/first100/exec'), { recursive: true })
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  writeFileSync(join(root, 'tests/first100/registry.json'), JSON.stringify(registry))
  writeFileSync(join(root, 'spec/first100/exec/ledger.json'), JSON.stringify({ rows: ledgerRows }))
  cpSync(join(REPO, SCRIPT), join(root, SCRIPT))
  return root
}

/**
 * Run the gate inside a fixture root and capture its verdict.
 * @param root - the prepared repository root to run in.
 * @param args - arguments to pass after the script path.
 * @returns the exit status and combined output.
 */
function run(root: string, ...args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(root, SCRIPT), ...args], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, output }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` }
  }
}

const accepted = { status: 'ACCEPTED', cells: {} }
const notStarted = { status: 'NOT_RUN', cells: { C: { status: 'NOT_RUN' } } }
const inFlight = { status: 'NOT_RUN', cells: { C: { status: 'GREEN' }, P: { status: 'NOT_RUN' } } }

/**
 * The listing's ready section only — every line before the diagnostic counts.
 *
 * The assertions below mean "this epic is not startable", and checking the
 * whole output for its id stopped expressing that once the listing began
 * naming blocked epics too. Scoping to the ready section keeps the assertion
 * about startability rather than about mentions.
 */
function readySection(output: string): string {
  return output.split('\n  in flight:')[0] ?? output
}

describe('first100 readiness gate', () => {
  it('admits an epic whose predecessors are all ACCEPTED and whose files no in-flight epic touches', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: ['A'], files: ['b.ts'], stages: {} },
      ],
      { A: accepted, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(0)
    expect(output).toContain('READY: B')
  })

  it('refuses on an unaccepted predecessor even when no file overlaps', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: ['A'], files: ['b.ts'], stages: {} },
      ],
      { A: inFlight, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('predecessor A is NOT_RUN and has not landed every applicable stage cell')
  })

  it('refuses on a declared-file overlap with an in-flight epic even when every predecessor is ACCEPTED', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'X', wave: 1, predecessors: [], files: ['shared.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
      ],
      { A: accepted, X: inFlight, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('shares 1 file(s) with in-flight X: shared.ts')
  })

  it('ignores a file overlap with an already-ACCEPTED epic, whose writes have landed', () => {
    const root = fixture(
      [
        { id: 'X', wave: 1, predecessors: [], files: ['shared.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: [], files: ['shared.ts'], stages: {} },
      ],
      { X: accepted, B: notStarted },
    )
    expect(run(root, 'B').code).toBe(0)
  })

  it('ignores a file overlap with an epic that has not started, which holds no write lock', () => {
    const root = fixture(
      [
        { id: 'X', wave: 1, predecessors: [], files: ['shared.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: [], files: ['shared.ts'], stages: {} },
      ],
      { X: notStarted, B: notStarted },
    )
    expect(run(root, 'B').code).toBe(0)
  })

  it('detects an overlap declared only in a stage file list, not in the top-level files list', () => {
    const root = fixture(
      [
        { id: 'X', wave: 1, predecessors: [], files: ['x.ts'], stages: { P: { files: ['shared.ts'] } } },
        { id: 'B', wave: 2, predecessors: [], files: ['b.ts'], stages: { C: { files: ['shared.ts'] } } },
      ],
      { X: inFlight, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('shared.ts')
  })

  it('starts an epic whose predecessors are ACCEPTED without waiting for unrelated epics in the same wave', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'SLOW', wave: 2, predecessors: ['A'], files: ['slow.ts'], stages: {} },
        { id: 'B', wave: 3, predecessors: ['A'], files: ['b.ts'], stages: {} },
      ],
      { A: accepted, SLOW: inFlight, B: notStarted },
    )
    expect(run(root, 'B').code).toBe(0)
  })

  it('refuses an epic id absent from the registry rather than treating it as unconstrained', () => {
    const root = fixture([{ id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} }], { A: accepted })
    const { code, output } = run(root, 'GHOST')
    expect(code).toBe(1)
    expect(output).toContain('NOT READY (undecidable)')
  })

  it('refuses when a predecessor has no ledger row, rather than skipping the unverifiable condition', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'B', wave: 2, predecessors: ['A'], files: ['b.ts'], stages: {} },
      ],
      { B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('predecessor A has no ledger row')
  })

  it('refuses when the epic declares no files, because no file-overlap verdict can be computed', () => {
    const root = fixture([{ id: 'B', wave: 1, predecessors: [], files: [], stages: {} }], { B: notStarted })
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('declares no files')
  })

  it('refuses when an in-flight epic declares no files, because its write lock is unbounded', () => {
    const root = fixture(
      [
        { id: 'X', wave: 1, predecessors: [], files: [], stages: {} },
        { id: 'B', wave: 2, predecessors: [], files: ['b.ts'], stages: {} },
      ],
      { X: inFlight, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('declares no files')
  })

  it('refuses when an in-flight ledger row has no registry entry, whose file set is unknowable', () => {
    const root = fixture([{ id: 'B', wave: 1, predecessors: [], files: ['b.ts'], stages: {} }], {
      PHANTOM: inFlight,
      B: notStarted,
    })
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('has no registry entry')
  })

  it('refuses when the ledger is unreadable rather than assuming an empty ledger blocks nothing', () => {
    const root = fixture([{ id: 'B', wave: 1, predecessors: [], files: ['b.ts'], stages: {} }], { B: notStarted })
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), '{ not json')
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('NOT READY (undecidable)')
  })

  it('refuses when the ledger has no rows key, rather than reading it as zero in-flight epics', () => {
    const root = fixture([{ id: 'B', wave: 1, predecessors: [], files: ['b.ts'], stages: {} }], { B: notStarted })
    writeFileSync(join(root, 'spec/first100/exec/ledger.json'), '{}')
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('no "rows"')
  })

  it('starts an epic whose predecessor is fully GREEN but not yet ACCEPTED', () => {
    // BLOCKED-087's confusion in its second location. A predecessor expresses
    // "I need your work to exist", never "I need your books closed" -- and an
    // epic held back only by an unproven clause has still delivered every file.
    const root = fixture(
      [
        {
          id: 'LANDED',
          wave: 1,
          predecessors: [],
          files: ['a.ts'],
          stages: { C: { nOf: null }, P: { nOf: 'N/A' }, U: { nOf: 'N/A' }, F: { nOf: 'N/A' } },
        },
        { id: 'NEXT', wave: 2, predecessors: ['LANDED'], files: ['n.ts'], stages: {} },
      ],
      { LANDED: { ...notStarted, cells: { C: { status: 'GREEN' } } }, NEXT: notStarted },
    )
    const { code, output } = run(root, 'NEXT')

    expect(code).toBe(0)
    expect(output).toContain('READY: NEXT')
  })

  it('still refuses when the predecessor has only SOME cells GREEN', () => {
    // The other direction, so the change is a separation of two facts and not
    // a relaxation: a predecessor genuinely mid-work still blocks.
    const root = fixture(
      [
        {
          id: 'PARTIAL',
          wave: 1,
          predecessors: [],
          files: ['a.ts'],
          stages: { C: { nOf: null }, P: { nOf: null }, U: { nOf: 'N/A' }, F: { nOf: 'N/A' } },
        },
        { id: 'NEXT', wave: 2, predecessors: ['PARTIAL'], files: ['n.ts'], stages: {} },
      ],
      {
        PARTIAL: { ...notStarted, cells: { C: { status: 'GREEN' }, P: { status: 'NOT_RUN' } } },
        NEXT: notStarted,
      },
    )
    const { code, output } = run(root, 'NEXT')

    expect(code).toBe(1)
    expect(output).toContain('has not landed every applicable stage cell')
  })

  it('separates a zero count into its causes, so the listing can be read without the ledger', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'X', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
        { id: 'BLOCKED_FILE', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
        { id: 'BLOCKED_DEP', wave: 3, predecessors: ['X'], files: ['d.ts'], stages: {} },
      ],
      { A: accepted, X: inFlight, BLOCKED_FILE: notStarted, BLOCKED_DEP: notStarted },
    )
    const { code, output } = run(root)

    // The point of the block: '0 ready' now carries WHY. This exact string was
    // the sole symptom of BLOCKED-087 and was indistinguishable from a program
    // where everything is legitimately busy.
    expect(code).toBe(0)
    expect(output).toContain('0 epic(s) ready to start')
    expect(output).toContain('in flight: 1 — X')
    expect(output).toContain('blocked by predecessors: 1 — BLOCKED_DEP')
    expect(output).toContain('blocked by file overlap: 1 — BLOCKED_FILE')
  })

  it('counts an epic blocked by BOTH conditions under predecessors, not twice', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'X', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
        { id: 'BOTH', wave: 3, predecessors: ['X'], files: ['shared.ts'], stages: {} },
      ],
      { A: accepted, X: inFlight, BOTH: notStarted },
    )
    const { code, output } = run(root)

    expect(code).toBe(0)
    expect(output).toContain('blocked by predecessors: 1 — BOTH')
    expect(output).toContain('blocked by file overlap: 0')
    expect(output).toContain('(2 of 2 non-ACCEPTED epics accounted for)')
  })

  it('reports a finished-but-unaccepted epic under awaiting acceptance, so the counts reconcile', () => {
    const root = fixture(
      [
        {
          id: 'DONE',
          wave: 1,
          predecessors: [],
          files: ['d.ts'],
          // All four stages declared, three N/A -- the shape every one of the
          // 101 registry epics actually has. An ABSENT stage counts as
          // applicable and so can never be green, which keeps the epic in
          // flight: unreachable with real data, and fail-closed if it ever is.
          stages: { C: { nOf: null }, P: { nOf: 'N/A' }, U: { nOf: 'N/A' }, F: { nOf: 'N/A' } },
        },
        { id: 'FRESH', wave: 2, predecessors: [], files: ['f.ts'], stages: {} },
      ],
      { DONE: { ...notStarted, cells: { C: { status: 'GREEN' } } }, FRESH: notStarted },
    )
    const { code, output } = run(root)

    // DONE is neither startable nor in flight. Without a bucket of its own it
    // would vanish from the listing, and the totals would silently disagree --
    // which is the failure the reconciliation line exists to catch.
    expect(code).toBe(0)
    expect(output).toContain('awaiting acceptance: 1 — DONE')
    expect(output).toContain('(2 of 2 non-ACCEPTED epics accounted for)')
  })

  it('lists only the epics that pass both conditions when given no epic id', () => {
    const root = fixture(
      [
        { id: 'A', wave: 1, predecessors: [], files: ['a.ts'], stages: {} },
        { id: 'X', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
        { id: 'READY', wave: 2, predecessors: ['A'], files: ['r.ts'], stages: {} },
        { id: 'BLOCKED_FILE', wave: 2, predecessors: ['A'], files: ['shared.ts'], stages: {} },
        { id: 'BLOCKED_DEP', wave: 3, predecessors: ['X'], files: ['d.ts'], stages: {} },
      ],
      { A: accepted, X: inFlight, READY: notStarted, BLOCKED_FILE: notStarted, BLOCKED_DEP: notStarted },
    )
    const { code, output } = run(root)
    expect(code).toBe(0)
    expect(output).toContain('1 epic(s) ready')
    expect(output).toContain('READY')
    expect(readySection(output)).not.toContain('BLOCKED_FILE')
    expect(readySection(output)).not.toContain('BLOCKED_DEP')
  })

  it('names every shared path when two in-flight epics overlap, however many there are', () => {
    // The mechanism case for cross-epic conflicts. It was previously written
    // against the live registry and ledger, asserting two specific paths — a
    // hand-maintained list in everything but name, inside a case whose own
    // comment claimed not to be one. Program progress (an epic accepted, its
    // predecessor satisfied) legitimately changed those inputs, the gate
    // stopped at the predecessor condition before reaching the file check, and
    // CI went red on a correct gate. The shape is what this pins; the live
    // inputs are covered by the smoke case below, which asserts no specific
    // path.
    const root = fixture(
      [
        { id: 'X', wave: 1, predecessors: [], files: ['a.ts'], stages: { P: { files: ['b.ts', 'c.ts'] } } },
        { id: 'B', wave: 2, predecessors: [], files: ['c.ts'], stages: { C: { files: ['a.ts'] } } },
      ],
      { X: inFlight, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('shares 2 file(s) with in-flight X')
    expect(output).toContain('a.ts')
    expect(output).toContain('c.ts')
    // `b.ts` belongs to X alone, so naming it would be over-reporting.
    expect(readySection(output)).not.toContain('b.ts')
  })

  it('smoke: runs against the live registry and ledger without crashing, and refuses an epic it cannot admit', () => {
    // Deliberately asserts no specific epic, path, or count: every one of those
    // changes as the program advances, and pinning them turns ordinary progress
    // into a red gate.
    //
    // The first version of this case honoured that in its ASSERTIONS and broke
    // it in its SUBJECT: it called the gate on a hard-coded `P1-03`, whose
    // refusal was the precondition for all three assertions being observable
    // at all. When BLOCKED-087's condition-1 fix made P1-03 startable, this
    // case went red because the program had ADVANCED — the exact failure its
    // own comment forbids. Choosing a different epic that "should stay
    // blocked" would move the trap rather than remove it.
    //
    // So the subject is drawn from the ledger too. A listing with nothing
    // refused is a legitimate state (every epic startable) and must not be a
    // failure, so that case asserts the listing itself instead.
    const listing = run(REPO)
    expect(listing.code).toBe(0)
    const blocked = /^ {2}(?:blocked by predecessors|blocked by file overlap): \d+ — (\S+)/mu.exec(listing.output)
    if (blocked === null) {
      expect(listing.output).toContain('non-ACCEPTED epics accounted for')
      return
    }

    const { code, output } = run(REPO, blocked[1] ?? '')
    expect(code).toBe(1)
    expect(output).toContain('NOT READY')
    expect(output).toMatch(/ {2}- \S/u)
  })
})

describe('first100 readiness gate: a finished epic releases its file locks (BLOCKED-087)', () => {
  const allGreen = { status: 'NOT_RUN', cells: { C: { status: 'GREEN' }, U: { status: 'GREEN' }, F: { status: 'GREEN' } } }
  const partlyGreen = { status: 'NOT_RUN', cells: { C: { status: 'GREEN' }, U: { status: 'NOT_RUN' }, F: { status: 'NOT_RUN' } } }
  const threeStages = { C: { files: [] }, P: { nOf: 'N/A' }, U: { files: [] }, F: { files: [] } }

  it('releases the lock when every applicable cell is GREEN, since its writes have landed', () => {
    // An acceptance lock says a clause is unproven; it says nothing about
    // whether files are still moving. Holding them would block a conflict that
    // can no longer happen.
    const root = fixture(
      [
        { id: 'DONE', wave: 1, predecessors: [], files: ['shared.ts'], stages: threeStages },
        { id: 'B', wave: 2, predecessors: [], files: ['shared.ts'], stages: {} },
      ],
      { DONE: allGreen, B: notStarted },
    )
    expect(run(root, 'B').code).toBe(0)
  })

  it('KEEPS the lock when only some cells are GREEN, because that epic is genuinely still writing', () => {
    // The opposite direction, without which the release above is
    // indistinguishable from deleting the file-overlap condition entirely.
    const root = fixture(
      [
        { id: 'MIDWAY', wave: 1, predecessors: [], files: ['shared.ts'], stages: threeStages },
        { id: 'B', wave: 2, predecessors: [], files: ['shared.ts'], stages: {} },
      ],
      { MIDWAY: partlyGreen, B: notStarted },
    )
    const { code, output } = run(root, 'B')
    expect(code).toBe(1)
    expect(output).toContain('shares 1 file(s) with in-flight MIDWAY')
  })

  it('counts an N/A stage as satisfied, so a three-stage epic is not held open by a stage it never had', () => {
    // P is declared N/A for several epics; requiring GREEN there would make
    // every such epic permanently in flight.
    const root = fixture(
      [
        { id: 'DONE', wave: 1, predecessors: [], files: ['shared.ts'], stages: threeStages },
        { id: 'B', wave: 2, predecessors: [], files: ['shared.ts'], stages: {} },
      ],
      { DONE: { status: 'NOT_RUN', cells: { C: { status: 'GREEN' }, P: { status: 'NOT_RUN' }, U: { status: 'GREEN' }, F: { status: 'GREEN' } } }, B: notStarted },
    )
    expect(run(root, 'B').code).toBe(0)
  })

  it('does not list a finished epic as startable, since it is waiting on acceptance rather than capacity', () => {
    const root = fixture(
      [
        { id: 'DONE', wave: 1, predecessors: [], files: ['a.ts'], stages: threeStages },
        { id: 'FRESH', wave: 2, predecessors: [], files: ['b.ts'], stages: {} },
      ],
      { DONE: allGreen, FRESH: notStarted },
    )
    const { output } = run(root)
    expect(output).toContain('FRESH')
    expect(readySection(output)).not.toContain('DONE')
  })
})
