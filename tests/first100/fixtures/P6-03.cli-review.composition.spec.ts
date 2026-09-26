/**
 * P6-03's second slice on the shipped CLI: the host user reviews the proposals
 * the policy holds for review (must[2] 「高敏感默认人工。」) with
 * `dsh memory --profile <name> [--patch <file>] pending | approve <id> | reject <id>`.
 *
 * Each run has its own `DSH_HOME` and working directory.
 * `./loader/p6-03-proposal/cli-review-driver.ts seed` proposes two sensitive
 * proposals, which wait for review, and one normal proposal, which is
 * accepted, in that directory's workspace. The case then runs `apps/cli/src/bin.ts`
 * with the shipped headless profile and the overlay
 * `./loader/p6-03-proposal/base.patch.yml`, which enables the `memory` row
 * over a durable directory in the working directory: `pending`, `approve` the
 * first, `reject` the second, `pending` again, and `approve` an id no proposal
 * holds. `cli-review-driver.ts check` finally reads which proposals the
 * default search returns. `pending` prints one line per held proposal,
 * starting with its id. Today the CLI has no `memory` command.
 * @module tests/first100/fixtures/P6-03.cli-review.composition
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')
// Resolved here, not by the child: the child runs in a temporary directory with no node_modules.
const tsxLoader = import.meta.resolve('tsx/esm')
const repoTsconfig = join(repoRoot, 'tsconfig.json')
const driver = fileURLToPath(new URL('./loader/p6-03-proposal/cli-review-driver.ts', import.meta.url))
const overlay = fileURLToPath(new URL('./loader/p6-03-proposal/base.patch.yml', import.meta.url))

/** Deadline for one process. */
const PROCESS_TIMEOUT_MS = 120_000
/** An id no proposal holds. */
const UNKNOWN_ID = 'p6-03-no-such-proposal'

/** What one process left. */
interface Ran {
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr: string
}

/** What the case saw, in the order it ran the commands. */
interface Observed {
  readonly ids: Readonly<Record<string, string>>
  readonly pendingBefore: Ran
  readonly approve: Ran
  readonly reject: Ran
  readonly pendingAfter: Ran
  readonly unknown: Ran
  readonly active: Readonly<Record<string, boolean>>
}

let home: string | undefined
let workspace: string | undefined
let observed: Observed | undefined

/**
 * Run one TypeScript entry under tsx in the case's working directory and home.
 * @param args - the entry and its arguments.
 * @returns its exit code and output.
 */
async function run(args: readonly string[]): Promise<Ran> {
  if (home === undefined || workspace === undefined) throw new Error('no home or working directory')
  const result = await execa(process.execPath, ['--import', tsxLoader, ...args], {
    cwd: workspace,
    // DSH_TENANT is dropped so the host user and the seeded proposals share the default tenant.
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TENANT: undefined, TSX_TSCONFIG_PATH: repoTsconfig },
    timeout: PROCESS_TIMEOUT_MS,
    reject: false,
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run `dsh memory` on the shipped headless profile with the case's overlay.
 * @param args - the arguments after `memory --profile headless --patch <overlay>`.
 * @returns what the command left.
 */
async function memory(...args: readonly string[]): Promise<Ran> {
  return run([binScript, 'memory', '--profile', 'headless', '--patch', overlay, ...args])
}

/**
 * The JSON a driver line carries.
 * @param ran - the driver's run.
 * @param label - the line's leading label.
 * @returns the parsed payload.
 */
function payload(ran: Ran, label: string): unknown {
  const json = new RegExp(`${label} (?<json>.+)`, 'u').exec(ran.stdout)?.groups?.json
  if (json === undefined) throw new Error(`the driver printed no ${label} line; exit ${String(ran.exitCode)}; stderr tail:\n${ran.stderr.slice(-800)}`)
  return JSON.parse(json)
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'p6-03-cli-home-'))
  workspace = await mkdtemp(join(tmpdir(), 'p6-03-cli-workspace-'))
  const { ids } = payload(await run([driver, overlay, 'seed']), 'P6-03-CLI-SEED') as { ids: Record<string, string> }
  const pendingBefore = await memory('pending')
  const approve = await memory('approve', ids['to-approve'] ?? '')
  const reject = await memory('reject', ids['to-reject'] ?? '')
  const pendingAfter = await memory('pending')
  const unknown = await memory('approve', UNKNOWN_ID)
  const { active } = payload(await run([driver, overlay, 'check']), 'P6-03-CLI-CHECK') as { active: Record<string, boolean> }
  observed = { ids, pendingBefore, approve, reject, pendingAfter, unknown, active }
}, 9 * PROCESS_TIMEOUT_MS)

afterAll(async () => {
  for (const directory of [home, workspace]) if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

/**
 * What the case saw, or the reason there is nothing.
 * @returns the observation.
 */
function reading(): Observed {
  if (observed === undefined) throw new Error('the case observed nothing')
  return observed
}

/**
 * The ids a `pending` listing names, one per line at its start.
 * @param ran - the listing's run.
 * @param ids - the seeded proposals' ids.
 * @returns the seeded proposals' names whose id starts a line.
 */
function listed(ran: Ran, ids: Readonly<Record<string, string>>): string[] {
  const lines = ran.stdout.split('\n')
  return Object.entries(ids).filter(([, id]) => lines.some(line => line.startsWith(id))).map(([name]) => name)
}

describe('P6-03 second slice on the shipped CLI: the host user reviews the proposals held for review with dsh memory', () => {
  it('pending lists each proposal held for review with its id at the start of a line, and not the accepted one', () => {
    const { ids, pendingBefore } = reading()
    expect(pendingBefore.exitCode, pendingBefore.stderr.slice(-800)).toBe(0)
    expect(listed(pendingBefore, ids).sort()).toEqual(['to-approve', 'to-reject'])
  })

  it('approve admits a held proposal: the command exits 0, pending no longer lists it, and the default search returns it', () => {
    const { ids, approve, pendingAfter, active } = reading()
    expect(approve.exitCode, approve.stderr.slice(-800)).toBe(0)
    expect(pendingAfter.exitCode, pendingAfter.stderr.slice(-800)).toBe(0)
    expect(listed(pendingAfter, ids)).not.toContain('to-approve')
    expect(active['to-approve']).toBe(true)
  })

  it('reject refuses a held proposal: the command exits 0, pending no longer lists it, and the default search does not return it', () => {
    const { ids, reject, pendingAfter, active } = reading()
    expect(reject.exitCode, reject.stderr.slice(-800)).toBe(0)
    expect(pendingAfter.exitCode, pendingAfter.stderr.slice(-800)).toBe(0)
    expect(listed(pendingAfter, ids)).not.toContain('to-reject')
    expect(active['to-reject']).toBe(false)
  })

  it('approve of an id no proposal holds exits non-zero and names the id', () => {
    const { unknown } = reading()
    expect(unknown.exitCode).not.toBe(0)
    expect(`${unknown.stdout}\n${unknown.stderr}`).toContain(UNKNOWN_ID)
  })
})
