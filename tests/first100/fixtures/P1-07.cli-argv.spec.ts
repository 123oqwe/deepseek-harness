/**
 * Epic P1-07 U supplement #4: `--trust-workspace=read` reaches the trust
 * plugin through the launcher's own parser, and the booted app's own program
 * does not refuse it on its second pass over the same arguments. Two parsers
 * decide whether a flag is usable, not one (delegate ONBOARDING §11.5.8), and
 * each can fail while the other passes.
 *
 * Each case starts at the launcher's real entry, `parseDshArgs`, and hands the
 * resulting `invocation.args` to the tree through the real `provideCmdline` —
 * the function `apps/cli/src/profile-boot.ts` calls with them (`bin.ts` →
 * `runProfile` → `provideCmdline`). The plugins are the ones the shipped
 * bundles mount: `headless-startup`, `sdk-app-startup` and
 * `command-workspace-trust`. The readiness signal is this file's own, because
 * profile-boot builds its `createAppReady` privately; the trust provider
 * records the grants it is asked for, because whether the record then does
 * what it should is the subject of U.1–U.3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import * as CommandWorkspaceTrust from '@deepseek-ai/dsh-command-workspace-trust'
import * as HeadlessStartup from '@deepseek-ai/dsh-headless/startup'
import * as SdkAppStartup from '@deepseek-ai/dsh-sdk-app'
import { parseDshArgs } from '../../../apps/cli/src/args.ts'

/** What one launch observed. */
interface Launch {
  /** The arguments the launcher handed to the tree. */
  readonly args: readonly string[]
  /** Every code the tree asked the launcher to exit with. */
  readonly exits: readonly number[]
  /** Every grant the trust provider was asked to write. */
  readonly grants: readonly { readonly target: string; readonly source: unknown }[]
  /** The launched tree, for reading what the app provided. */
  readonly ctx: Context
}

const saved = { ...internals }

beforeEach(() => {
  // A refusal must surface as a red case, not end the worker: the launcher
  // exits the process on a parse error (`apps/cli/src/args.ts`), as
  // `apps/cli/tests/args.spec.ts` handles it.
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`the launcher exited with ${String(code)}`)
  })
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  internals.stdout = { write: () => true }
  internals.stderr = { write: () => true }
  internals.stdin = { readableEnded: false, once: () => undefined, off: () => undefined }
})

afterEach(() => {
  Object.assign(internals, saved)
  vi.restoreAllMocks()
})

/**
 * Launch `argv` the way `dsh` does, as far as the app's own program and the
 * trust plugin, and let startup complete.
 * @param argv - the launcher's command line.
 * @param app - the startup plugin the named profile's bundle mounts.
 * @returns what the launch observed.
 */
async function launch(argv: readonly string[], app: typeof HeadlessStartup | typeof SdkAppStartup): Promise<Launch> {
  const invocation = parseDshArgs(argv, '0.0.0-test')
  if (invocation.mode !== 'profile') throw new Error(`expected a profile launch, got ${invocation.mode}`)
  const ctx = new Context()
  const exits: number[] = []
  const grants: { target: string; source: unknown }[] = []
  const ready: (() => void)[] = []
  provideCmdline(ctx, {
    args: invocation.args,
    exit: (code) => { exits.push(code) },
    ready: { onReady: (listener) => { ready.push(listener); return () => {} } },
  })
  ctx.provide('commands', { register: () => () => {} } as never)
  ctx.provide('workspaceTrust', {
    grantTrust: (_path: string, target: string, _principal: unknown, source: unknown) => {
      grants.push({ target, source })
      return Promise.resolve({ upgraded: true })
    },
  } as never)
  await ctx.plugin(app)
  await ctx.plugin(CommandWorkspaceTrust)
  // The grant is written when the provider is injected, one turn later.
  await new Promise(resolve => setTimeout(resolve, 0))
  for (const listener of ready) listener()
  return { args: invocation.args, exits, grants, ctx }
}

describe('P1-07 U.4 — `--trust-workspace=read` passes both parsers on the way to the trust plugin', () => {
  it('the launcher hands it to the headless app intact, and that app\'s own program accepts it on the second pass', async () => {
    const launched = await launch(['--profile', 'headless', '--trust-workspace=read', 'summarize this repository'], HeadlessStartup)
    expect(launched.args).toEqual(['--trust-workspace=read', 'summarize this repository'])
    expect(launched.exits).toEqual([])
    const startup = launched.ctx.get(HeadlessStartup.HEADLESS_STARTUP_SERVICE) as HeadlessStartup.HeadlessStartupValues | undefined
    expect(startup?.task).toBe('summarize this repository')
  })

  it('the trust plugin on that headless command line asks for a trusted-read grant from the launch argument', async () => {
    const launched = await launch(['--profile', 'headless', '--trust-workspace=read', 'summarize this repository'], HeadlessStartup)
    expect(launched.grants).toEqual([{ target: 'trusted-read', source: 'launch-argument' }])
  })

  it('the launcher hands it to the sdk app intact, and that app\'s own program accepts it on the second pass', async () => {
    const launched = await launch(['--profile', 'sdk-app', '--trust-workspace=read'], SdkAppStartup)
    expect(launched.args).toEqual(['--trust-workspace=read'])
    expect(launched.exits).toEqual([])
    expect(launched.ctx.get(SdkAppStartup.SDK_APP_STARTUP_SERVICE) as unknown).toEqual({ accepted: true })
  })

  it('the trust plugin on that sdk command line asks for a trusted-read grant from the launch argument', async () => {
    const launched = await launch(['--profile', 'sdk-app', '--trust-workspace=read'], SdkAppStartup)
    expect(launched.grants).toEqual([{ target: 'trusted-read', source: 'launch-argument' }])
  })
})
