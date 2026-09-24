/**
 * Which freeze entries the in-tree gate actually reads (BLOCKED-226).
 *
 * The gate selected one entry per `epic.stage`, so a cell carrying both a base
 * entry and a supplement had the base entry's titles read by nothing. These
 * cases pin the selection rule, because that is where the defect was: the
 * title comparison was always correct, and it was simply not reached.
 *
 * `findOrphans` is driven directly rather than through the gate's process. The
 * gate's other half runs `vitest list` over the whole repository, which takes
 * minutes and would make these cases measure collection rather than selection.
 * The `--e2e-report` cases run the gate's process in a fixture tree whose
 * `pnpm` stands in for that listing.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { findOrphans } from './verify-frozen-titles-in-tree.mjs'
import type { InTreeFreezeEntry } from './verify-frozen-titles-in-tree.d.mts'

const entry = (over: Partial<InTreeFreezeEntry> = {}): InTreeFreezeEntry =>
  ({ epic: 'P4-12', stage: 'C', expectCases: ['a case that exists'], ...over })

const noRenames = new Map<string, string>()

describe('BLOCKED-226: every live entry is checked, not the last one per cell', () => {
  it('reports the BASE entry\'s vanished title when a live supplement exists for the same cell', () => {
    // The measured defect. Keying by `epic.stage` let the supplement overwrite
    // the base, so this orphan was invisible and the cell reported clean.
    const orphans = findOrphans(
      [entry({ expectCases: ['a title no test produces'] }), entry({ supplementSeq: 2, expectCases: ['a case that exists'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans).toEqual([{ key: 'P4-12.C', title: 'a title no test produces' }])
  })

  it('reports a SUPPLEMENT\'s vanished title under its own sequence, so the reader knows which entry to supersede', () => {
    // `P4-12.C` and `P4-12.C.2` are different promises. A label that named only
    // the cell would send a reader to supersede the wrong entry.
    const orphans = findOrphans(
      [entry(), entry({ supplementSeq: 2, expectCases: ['a supplement title that is gone'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans).toEqual([{ key: 'P4-12.C.2', title: 'a supplement title that is gone' }])
  })

  it('ignores a SUPERSEDED entry, because it describes a past state on purpose', () => {
    // The control that keeps the rule above from becoming "check everything
    // ever frozen": superseding an entry is how a replaced case is recorded,
    // and re-reporting it would make the correct procedure fail the gate.
    expect(findOrphans(
      [entry({ expectCases: ['a title no test produces'], supersededBy: 'P4-12.C.3 (2026-09-12)' })],
      new Set(['a case that exists']),
      noRenames,
    )).toEqual([])
  })

  it('reports every orphan across two live entries for one cell, rather than stopping at the first', () => {
    const orphans = findOrphans(
      [entry({ expectCases: ['gone from the base'] }), entry({ supplementSeq: 1, expectCases: ['gone from the supplement'] })],
      new Set(['a case that exists']),
      noRenames,
    )
    expect(orphans.map(orphan => orphan.key)).toEqual(['P4-12.C', 'P4-12.C.1'])
  })

  it('resolves a title through the rename registered for its own cell', () => {
    // The gate's existing contract, asserted here because the selection change
    // moved the code that consults the register.
    expect(findOrphans(
      [entry({ expectCases: ['the old title'] })],
      new Set(['the new title']),
      new Map([['P4-12|C|the old title', 'the new title']]),
    )).toEqual([])
  })
})

/** The modules the gate loads, copied beside it into each fixture tree. */
const GATE_MODULES = ['verify-frozen-titles-in-tree.mjs', 'frozen-title-renames.mjs', 'verify-frozen-titles-resolvable.mjs']

/** Stands in for `pnpm exec vitest list --json`: the default config lists the unit case and no e2e case. */
const LISTING_PNPM = `#!/usr/bin/env node
process.stdout.write(JSON.stringify([{ name: 'unit suite > a unit case', file: '/tree/packages/g/p/tests/a.spec.ts' }]))
`

/** An e2e run's `--reporter=json` report carrying the one case the fixture freeze names. */
const E2E_REPORT = JSON.stringify({
  testResults: [{
    name: '/tree/apps/cli/tests/a.e2e.ts',
    assertionResults: [{ title: 'takes over the Run', fullName: 'acp host takes over the Run', status: 'passed' }],
  }],
})

const trees: string[] = []
afterEach(() => { for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true }) })

/**
 * Runs the gate in a tree whose freeze holds one entry frozen under the e2e config.
 * @param gateArgs - the arguments after the gate's path.
 * @returns the gate's exit status and its stdout and stderr together.
 */
function runGateOverE2eFreeze(gateArgs: readonly string[]): { status: number | null; output: string } {
  // The real path, because the gate runs `main` only when argv[1] equals its own module path, and the OS temp
  // directory is a symlink on macOS.
  const tree = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-in-tree-e2e-')))
  trees.push(tree)
  const written: Record<string, string> = {
    'spec/first100/exec/command-freeze.json': JSON.stringify({ entries: [{
      epic: 'P4-05',
      stage: 'U',
      supplementSeq: 4,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', 'apps/cli/tests/a.e2e.ts'],
      expectCases: ['acp host takes over the Run'],
    }] }),
    'bin/pnpm': LISTING_PNPM,
    'reports/vitest-e2e-acp.json': E2E_REPORT,
  }
  for (const gateModule of GATE_MODULES) written[`scripts/first100/${gateModule}`] = readFileSync(new URL(gateModule, import.meta.url), 'utf8')
  for (const [path, text] of Object.entries(written)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true })
    writeFileSync(join(tree, path), text)
  }
  chmodSync(join(tree, 'bin/pnpm'), 0o755)
  const result = spawnSync(process.execPath, [join(tree, 'scripts/first100/verify-frozen-titles-in-tree.mjs'), ...gateArgs], {
    cwd: tree,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(tree, 'bin')}${delimiter}${process.env.PATH ?? ''}` },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('a title frozen from an e2e file is looked up in the --e2e-report the gate is given', () => {
  it('finds the title vitest list cannot collect in the e2e report, and passes', () => {
    const { status, output } = runGateOverE2eFreeze(['--e2e-report', 'reports/vitest-e2e-acp.json'])
    expect(output).toContain('every live frozen title is produced by a real test')
    expect(status).toBe(0)
  })

  it('reports the same title as an orphan without the report, so the pass above is the report\'s doing', () => {
    const { status, output } = runGateOverE2eFreeze([])
    expect(output).toContain('P4-05.U.4: acp host takes over the Run')
    expect(status).toBe(1)
  })

  it('stops on an --e2e-report it cannot read and names it, rather than reading its titles as deleted', () => {
    const { status, output } = runGateOverE2eFreeze(['--e2e-report', 'reports/absent.json'])
    expect(output).toContain('--e2e-report reports/absent.json is not a readable vitest json report')
    expect(status).not.toBe(0)
  })
})

describe('the exact-SHA workflow hands this gate every own-config report its job writes', () => {
  it('passes each e2e and snapshot report as --e2e-report, from a step after every step that writes one', () => {
    const text = readFileSync(new URL('../../.github/workflows/first100-exact-sha.yml', import.meta.url), 'utf8')
    const jobs = (yaml.load(text) as { jobs: Record<string, { steps: { run?: string }[] }> }).jobs
    const runs = (jobs['exact-sha-gate']?.steps ?? []).map(step => step.run ?? '')
    const gate = runs.findIndex(run => run.includes('first100:verify-frozen-titles-in-tree'))
    const writers = runs.flatMap((run, index) =>
      [...run.matchAll(/--outputFile=(\S*vitest-(?:e2e|snapshot|web)[a-z0-9-]*\.json)/gu)].map(match => ({ index, report: match[1] })))
    const passed = [...(runs[gate] ?? '').matchAll(/--e2e-report (\S+)/gu)].map(match => match[1])
    expect(passed).toContain('.artifacts/first100/observations/vitest-snapshot.json')
    expect(passed.sort()).toStrictEqual(writers.map(writer => writer.report).sort())
    expect(writers.every(writer => writer.index < gate)).toBe(true)
  })
})
