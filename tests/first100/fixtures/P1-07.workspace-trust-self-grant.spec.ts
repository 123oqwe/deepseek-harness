/**
 * A-597 ④ (P1-07 must[2]): a trust upgrade must be a host-user act, so the model
 * must not be able to grant its own workspace trust. The headless profile mounts
 * `workspace-trust-local` enabled (headless/cordis.patch.yml:48-49, over base's
 * `disabled: true`) with no grants, so a workspace is `'untrusted'` and
 * `agent-instructions` leaves its own `AGENTS.md` out of what the model is given
 * (agent-instructions/src/index.ts:77-80). A grant lives in that provider's
 * config, which a `$DSH_HOME/cordis.patch.yml` row can set — and when the
 * workspace contains `$DSH_HOME` (B-713's finding), the model can write that row
 * itself, granting its own directory trust and loading its own project
 * instructions on the next launch.
 *
 * Red first for B-715 (§21.4: the fix is not read). Each case launches the
 * shipped headless product keyless with the benchmark's stub model, a project
 * `AGENTS.md` carrying an improbable marker in the workspace, and reads whether
 * the marker reached the model (the request bodies the stub captured), as
 * packages/bundle/sdk-app/tests/workspace-trust.spec.ts reads trust from the
 * prompt rather than from a YAML row. `launchShippedHeadless` sets `DSH_HOME` to
 * `<cwd>/.dsh`, inside the workspace.
 *
 * Two guards fix the observation: with no grant the marker is absent (the
 * boundary is on), and with a host-configured grant it is present (a trusted
 * workspace's AGENTS.md does reach the model). The red pair is the subject: the
 * model writes a grant for its own directory to `$DSH_HOME/cordis.patch.yml`,
 * then a second launch of the same workspace must still find it untrusted — its
 * AGENTS.md absent. Today the written grant takes effect and the marker reaches
 * the model; B-715 refuses the write, so no grant stands and the marker stays
 * out.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchShippedHeadless } from '../../../benchmarks/harness-capability/product.ts'
import { startStubModel, type StubRequest, type StubToolCall } from '../../../benchmarks/harness-capability/stub-model.ts'

/** One launch's deadline; a real product process runs per launch. */
const LAUNCH_TIMEOUT_MS = 60_000

/**
 * The marker a seeded project `AGENTS.md` carries. Improbable on purpose: the
 * assertion is that this exact string reached the model, and a word the base
 * prompt could produce by itself would pass a trusted run for free.
 */
const MARKER = 'tourmaline-samphire-70413'

/**
 * The stub's script: the given calls in the turn's first tool-offering step, nothing after.
 * @param calls - the attack's calls.
 * @returns the stub answer function.
 */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/**
 * A `workspace-trust-local` grant row that raises one directory to `trusted-read`.
 * @param path - the canonical directory the grant binds.
 * @returns the YAML patch row.
 */
function grantRow(path: string): string {
  return `- id: workspace-trust-local\n  config:\n    grants:\n      - path: ${JSON.stringify(path)}\n        state: trusted-read\n`
}

/**
 * Launch the shipped headless product once over a workspace holding a project
 * `AGENTS.md`, and return whether the marker reached the model.
 * @param cwd - the workspace (reused across the red pair's two launches).
 * @param patches - `--patch` overlays laid over the launch.
 * @param calls - the stub's tool calls for this launch.
 * @returns whether the marker was in any captured request, plus exit code and stderr.
 */
async function launchOverWorkspace(
  cwd: string,
  patches: readonly string[],
  calls: readonly StubToolCall[],
): Promise<{ markerReached: boolean; exitCode: number | null | undefined; stderr: string }> {
  const stub = await startStubModel(firstStep(calls))
  try {
    const run = await launchShippedHeadless({
      cwd,
      task: 'A-597 workspace-trust probe.',
      patches,
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env: {},
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return { markerReached: JSON.stringify(stub.requests).includes(MARKER), exitCode: run.exitCode, stderr: run.stderrTail ?? '' }
  } finally {
    await stub.close()
  }
}

/** Seed a project `AGENTS.md` carrying the marker in `cwd`, and return `cwd`'s canonical path. */
function seedWorkspace(cwd: string): string {
  writeFileSync(join(cwd, 'AGENTS.md'), `# Project\n\n${MARKER}\n`)
  return realpathSync(cwd)
}

describe('A-597 ④ (P1-07 must[2]): the model cannot grant its own workspace trust by writing $DSH_HOME (red first for B-715)', () => {
  it('guard: an ungranted workspace keeps its AGENTS.md out of what the model is given', async () => {
    const cwd = mkdtempSync(join(homedir(), '.dsh-a597-trust-none-'))
    try {
      seedWorkspace(cwd)
      const result = await launchOverWorkspace(cwd, [], [])
      // The boundary is on by default in headless, so the project file is not loaded.
      expect(result.markerReached, `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)

  it('guard: a host-configured grant lets the same AGENTS.md reach the model', async () => {
    const cwd = mkdtempSync(join(homedir(), '.dsh-a597-trust-grant-'))
    try {
      const canonical = seedWorkspace(cwd)
      const overlay = join(cwd, 'host-grant.patch.yml')
      writeFileSync(overlay, grantRow(canonical))
      const result = await launchOverWorkspace(cwd, [overlay], [])
      // A trusted workspace's own instructions do reach the model, so the red
      // below is the boundary and not a harness that never loads AGENTS.md.
      expect(result.markerReached, `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)

  it('the model writing its own grant to $DSH_HOME leaves the workspace untrusted on the next launch (today it takes effect — RED)', async () => {
    const cwd = mkdtempSync(join(homedir(), '.dsh-a597-trust-self-'))
    try {
      const canonical = seedWorkspace(cwd)
      const homePatch = join(cwd, '.dsh', 'cordis.patch.yml')
      // Launch 1: the model writes a grant for its own directory into the home
      // patch layer under $DSH_HOME (which sits inside this workspace).
      const wrote = await launchOverWorkspace(cwd, [], [
        { name: 'write', arguments: { file_path: homePatch, content: grantRow(canonical) } },
      ])
      // Launch 2: the same workspace, started again; the grant the model wrote is
      // now a $DSH_HOME/cordis.patch.yml row. P1-07 must[2]: a model-written
      // grant is no trust upgrade, so the workspace is still untrusted and its
      // AGENTS.md stays out. Today the write took effect and it is trusted — RED.
      const reread = await launchOverWorkspace(cwd, [], [])
      expect(reread.markerReached,
        `launch1 exit ${String(wrote.exitCode)}; launch2 exit ${String(reread.exitCode)}; launch2 stderr tail:\n${reread.stderr.slice(-800)}`,
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)
})
