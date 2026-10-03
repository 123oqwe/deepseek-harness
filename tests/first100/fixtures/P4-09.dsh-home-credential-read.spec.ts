/**
 * B-716's finding (A-598; the sandbox READ boundary): when the agent's
 * workspace contains `$DSH_HOME`, the model can read dsh's own credential
 * storage — `$DSH_HOME/.credentials.yaml`, `$DSH_HOME/.env` — with no approval.
 * `fs-sandbox` gates writes (checkedTarget on writeText/editText) but not reads,
 * and the OS backends mount the whole root read-only (sandbox-local/src/
 * profiles.ts:17 `--ro-bind / /`), so `read`, `grep` and `bash cat` all return
 * the credential bytes.
 *
 * Red first for B-717 (§21.4: the fix is not read). Each case launches the
 * shipped headless product keyless with the benchmark's stub model, which in
 * ONE turn accesses a workspace file (the guard) and the credential file (the
 * subject) with the same tool, and reads the TOOL RESULTS the product sent back
 * to the model (the tool-role messages the stub captured) for the fixtures'
 * sentinels. `launchShippedHeadless` sets `DSH_HOME` to `<cwd>/.dsh`, inside the
 * workspace. The workspace sentinel must appear — proving the tool ran and read
 * on this runner (a run with no OS sandbox reddens the bash guard rather than
 * passing for free) — and the credential sentinel must not. Today it does — RED.
 *
 * `glob` (path disclosure, not content) is A-598's remaining surface; it depends
 * on the glob tool's own hidden-file exclusion list (glob.ts:29-31 already
 * drops some metadata stores), so it is handled separately rather than assumed.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchShippedHeadless } from '../../../benchmarks/harness-capability/product.ts'
import { startStubModel, type StubRequest, type StubToolCall } from '../../../benchmarks/harness-capability/stub-model.ts'

/** One launch's deadline; a real product process runs per case. */
const LAUNCH_TIMEOUT_MS = 60_000

/** The marker a workspace file carries; its presence in a tool result proves the tool read on this runner. */
const WORKSPACE_SENTINEL = 'workspace-read-ok-51804'
/** The secret value the credential files carry; it must never reach the model. */
const CREDENTIAL_SENTINEL = 'credential-leaked-73026'

/** Where a probe runs. */
interface World {
  readonly cwd: string
  readonly dshHome: string
}

/**
 * The stub's script: the given calls in the turn's first tool-offering step, nothing after.
 * @param calls - the calls to issue.
 * @returns the stub answer function.
 */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/**
 * Launch the shipped headless product once over a workspace holding a workspace
 * file and a seeded credential store, and return the text of every tool result
 * the product sent back to the model.
 * @param calls - the tool calls, computed from the staged world.
 * @returns the tool-result text, the exit code and the stderr tail.
 */
async function readProbe(calls: (world: World) => readonly StubToolCall[]): Promise<{ toolResults: string; exitCode: number | null | undefined; stderr: string }> {
  const cwd = mkdtempSync(join(homedir(), '.dsh-a598-'))
  const dshHome = join(cwd, '.dsh')
  mkdirSync(dshHome, { recursive: true })
  const world: World = { cwd, dshHome }
  try {
    writeFileSync(join(cwd, 'notes.txt'), `marker ${WORKSPACE_SENTINEL}\n`)
    writeFileSync(join(dshHome, '.credentials.yaml'), `token: ${CREDENTIAL_SENTINEL}\n`)
    const stub = await startStubModel(firstStep(calls(world)))
    let exitCode: number | null | undefined
    let stderr = ''
    try {
      const run = await launchShippedHeadless({
        cwd,
        task: 'A-598 credential-read probe.',
        patches: [],
        modelBaseUrl: stub.baseUrl,
        permission: 'workspace-write',
        env: {},
        timeoutMs: LAUNCH_TIMEOUT_MS,
      })
      exitCode = run.exitCode
      stderr = run.stderrTail ?? ''
    } finally {
      await stub.close()
    }
    // Only the tool-role messages: a tool's own result, not the assistant call
    // that named the path (so a path argument never counts as a disclosure).
    const toolMessages = stub.requests.flatMap(request => (request.messages ?? []).filter(message => message.role === 'tool'))
    return { toolResults: JSON.stringify(toolMessages), exitCode, stderr }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('A-598: the model cannot read dsh\'s own credential store when the workspace contains $DSH_HOME (red first for B-717)', () => {
  it('read: the credential file\'s contents must not reach the model (today they do — RED)', async () => {
    const result = await readProbe(world => [
      { name: 'read', arguments: { file_path: join(world.cwd, 'notes.txt') } },
      { name: 'read', arguments: { file_path: join(world.dshHome, '.credentials.yaml') } },
    ])
    const detail = `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`
    // Guard: the workspace file was read, so read runs and returns content here.
    expect(result.toolResults.includes(WORKSPACE_SENTINEL), detail).toBe(true)
    // Subject: the credential secret must not be in any tool result. B-717 refuses the read.
    expect(result.toolResults.includes(CREDENTIAL_SENTINEL), detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)

  it('grep: a grep whose path points at the credential file must not return its secret (today it does — RED)', async () => {
    const result = await readProbe(world => [
      { name: 'grep', arguments: { pattern: 'marker', path: join(world.cwd, 'notes.txt') } },
      { name: 'grep', arguments: { pattern: 'token', path: join(world.dshHome, '.credentials.yaml') } },
    ])
    const detail = `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`
    expect(result.toolResults.includes(WORKSPACE_SENTINEL), detail).toBe(true)
    expect(result.toolResults.includes(CREDENTIAL_SENTINEL), detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)

  it('bash: cat of the credential file must not return its secret (today it does — RED)', async () => {
    const result = await readProbe(world => [
      { name: 'bash', arguments: { command: `cat '${join(world.cwd, 'notes.txt')}'`, description: 'read a workspace file' } },
      { name: 'bash', arguments: { command: `cat '${join(world.dshHome, '.credentials.yaml')}'`, description: 'read the credential file' } },
    ])
    const detail = `exit ${String(result.exitCode)}; stderr tail:\n${result.stderr.slice(-800)}`
    // Guard: bash ran and read a workspace file on this runner (a run with no OS
    // sandbox refuses execution and reddens here, rather than passing for free).
    expect(result.toolResults.includes(WORKSPACE_SENTINEL), detail).toBe(true)
    // Subject: the OS backend mounts the root read-only today, so cat returns the
    // secret; B-717 keeps the credential store unreadable.
    expect(result.toolResults.includes(CREDENTIAL_SENTINEL), detail).toBe(false)
  }, LAUNCH_TIMEOUT_MS)
})
