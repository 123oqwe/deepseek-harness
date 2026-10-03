/**
 * A-597 ④ (P1-07 must[2]): a trust upgrade must be a host-user act, so the model
 * must not be able to grant its own workspace trust. The headless profile mounts
 * `workspace-trust-local` enabled (headless/cordis.patch.yml:48-49, over base's
 * `disabled: true`) with no grants, so a workspace is `'untrusted'` and
 * `agent-instructions` leaves its own `AGENTS.md` out of what the model is given
 * (agent-instructions/src/index.ts:77-80). A grant lives in that provider's
 * config, which a `$DSH_HOME/cordis.patch.yml` row can set, and a stored trust
 * record lives under `$DSH_HOME/storages`; when the workspace contains `$DSH_HOME`
 * (B-713's finding) the model can write both. Whether that lets it grant its own
 * directory trust splits three ways, each a case here.
 *
 * Green evidence (protected): a grant the model writes for its OWN,
 * already-resolved workspace never binds. The turn that writes it has already
 * resolved the cwd, so `stateFor` wrote an `'untrusted'` RECORD for it, and a
 * later launch returns that record (workspace-trust-local/src/index.ts:293-297)
 * BEFORE it consults the grant (:306) — a config grant only binds a path with no
 * record yet.
 *
 * Red first for B-715 (§21.4: the fix is not read), two paths that evade that
 * shadowing:
 *   - v1: grant a directory the model has NOT resolved. With no record for it,
 *     `stateFor` reaches :306-309 and binds it per the grant on its first resolve.
 *     The model writes a grant for a second directory D into `$DSH_HOME`, then a
 *     launch with cwd = D finds D trusted and loads D's `AGENTS.md`.
 *   - v2: edit the stored RECORD. `reconcileWorkspaceTrust`
 *     (workspace-trust/src/index.ts:217-232) returns a stored record unchanged
 *     when the freshly observed identity matches it, so flipping a record's
 *     `state` to `trusted-read` (identity bytes untouched) is carried forward on
 *     the next launch.
 *
 * Each case launches the shipped headless product keyless with the benchmark's
 * stub model and a project `AGENTS.md` carrying an improbable marker, and reads
 * whether the marker reached the model (the request bodies the stub captured), as
 * packages/bundle/sdk-app/tests/workspace-trust.spec.ts reads trust from the
 * prompt rather than from a YAML row. Two guards fix the observation: an ungranted
 * workspace keeps its `AGENTS.md` out (the boundary is on), and a host-configured
 * grant lets the same `AGENTS.md` through (a trusted workspace's instructions do
 * reach the model). Both v1 and v2 are RED today — the marker reaches the model;
 * B-715 refuses the model's `$DSH_HOME` write, so neither grant stands and the
 * marker stays out.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
 * @param cwd - the workspace started for this launch.
 * @param patches - `--patch` overlays laid over the launch.
 * @param calls - the stub's tool calls for this launch.
 * @param env - extra environment; `DSH_HOME` here moves the home directory off the default `<cwd>/.dsh`.
 * @returns whether the marker was in any captured request, plus exit code and stderr.
 */
async function launchOverWorkspace(
  cwd: string,
  patches: readonly string[],
  calls: readonly StubToolCall[],
  env: Record<string, string> = {},
): Promise<{ markerReached: boolean; exitCode: number | null | undefined; stderr: string }> {
  const stub = await startStubModel(firstStep(calls))
  try {
    const run = await launchShippedHeadless({
      cwd,
      task: 'A-597 workspace-trust probe.',
      patches,
      modelBaseUrl: stub.baseUrl,
      permission: 'workspace-write',
      env,
      timeoutMs: LAUNCH_TIMEOUT_MS,
    })
    return { markerReached: JSON.stringify(stub.requests).includes(MARKER), exitCode: run.exitCode, stderr: run.stderrTail ?? '' }
  } finally {
    await stub.close()
  }
}

/** Seed a project `AGENTS.md` carrying the marker in `dir`, and return `dir`'s canonical path. */
function seedWorkspace(dir: string): string {
  writeFileSync(join(dir, 'AGENTS.md'), `# Project\n\n${MARKER}\n`)
  return realpathSync(dir)
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
      // A trusted workspace's own instructions do reach the model, so the reds
      // below are the boundary and not a harness that never loads AGENTS.md.
      expect(result.markerReached, `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)

  it('green evidence: a self-grant for the already-resolved workspace is shadowed by its untrusted record', async () => {
    const cwd = mkdtempSync(join(homedir(), '.dsh-a597-trust-self-'))
    try {
      const canonical = seedWorkspace(cwd)
      const homePatch = join(cwd, '.dsh', 'cordis.patch.yml')
      // Launch 1: the model writes a grant for its own directory into the home
      // patch layer under $DSH_HOME (which sits inside this workspace). Resolving
      // this cwd at turn start already wrote it an 'untrusted' record.
      const wrote = await launchOverWorkspace(cwd, [], [
        { name: 'write', arguments: { file_path: homePatch, content: grantRow(canonical) } },
      ])
      // The model's write landed, so "untrusted below" is the trust layer
      // shadowing the grant, not a write that never happened. The launcher
      // creates only the profile patch (initProfile), not this home patch, so an
      // unseen-absent target is createIfAbsent → a real create.
      const homePatchAfter = existsSync(homePatch) ? readFileSync(homePatch, 'utf8') : '(absent)'
      expect(homePatchAfter, `home patch after launch 1 (${homePatch}):\n${homePatchAfter}`).toContain('workspace-trust-local')
      // Launch 2, same workspace: stateFor finds the 'untrusted' record launch 1
      // wrote (index.ts:293-297) and returns it before the grant is consulted
      // (:306), so the workspace stays untrusted and its AGENTS.md stays out. This
      // is the protected path, green today and after B-715.
      const reread = await launchOverWorkspace(cwd, [], [])
      expect(reread.markerReached,
        `grant written to home patch; launch1 exit ${String(wrote.exitCode)}; launch2 exit ${String(reread.exitCode)}; launch2 stderr tail:\n${reread.stderr.slice(-800)}`,
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)

  it('v1: a self-grant for a NOT-yet-resolved directory trusts it on its first resolve (today it takes effect — RED)', async () => {
    // W is where the model writes the grant; D is the "next repo" the grant
    // names, which no launch has resolved. $DSH_HOME sits inside W so the model's
    // write lands under workspace-write; launch 2 points DSH_HOME back at it.
    const workspace = mkdtempSync(join(homedir(), '.dsh-a597-v1-write-'))
    const nextRepo = mkdtempSync(join(homedir(), '.dsh-a597-v1-next-'))
    try {
      const canonicalNext = seedWorkspace(nextRepo)
      const dshHome = join(workspace, '.dsh')
      const homePatch = join(dshHome, 'cordis.patch.yml')
      // Launch 1, cwd = W: the model writes a grant for D (never resolved) into
      // W's $DSH_HOME home patch. W carries no marker, so launch 1's requests are
      // not what the assertion reads.
      const wrote = await launchOverWorkspace(workspace, [], [
        { name: 'write', arguments: { file_path: homePatch, content: grantRow(canonicalNext) } },
      ])
      const homePatchAfter = existsSync(homePatch) ? readFileSync(homePatch, 'utf8') : '(absent)'
      expect(homePatchAfter, `home patch after launch 1 (${homePatch}):\n${homePatchAfter}`).toContain(canonicalNext)
      // Launch 2, cwd = D, same $DSH_HOME: D has no record, so stateFor binds it
      // per the grant (index.ts:306-309) on its first resolve and loads D's
      // AGENTS.md. P1-07 must[2]: a model-written grant is no trust upgrade.
      // Today the grant takes effect and the marker reaches the model — RED.
      const reread = await launchOverWorkspace(nextRepo, [], [], { DSH_HOME: dshHome })
      expect(reread.markerReached,
        `grant for D in W's home patch; launch1 exit ${String(wrote.exitCode)}; launch2 exit ${String(reread.exitCode)}; launch2 stderr tail:\n${reread.stderr.slice(-800)}`,
      ).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
      rmSync(nextRepo, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)

  it('v2: editing the stored trust record to trusted-read is carried forward on the next launch (today it takes effect — RED)', async () => {
    const cwd = mkdtempSync(join(homedir(), '.dsh-a597-v2-record-'))
    try {
      seedWorkspace(cwd)
      // The single-layout record file for the workspace_trust domain
      // (storage-domain default layout; unit name = domain name) under this
      // workspace's $DSH_HOME.
      const recordFile = join(cwd, '.dsh', 'storages', 'workspace_trust.json')
      // Launch 1, cwd = W: resolving the cwd at turn start writes an 'untrusted'
      // record to recordFile; the model then reads it and flips its one 'untrusted'
      // state value to 'trusted-read', leaving identity bytes untouched. Targeting
      // the quoted value, not the key, is robust to the pretty-printer's spacing,
      // and the enum value appears once (one record, empty consumed_grants).
      const edited = await launchOverWorkspace(cwd, [], [
        { name: 'read', arguments: { file_path: recordFile } },
        { name: 'edit', arguments: { file_path: recordFile, old_string: '"untrusted"', new_string: '"trusted-read"' } },
      ])
      // The edit landed and was not clobbered by an in-memory re-put: the stored
      // record now reads trusted-read with its identity intact. A red here instead
      // would mean the model's write never reached the decisive bytes, not that
      // the boundary held.
      const recordText = existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : '(absent)'
      expect(recordText, `trust record after launch 1 (${recordFile}):\n${recordText}`).toContain('"trusted-read"')
      // Launch 2, same workspace: stateFor finds the now-trusted record and
      // reconcileWorkspaceTrust returns it unchanged (identity matches a fresh
      // observation), so the workspace is trusted and its AGENTS.md reaches the
      // model. Today the edit takes effect — RED.
      const reread = await launchOverWorkspace(cwd, [], [])
      expect(reread.markerReached,
        `record edited to trusted-read; launch1 exit ${String(edited.exitCode)}; launch2 exit ${String(reread.exitCode)}; launch2 stderr tail:\n${reread.stderr.slice(-800)}`,
      ).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, LAUNCH_TIMEOUT_MS)
})
