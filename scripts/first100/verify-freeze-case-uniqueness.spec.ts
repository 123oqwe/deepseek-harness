/**
 * Controls for the whole-suite uniqueness of live frozen case strings (BLOCKED-104).
 *
 * Fixtures 1, 3 and 4 make the gate non-vacuous: 1 shows it can go red, 3
 * that rename resolution is live, 4 that a retired rename resolves nothing.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'

import {
  argvTargets,
  classifyAgainstObservingReports,
  classifyFrozenCaseMatches,
  configFrozenOwnReports,
  reportRefusal,
  uncoveredArgvTargets,
} from './verify-freeze-case-uniqueness.mjs'

const BARE = 'enumerates at least twelve boundaries, each named once'
const FULL = `P2-04 Fault — risk classification boundary matrix ${BARE}`
const P0_05_OLD = 'has exactly one statement: a type-only `export type * from \'./types.ts\'`'
const P0_05_NEW = 'keeps `export type * from \'./types.ts\'` as its first statement'
const P4_08_OLD = 'leaves an unverified or side-effecting step untouched'
const P4_08_NEW = 'leaves an UNVERIFIED step untouched, whether or not it completed'

const entry = (fields: Record<string, unknown>) => ({ epic: 'P2-04', stage: 'C', argv: ['pnpm', 'exec', 'vitest', 'run'], ...fields })

describe('classifyFrozenCaseMatches', () => {
  it('(1) reports a bare title that names eight passing cases as resolving to 8', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [BARE] })], new Map([[BARE, 8]]), new Map())
    expect(rows).toStrictEqual([{ label: 'P2-04.C', title: BARE, raw: 8, resolved: 8, via: null }])
  })

  it('(2) reports the same case frozen by fullName as resolving to 1', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [FULL] })], new Map([[BARE, 8], [FULL, 1]]), new Map())
    expect(rows.map(row => row.resolved)).toStrictEqual([1])
  })

  it('(3) resolves a title with no passing match through the rename registered for its cell', () => {
    const renames = new Map([[`P0-05|C|${P0_05_OLD}`, P0_05_NEW]])
    const rows = classifyFrozenCaseMatches([entry({ epic: 'P0-05', expectCases: [P0_05_OLD] })], new Map([[P0_05_NEW, 1]]), renames)
    expect(rows).toStrictEqual([{ label: 'P0-05.C', title: P0_05_OLD, raw: 0, resolved: 1, via: `rename:${P0_05_NEW}` }])
  })

  it('(4) resolves nothing through a retired rename, which the renames map does not carry', () => {
    const rows = classifyFrozenCaseMatches([entry({ epic: 'P4-08', expectCases: [P4_08_OLD] })], new Map([[P4_08_NEW, 1]]), new Map())
    expect(rows).toStrictEqual([{ label: 'P4-08.C', title: P4_08_OLD, raw: 0, resolved: 0, via: null }])
  })

  it('(5) reports a string matching no case as resolving to 0, not as ambiguous', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: ['no such case'] })], new Map(), new Map())
    expect(rows.map(row => row.resolved)).toStrictEqual([0])
  })

  it('(6) produces no row for a superseded entry', () => {
    const rows = classifyFrozenCaseMatches([entry({ expectCases: [BARE], supersededBy: '2026-09-15T08:16:00Z' })], new Map([[BARE, 8]]), new Map())
    expect(rows).toStrictEqual([])
  })

  it('(7) addresses a supplement entry by its sequence', () => {
    const rows = classifyFrozenCaseMatches([entry({ supplementSeq: 1, expectCases: [FULL] })], new Map([[FULL, 1]]), new Map())
    expect(rows.map(row => row.label)).toStrictEqual(['P2-04.C.1'])
  })
})

describe('whole-suite refusal', () => {
  it('drops flags and the -t pattern from a frozen argv', () => {
    expect(argvTargets(['pnpm', 'exec', 'vitest', 'run', 'packages/a', '-t', 'some name', '--reporter=json', 'packages/b/x.spec.ts']))
      .toStrictEqual(['packages/a', 'packages/b/x.spec.ts'])
  })

  it('(8) names a live argv target that no report file lies at or under', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/policy/risk-taxonomy', 'packages/mcp/mcp-client/tests/annotations.spec.ts'] })]
    const files = ['/home/runner/work/deepseek-harness/deepseek-harness/packages/policy/risk-taxonomy/tests/classify.spec.ts']
    expect(uncoveredArgvTargets(entries, files)).toStrictEqual([{ label: 'P2-04.C', target: 'packages/mcp/mcp-client/tests/annotations.spec.ts' }])
  })

  it('(9) refuses a report carrying a failure the flake registry does not hold, and accepts a registered one', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/a'] })]
    const files = ['/r/packages/a/tests/x.spec.ts']
    const registry = { entries: [{ testFullName: 'a registered flake' }] }
    expect(reportRefusal(new Set(['an unexplained failure']), files, entries, registry)).toContain('1 failed case(s) not in the flake registry')
    expect(reportRefusal(new Set(['a registered flake']), files, entries, registry)).toBeNull()
  })

  it('accepts a clean report, which the flake check itself reports as valid: false', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/a'] })]
    expect(reportRefusal(new Set(), ['/r/packages/a/tests/x.spec.ts'], entries, { entries: [] })).toBeNull()
  })

  it('does not match a target against a file that only shares its name as a prefix', () => {
    const entries = [entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/run/task'] })]
    expect(uncoveredArgvTargets(entries, ['/r/packages/run/task-profile/tests/a.spec.ts'])).toHaveLength(1)
  })
})

const ACP = 'apps/cli/tests/profiles/acp/tests/acp.e2e.ts'
const ACP_CASE = 'P4-05 acceptance[2]: a restarted acp host takes over the Run the lease row now names the second host'
const e2eFrozen = entry({
  epic: 'P4-05',
  stage: 'U',
  supplementSeq: 4,
  argv: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', ACP],
  expectCases: [ACP_CASE],
})
const keylessReport = { path: 'obs/vitest-e2e-sdk-keyless-smoke.json', files: ['/ci/apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts'] }
const acpReport = { path: 'obs/vitest-e2e-acp.json', files: [`/ci/${ACP}`] }

describe('an entry frozen under its own config is answered by its own report (P4-05.U.4)', () => {
  it('drops the config file after --config and -c from the argv targets', () => {
    expect(argvTargets(['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', ACP])).toStrictEqual([ACP])
    expect(argvTargets(['pnpm', 'exec', 'vitest', 'run', 'packages/a/x.e2e.ts', '-c', 'vitest.e2e.config.ts']))
      .toStrictEqual(['packages/a/x.e2e.ts'])
  })

  it('does not require the whole-suite report to cover it, and still requires it for an entry naming no config', () => {
    const plain = entry({ argv: ['pnpm', 'exec', 'vitest', 'run', 'packages/mcp/mcp-client/tests/annotations.spec.ts'] })
    expect(uncoveredArgvTargets([e2eFrozen, plain], ['/r/packages/policy/risk-taxonomy/tests/classify.spec.ts']))
      .toStrictEqual([{ label: 'P2-04.C', target: 'packages/mcp/mcp-client/tests/annotations.spec.ts' }])
  })

  it('takes the first --e2e-report that ran every path its argv names', () => {
    expect(configFrozenOwnReports([e2eFrozen, entry({})], [keylessReport, acpReport]))
      .toStrictEqual({ owned: [{ entry: e2eFrozen, path: 'obs/vitest-e2e-acp.json' }], refusals: [] })
  })

  it('refuses an entry no --e2e-report ran, and one naming a config and no test path', () => {
    const pathless = entry({
      epic: 'P2-04',
      stage: 'U',
      supplementSeq: 3,
      argv: ['pnpm', 'exec', 'vitest', 'run', '-c', 'vitest.snapshot.config.ts'],
    })
    expect(configFrozenOwnReports([e2eFrozen, pathless], [keylessReport]).refusals).toStrictEqual([
      `P4-05.U.4 is frozen under --config vitest.e2e.config.ts, and no --e2e-report of that config ran ${ACP}`,
      'P2-04.U.3 names --config vitest.snapshot.config.ts and no test path, so no report can be told to be its own',
    ])
  })

  it('skips a superseded entry frozen under its own config', () => {
    expect(configFrozenOwnReports([{ ...e2eFrozen, supersededBy: '2026-09-24T06:33:40Z' }], [])).toStrictEqual({ owned: [], refusals: [] })
  })

  it('counts its strings in its own report only, and every other entry in the whole-suite report', () => {
    const plain = entry({ expectCases: [FULL] })
    const counts = new Map([['obs/vitest-e2e-acp.json', new Map([[ACP_CASE, 1]])]])
    const rows = classifyAgainstObservingReports(
      [e2eFrozen, plain],
      new Map([[ACP_CASE, 2], [FULL, 1]]),
      [{ entry: e2eFrozen, path: 'obs/vitest-e2e-acp.json' }],
      counts,
      new Map(),
    )
    expect(rows.map(row => [row.label, row.resolved, row.report])).toStrictEqual([
      ['P2-04.C', 1, null],
      ['P4-05.U.4', 1, 'obs/vitest-e2e-acp.json'],
    ])
  })

  it('reports a string repeated inside its own report as resolving to more than one', () => {
    const counts = new Map([['obs/vitest-e2e-acp.json', new Map([[ACP_CASE, 2]])]])
    const owned = [{ entry: e2eFrozen, path: 'obs/vitest-e2e-acp.json' }]
    const rows = classifyAgainstObservingReports([e2eFrozen], new Map(), owned, counts, new Map())
    expect(rows.map(row => row.resolved)).toStrictEqual([2])
  })
})

describe('the exact-SHA workflow hands this gate every own-config report its job writes', () => {
  it('passes each one as --e2e-report, from a step after every step that writes one', () => {
    const text = readFileSync(new URL('../../.github/workflows/first100-exact-sha.yml', import.meta.url), 'utf8')
    const job = (load(text) as { jobs: Record<string, { steps: { run?: string }[] }> }).jobs['exact-sha-gate']
    const runs = (job?.steps ?? []).map(step => step.run ?? '')
    const gate = runs.findIndex(run => run.includes('verify-freeze-case-uniqueness.mjs'))
    const written = runs.flatMap((run, index) =>
      [...run.matchAll(/--outputFile=\S*\/(vitest-(?:e2e|snapshot|web)[a-z0-9-]*\.json)/gu)].map(match => ({ index, name: match[1] })))
    const passed = [...(runs[gate] ?? '').matchAll(/--e2e-report "\$d\/([^"]+)"/gu)].map(match => match[1])
    expect(written.length).toBeGreaterThan(0)
    expect(passed.sort()).toStrictEqual(written.map(report => report.name).sort())
    expect(written.every(report => report.index < gate)).toBe(true)
  })
})

/** A candidate SHA; the reports the gate is given sit in a directory named after it unless a case says otherwise. */
const CANDIDATE = 'abcdef0123456789abcdef0123456789abcdef01'
const WHOLE_SUITE = `${CANDIDATE}/vitest-report.json`
const OWN_REPORT = `${CANDIDATE}/vitest-e2e-acp.json`
const trees: string[] = []
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true })
})

/**
 * P4-05.U.4's own report: its one case passing, then `failed`.
 * @param failed - failing assertions to add.
 * @returns the report's JSON text.
 */
function acpReportText(failed: readonly { title: string; fullName: string }[] = []): string {
  const passing = { title: ACP_CASE, fullName: ACP_CASE, status: 'passed' }
  const assertionResults = [passing, ...failed.map(assertion => ({ ...assertion, status: 'failed' }))]
  return JSON.stringify({ testResults: [{ name: `/ci/${ACP}`, assertionResults }] })
}

/**
 * Runs the gate in a scratch tree holding a copy of this directory's modules, a freeze of P4-05.U.4 alone, an empty
 * flake registry, an empty whole-suite report at `WHOLE_SUITE`, and `reports`.
 * @param reports - report text by tree-relative path.
 * @param gateArgs - the arguments after `--report WHOLE_SUITE`.
 * @returns the gate's exit status and its stdout and stderr together.
 */
function runGateInScratchTree(
  reports: Record<string, string>,
  gateArgs: readonly string[],
): { status: number | null; output: string } {
  // The real path, because the gate runs `main` only when argv[1] resolves to its own module path.
  const tree = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-uniqueness-cli-')))
  trees.push(tree)
  const written: Record<string, string> = {
    'spec/first100/exec/command-freeze.json': JSON.stringify({ entries: [e2eFrozen] }),
    'spec/first100/exec/flake-registry.json': JSON.stringify({ entries: [] }),
    [WHOLE_SUITE]: JSON.stringify({ success: true, testResults: [] }),
    ...reports,
  }
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(file => file.endsWith('.mjs'))) {
    written[`scripts/first100/${name}`] = readFileSync(new URL(name, import.meta.url), 'utf8')
  }
  for (const [path, text] of Object.entries(written)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true })
    writeFileSync(join(tree, path), text)
  }
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(tree, 'node_modules'))
  const gate = join(tree, 'scripts/first100/verify-freeze-case-uniqueness.mjs')
  const result = spawnSync(process.execPath, [gate, '--report', WHOLE_SUITE, ...gateArgs], { cwd: tree, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('the gate refuses an --e2e-report it cannot trust, and exits 2', () => {
  it('names an --e2e-report that does not exist', () => {
    const { status, output } = runGateInScratchTree({}, ['--e2e-report', OWN_REPORT])
    expect(output).toContain(`cannot decide — --e2e-report ${OWN_REPORT} does not exist`)
    expect(status).toBe(2)
  })

  it('names an --e2e-report outside the directory named after --candidate-sha', () => {
    const elsewhere = 'elsewhere/vitest-e2e-acp.json'
    const gateArgs = ['--candidate-sha', CANDIDATE, '--e2e-report', elsewhere]
    const { status, output } = runGateInScratchTree({ [elsewhere]: acpReportText() }, gateArgs)
    expect(output).toContain(`cannot decide — --e2e-report ${elsewhere} is not tied to --candidate-sha ${CANDIDATE}`)
    expect(status).toBe(2)
  })

  it('names an unregistered failure in the --e2e-report that observes an entry', () => {
    const failed = [{ title: 'drops the lease', fullName: 'acp host drops the lease' }]
    const { status, output } = runGateInScratchTree({ [OWN_REPORT]: acpReportText(failed) }, ['--e2e-report', OWN_REPORT])
    expect(output).toContain(`cannot decide — --e2e-report ${OWN_REPORT}: 1 failed case(s) not in the flake registry:\n`
      + '  acp host drops the lease')
    expect(status).toBe(2)
  })
})
