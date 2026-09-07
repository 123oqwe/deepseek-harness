/**
 * Behavior of acceptance predicate (v): a GREEN cell's frozen cases must exist
 * in the tree that was observed.
 *
 * Every case runs the real script against a real throwaway git repository,
 * because the whole point of the check is that it reads a COMMIT rather than a
 * timestamp — a fixture that stubbed `git show` would test the comparison and
 * leave the only interesting part unexercised.
 *
 * The pairs matter: a case proving absence is detected is worthless without
 * the case proving presence passes, since a scan that always reported MISSING
 * would satisfy the first on its own.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = 'scripts/first100/verify-freeze-in-candidate-tree.mjs'
const FREEZE = 'spec/first100/exec/command-freeze.json'
const LEDGER = 'spec/first100/exec/ledger.json'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()

/**
 * A throwaway git repository holding a committed freeze file, plus the script.
 * @param committed - the freeze entries to commit (the "observed tree").
 * @returns the root path and the commit SHA of that tree.
 */
function repoWith(committed: unknown[]): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), 'freeze-tree-'))
  roots.push(root)
  mkdirSync(join(root, 'spec/first100/exec'), { recursive: true })
  mkdirSync(join(root, 'scripts/first100'), { recursive: true })
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'test')
  writeFileSync(join(root, FREEZE), JSON.stringify({ entries: committed }))
  git(root, 'add', FREEZE)
  git(root, 'commit', '-q', '-m', 'observed tree')
  cpSync(join(REPO, SCRIPT), join(root, SCRIPT))
  return { root, sha: git(root, 'rev-parse', 'HEAD') }
}

/**
 * Overwrite the working-tree freeze file (the "live" entries) and the ledger.
 * @param root - the prepared repository root.
 * @param live - the live freeze entries, which may differ from the committed ones.
 * @param rows - the ledger rows.
 */
function withLive(root: string, live: unknown[], rows: Record<string, unknown>): void {
  writeFileSync(join(root, FREEZE), JSON.stringify({ entries: live }))
  writeFileSync(join(root, LEDGER), JSON.stringify({ rows }))
}

function run(root: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync(process.execPath, [join(root, SCRIPT)], { cwd: root, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string }
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` }
  }
}

const entry = (epic: string, stage: string, cases: string[]) => ({ epic, stage, expectCases: cases })
const greenRow = (stage: string, sha: string) => ({ cells: { [stage]: { status: 'GREEN', candidateSha: sha } } })

describe('first100 predicate (v): the freeze must exist in the observed tree', () => {
  it('VERIFIES a cell whose live freeze entry is present in its candidate tree', () => {
    const committed = [entry('P9-99', 'C', ['pins the thing'])]
    const { root, sha } = repoWith(committed)
    withLive(root, committed, { 'P9-99': greenRow('C', sha) })
    const { code, output } = run(root)
    expect(code).toBe(0)
    expect(output).toContain('every live freeze entry is present')
  })

  it('reports MISSING when the freeze entry is absent from the candidate tree entirely', () => {
    const { root, sha } = repoWith([])
    withLive(root, [entry('P9-99', 'C', ['pins the thing'])], { 'P9-99': greenRow('C', sha) })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('MISSING  P9-99.C')
  })

  it('reports MISSING when the entry exists but its TITLE SET changed after the observation', () => {
    // The defect this is really for: an entry present under the same
    // (epic, stage) whose cases were edited to fit what the run produced. It
    // is not absence, and matching on epic/stage alone would call it a pass.
    const { root, sha } = repoWith([entry('P9-99', 'C', ['pins the thing'])])
    withLive(root, [entry('P9-99', 'C', ['pins the thing', 'and one added afterwards'])], { 'P9-99': greenRow('C', sha) })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('MISSING  P9-99.C')
  })

  it('accepts a title set committed in a different ORDER, which is the same commitment', () => {
    // The counterpart to the case above: order is not part of the promise, so
    // treating a reordering as a violation would produce failures nobody can
    // act on and train readers to ignore the gate.
    const { root, sha } = repoWith([entry('P9-99', 'C', ['beta', 'alpha'])])
    withLive(root, [entry('P9-99', 'C', ['alpha', 'beta'])], { 'P9-99': greenRow('C', sha) })
    expect(run(root).code).toBe(0)
  })

  it('reports UNREADABLE, never a pass, when the candidate SHA is not in this clone', () => {
    const { root } = repoWith([])
    withLive(root, [entry('P9-99', 'C', ['pins the thing'])], { 'P9-99': greenRow('C', '0000000000000000000000000000000000000000') })
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('UNREADABLE  P9-99.C')
  })

  it('ignores a SUPERSEDED live entry, which is no longer a commitment', () => {
    const { root, sha } = repoWith([entry('P9-99', 'C', ['pins the thing'])])
    withLive(
      root,
      [{ ...entry('P9-99', 'C', ['an old promise']), supersededBy: 'P9-99.C (2026-09-06)' }, entry('P9-99', 'C', ['pins the thing'])],
      { 'P9-99': greenRow('C', sha) },
    )
    expect(run(root).code).toBe(0)
  })

  it('checks a SUPPLEMENT against its own candidate tree, not the primary cell\'s', () => {
    // A supplement is a separate observation with its own candidate SHA. Before
    // this was separated, adding a new supplement entry made the PRIMARY cell
    // report a missing record that was never the primary cell's to carry --
    // this gate reporting a false positive against its own author.
    const primary = entry('P9-99', 'U', ['the primary promise'])
    const { root, sha } = repoWith([primary])
    writeFileSync(join(root, FREEZE), JSON.stringify({ entries: [primary, { ...entry('P9-99', 'U', ['the supplement promise']), supplementSeq: 1 }] }))
    writeFileSync(join(root, LEDGER), JSON.stringify({
      rows: { 'P9-99': { cells: { U: { status: 'GREEN', candidateSha: sha } }, supplements: {} } },
    }))
    // The primary cell passes: the supplement's entry is not its commitment.
    expect(run(root).code).toBe(0)
  })

  it('reports MISSING for a GREEN supplement whose own freeze entry is absent from its candidate tree', () => {
    // The other direction, without which the case above is satisfied by a gate
    // that simply ignores supplements entirely.
    const primary = entry('P9-99', 'U', ['the primary promise'])
    const { root, sha } = repoWith([primary])
    writeFileSync(join(root, FREEZE), JSON.stringify({ entries: [primary, { ...entry('P9-99', 'U', ['the supplement promise']), supplementSeq: 1 }] }))
    writeFileSync(join(root, LEDGER), JSON.stringify({
      rows: { 'P9-99': { cells: { U: { status: 'GREEN', candidateSha: sha } }, supplements: { 'U.1': { status: 'GREEN', candidateSha: sha } } } },
    }))
    const { code, output } = run(root)
    expect(code).toBe(1)
    expect(output).toContain('MISSING  P9-99.U.1')
  })

  it('ignores a cell that is not GREEN, which has made no claim to check', () => {
    const { root } = repoWith([])
    writeFileSync(join(root, FREEZE), JSON.stringify({ entries: [entry('P9-99', 'C', ['pins the thing'])] }))
    writeFileSync(join(root, LEDGER), JSON.stringify({ rows: { 'P9-99': { cells: { C: { status: 'NOT_RUN' } } } } }))
    expect(run(root).code).toBe(0)
  })
})
