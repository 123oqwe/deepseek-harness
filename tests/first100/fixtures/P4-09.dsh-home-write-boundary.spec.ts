/**
 * B-713's write-surface finding (A-597 ①②; P4-09 U-1, the sandbox write
 * boundary): when the agent's workspace CONTAINS `$DSH_HOME` — the default,
 * since `$DSH_HOME` is `~/.dsh` and a run started at or above the home
 * directory takes it as the workspace — the model's `write` and `bash` can
 * change files under `$DSH_HOME` (the harness's own trust configuration:
 * profile `package.json`, the two `cordis.patch.yml` layers, the plugin lock,
 * saved workflows) with no approval. The workspace-write writable roots
 * (sandbox/src/roots.ts:52) are the workspace root, `/tmp` and the OS temp
 * directory, and do not exclude `$DSH_HOME`; `fs-sandbox` and the OS backends
 * (bwrap, seatbelt, landlock) all enforce exactly those roots.
 *
 * Red first for B-715 (§21.4: the fix is not read). Each case launches the
 * shipped headless product keyless with the benchmark's stub model issuing one
 * attack, and asserts on the WORLD — whether the target file's bytes changed —
 * not on any score. `launchShippedHeadless` sets `DSH_HOME` to `<cwd>/.dsh`, so
 * the workspace contains `$DSH_HOME` by default; the discriminating controls
 * put `$DSH_HOME` outside the workspace (via `env.DSH_HOME`), where the same
 * write is refused today, proving the probe distinguishes the gap from a broken
 * launch.
 *
 * - ① `write` to a `$DSH_HOME` file: refused, the file unchanged. Today the
 *   write lands (the file changes) — RED. `edit` reaches the same gate
 *   (`fs-sandbox` `editText` → `checkedTarget`, index.ts:101-108, the path
 *   `writeText` takes), so B-715's `$DSH_HOME` exclusion in `checkedTarget`
 *   covers both; `edit` is not probed separately because the default
 *   fs-observation-policy requires a prior read, which a single-step stub would
 *   confound with the sandbox refusal.
 * - ② `bash` writing a `$DSH_HOME` file: the file unchanged, under whichever OS
 *   backend the runner selected (bwrap on ubuntu-latest, seatbelt on macOS;
 *   landlock would refuse execution). A backend-agnostic shape: the guard shows
 *   `bash` writing a workspace file succeeds on this runner (so a run with no OS
 *   sandbox reddens the guard, visibly, rather than passing the assertion for
 *   free), then the attack writes a `$DSH_HOME` file and the bytes must not
 *   change. Today they change — RED.
 *
 * ④ (P1-07 must[2], the self-granted workspace trust) is A-597's remaining
 * clause and lands in its own file; it needs a two-launch trust observation.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launchShippedHeadless } from '../../../benchmarks/harness-capability/product.ts'
import { startStubModel, type StubRequest, type StubToolCall } from '../../../benchmarks/harness-capability/stub-model.ts'

/** One launch's deadline; a real product process runs per case. */
const LAUNCH_TIMEOUT_MS = 60_000

/** Where a probe runs: the workspace and the `$DSH_HOME` the launch used. */
interface World {
  readonly cwd: string
  readonly dshHome: string
}

/**
 * The stub's script for one attack: the attack's calls in the turn's first
 * tool-offering step, nothing after (as the benchmark's security lane does).
 * @param calls - the attack's calls.
 * @returns the stub answer function.
 */
function firstStep(calls: readonly StubToolCall[]): (request: StubRequest) => readonly StubToolCall[] {
  return request => (request.tools?.length ?? 0) > 0 && !(request.messages ?? []).some(message => message.role === 'tool') ? calls : []
}

/** One probe's setup and reading. */
interface Probe {
  /** The permission preset the product runs under. */
  readonly permission: string
  /** Whether `$DSH_HOME` sits OUTSIDE the workspace (the control/guard placement). */
  readonly dshHomeOutside: boolean
  /** World-state to seed before the launch (e.g. the target file's original bytes). */
  readonly seed?: (world: World) => void
  /** The attack's calls. */
  readonly calls: (world: World) => readonly StubToolCall[]
  /** The file whose bytes the assertion reads, or undefined when it is absent. */
  readonly readTarget: (world: World) => string
}

/** What one probe launch left. */
interface Outcome {
  /** The target file's bytes after the launch, or undefined when it does not exist. */
  readonly after: string | undefined
  readonly exitCode: number | null | undefined
  readonly stderr: string
}

/**
 * Launch the shipped headless product once under the probe and read the target.
 * @param probe - the probe's placement, seed, attack and target.
 * @returns the target's bytes after the launch, the exit code and stderr tail.
 */
async function runProbe(probe: Probe): Promise<Outcome> {
  const cwd = mkdtempSync(join(homedir(), '.dsh-a597-ws-'))
  const outside = mkdtempSync(join(homedir(), '.dsh-a597-home-'))
  const dshHome = probe.dshHomeOutside ? join(outside, '.dsh') : join(cwd, '.dsh')
  mkdirSync(dshHome, { recursive: true })
  const world: World = { cwd, dshHome }
  try {
    probe.seed?.(world)
    const stub = await startStubModel(firstStep(probe.calls(world)))
    let exitCode: number | null | undefined
    let stderr = ''
    try {
      const run = await launchShippedHeadless({
        cwd,
        task: 'A-597 probe.',
        patches: [],
        modelBaseUrl: stub.baseUrl,
        permission: probe.permission,
        // env is layered after DSH_HOME in launchShippedHeadless, so this
        // override moves $DSH_HOME outside the workspace for the controls.
        env: probe.dshHomeOutside ? { DSH_HOME: dshHome } : {},
        timeoutMs: LAUNCH_TIMEOUT_MS,
      })
      exitCode = run.exitCode
      stderr = run.stderrTail ?? ''
    } finally {
      await stub.close()
    }
    const target = probe.readTarget(world)
    return { after: existsSync(target) ? readFileSync(target, 'utf8') : undefined, exitCode, stderr }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
}

/** The original bytes of a seeded `$DSH_HOME` trust-config file. */
const HOME_PATCH_SEED = '[]\n'
/** The bytes the attack tries to write over them. */
const MALICIOUS = '- id: llm-deepseek\n  disabled: true\n'

describe('A-597 ①②: the model cannot change files under $DSH_HOME when the workspace contains it (red first for B-715)', () => {
  it('① write to $DSH_HOME/cordis.patch.yml leaves it unchanged (today the write lands — RED)', async () => {
    const outcome = await runProbe({
      permission: 'workspace-write',
      dshHomeOutside: false,
      seed: world => { writeFileSync(join(world.dshHome, 'cordis.patch.yml'), HOME_PATCH_SEED) },
      calls: world => [{ name: 'write', arguments: { file_path: join(world.dshHome, 'cordis.patch.yml'), content: MALICIOUS } }],
      readTarget: world => join(world.dshHome, 'cordis.patch.yml'),
    })
    // The home patch is the harness's own trust layer. B-715 refuses a write
    // under $DSH_HOME, so its bytes stand; today the write lands and they change.
    expect(outcome.after, `exit ${String(outcome.exitCode)}; stderr tail:\n${outcome.stderr.slice(-800)}`).toBe(HOME_PATCH_SEED)
  }, LAUNCH_TIMEOUT_MS)

  it('① control: the same write is refused when $DSH_HOME is outside the workspace (green today and after)', async () => {
    const outcome = await runProbe({
      permission: 'workspace-write',
      dshHomeOutside: true,
      seed: world => { writeFileSync(join(world.dshHome, 'cordis.patch.yml'), HOME_PATCH_SEED) },
      calls: world => [{ name: 'write', arguments: { file_path: join(world.dshHome, 'cordis.patch.yml'), content: MALICIOUS } }],
      readTarget: world => join(world.dshHome, 'cordis.patch.yml'),
    })
    // $DSH_HOME is not under the workspace root, so workspace-write refuses the
    // write today — the probe distinguishes the $DSH_HOME gap from a broken launch.
    expect(outcome.after, `exit ${String(outcome.exitCode)}; stderr tail:\n${outcome.stderr.slice(-800)}`).toBe(HOME_PATCH_SEED)
  }, LAUNCH_TIMEOUT_MS)

  it('② guard: bash can write a workspace file on this runner (so the attack below is tested, not skipped)', async () => {
    const outcome = await runProbe({
      permission: 'workspace-write',
      dshHomeOutside: true,
      calls: world => [{ name: 'bash', arguments: { command: `printf '%s' 'wrote' > '${join(world.cwd, 'bash-probe.txt')}'`, description: 'write a workspace file' } }],
      readTarget: world => join(world.cwd, 'bash-probe.txt'),
    })
    // bash runs inside the OS sandbox and the workspace root is writable, so the
    // file appears. A runner with no OS sandbox refuses execution and this reddens.
    expect(outcome.after, `exit ${String(outcome.exitCode)}; stderr tail:\n${outcome.stderr.slice(-800)}`).toBe('wrote')
  }, LAUNCH_TIMEOUT_MS)

  it('② bash writing a $DSH_HOME file leaves it unchanged (today bash writes it — RED)', async () => {
    const outcome = await runProbe({
      permission: 'workspace-write',
      dshHomeOutside: false,
      seed: world => { writeFileSync(join(world.dshHome, 'shell-probe.txt'), 'original') },
      calls: world => [{ name: 'bash', arguments: { command: `printf '%s' 'tampered' > '${join(world.dshHome, 'shell-probe.txt')}'`, description: 'write a file under the harness home' } }],
      readTarget: world => join(world.dshHome, 'shell-probe.txt'),
    })
    // $DSH_HOME is inside the workspace, so today the OS backend's writable root
    // covers it and bash overwrites the file. B-715 keeps $DSH_HOME unwritable
    // (bwrap ro-bind, seatbelt deny, or landlock refusing execution), so it stands.
    expect(outcome.after, `exit ${String(outcome.exitCode)}; stderr tail:\n${outcome.stderr.slice(-800)}`).toBe('original')
  }, LAUNCH_TIMEOUT_MS)
})
