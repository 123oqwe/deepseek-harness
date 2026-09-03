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
    expect(output).toContain('predecessor A is NOT_RUN, not ACCEPTED')
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
    expect(output).not.toContain('BLOCKED_FILE')
    expect(output).not.toContain('BLOCKED_DEP')
  })

  it('reproduces the three real cross-epic file conflicts in the live registry and ledger', () => {
    // P1-03 is the epic all three recorded conflicts converge on; the gate must
    // name each one from the real inputs, not from a hand-maintained list.
    const { code, output } = run(REPO, 'P1-03')
    expect(code).toBe(1)
    expect(output).toContain('apps/cli/src/profile-boot.ts')
    expect(output).toContain('packages/bundle/base/cordis.patch.yml')
  })
})
