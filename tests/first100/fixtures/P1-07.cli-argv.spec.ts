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
 * `runProfile` → `provideCmdline`).
 *
 * The profile that `--profile` names is composed, not booted. Each launch
 * initializes that shipped template (`PROFILE_TEMPLATES`, `initProfile`) in
 * the case's home, resolves its bundle layers from the dsh installation
 * (`loadProfileDirectory` with `INSTALL_ANCHOR`, no user layer) and composes
 * their patches (`composeEntries`); it then requires an enabled
 * `@deepseek-ai/dsh-command-workspace-trust` row and an enabled row naming the
 * startup module the case mounts. Plugin admission, compatibility
 * negotiation, the home patch layer, `--patch` overlays and the telemetry
 * switch are not applied. The composed tree is never mounted: the case mounts
 * that startup module and `command-workspace-trust` on a bare `Context` it
 * creates, with stand-in `commands` and `workspaceTrust` services and its own
 * readiness signal, because profile-boot builds its `createAppReady`
 * privately. The stand-in trust provider records the grants it is asked for;
 * whether the record then does what it should is the subject of U.1–U.3.
 *
 * A grant is pinned whole, against literals this file sets up rather than
 * values computed through the product: each case gets a private `DSH_HOME`
 * holding a fixed host user id in `.host-user-id`, a fixed `DSH_TENANT`, and a
 * `process.cwd()` that reports a private launch directory. The expected grant
 * names that directory, `trusted-read`, the user principal with that id and
 * tenant, and the `launch-argument` source. `PWD` is not stubbed. Every root
 * `Context` a case creates is disposed after the case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, initProfile, loadProfileDirectory, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import * as CommandWorkspaceTrust from '@deepseek-ai/dsh-command-workspace-trust'
import * as HeadlessStartup from '@deepseek-ai/dsh-headless/startup'
import * as SdkAppStartup from '@deepseek-ai/dsh-sdk-app'
import { parseDshArgs } from '../../../apps/cli/src/args.ts'
import { INSTALL_ANCHOR } from '../../../apps/cli/src/profile-boot.ts'

/** The host user id this file writes into each case's home. */
const HOST_USER_ID = '3f2c9a4e-8b1d-4c6f-9e2a-7d5b0c1f4a86'

/** The tenant each case names through `DSH_TENANT`. */
const TENANT = 'p1-07-u4-tenant'

/** The trust plugin's package, as the shipped dsh-base row names it. */
const TRUST_PLUGIN = '@deepseek-ai/dsh-command-workspace-trust'

/** A startup module a shipped bundle mounts, and the specifier its bundle row names. */
interface App {
  readonly plugin: typeof HeadlessStartup | typeof SdkAppStartup
  readonly specifier: string
}

const HEADLESS: App = { plugin: HeadlessStartup, specifier: '@deepseek-ai/dsh-headless/startup' }
const SDK: App = { plugin: SdkAppStartup, specifier: '@deepseek-ai/dsh-sdk-app' }

/** One grant the trust provider was asked to write, whole. */
interface Grant {
  readonly path: string
  readonly target: string
  readonly principal: unknown
  readonly source: unknown
}

/** What one launch observed. */
interface Launch {
  /** The arguments the launcher handed to the tree. */
  readonly args: readonly string[]
  /** Every code the tree asked the launcher to exit with. */
  readonly exits: readonly number[]
  /** Every grant the trust provider was asked to write. */
  readonly grants: readonly Grant[]
  /** The launched tree, for reading what the app provided. */
  readonly ctx: Context
}

/** A composed entry list. */
type Entries = ReturnType<typeof composeEntries>

/** One composed row: the module it names and whether it mounts. */
interface Row {
  readonly name: string
  readonly enabled: boolean
}

/**
 * Every row of a composed entry list, group members included. A row inside a
 * disabled group does not mount, and a `disabled` other than absent, `null` or
 * `false` (an unevaluated `!!js` expression included) counts as disabled.
 * @param entries - the composed entry list.
 * @param groupEnabled - whether every enclosing group mounts.
 * @returns the rows, depth first.
 */
function rowsOf(entries: Entries, groupEnabled = true): Row[] {
  return entries.flatMap((entry) => {
    const row = { name: entry.name, enabled: groupEnabled && !entry.disabled }
    return entry.group && Array.isArray(entry.config) ? [row, ...rowsOf(entry.config as Entries, row.enabled)] : [row]
  })
}

/**
 * Compose the shipped template `profile` names, without booting it: initialize
 * the template in this case's home, resolve its bundle layers from the dsh
 * installation, and compose their patches over the empty root.
 * @param profile - the profile the launcher parsed from the command line.
 * @returns every composed row.
 * @throws when no shipped template carries that name.
 */
function composeShippedProfile(profile: string): Row[] {
  const template = PROFILE_TEMPLATES[profile]
  if (template === undefined) throw new Error(`no shipped profile template is named ${JSON.stringify(profile)}`)
  const dir = join(home, 'profiles', profile)
  initProfile(dir, template.bundles, template.patchReload)
  const loaded = loadProfileDirectory('dsh', dir, INSTALL_ANCHOR, { userLayer: false })
  return rowsOf(composeEntries(loaded.layers.map(layer => layer.patches)))
}

/**
 * The one grant `--trust-workspace=read` must produce: this case's launch
 * directory, at `trusted-read`, for the host user this case's home names in
 * this case's tenant, from the launch argument.
 * @returns the expected grant.
 */
function expectedReadGrant(): Grant {
  return {
    path: launchDir,
    target: 'trusted-read',
    principal: { kind: 'user', id: HOST_USER_ID, tenantId: TENANT },
    source: 'launch-argument',
  }
}

const saved = { ...internals }

/** Every root `Context` the current case launched. */
const roots: Context[] = []

let home: string
let launchDir: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'p1-07-u4-home-'))
  launchDir = mkdtempSync(join(tmpdir(), 'p1-07-u4-launch-'))
  // The file `@deepseek-ai/dsh-host-user-id` reads under `DSH_HOME`: one bare UUID line.
  writeFileSync(join(home, '.host-user-id'), `${HOST_USER_ID}\n`)
  vi.stubEnv('DSH_HOME', home)
  vi.stubEnv('DSH_TENANT', TENANT)
  vi.spyOn(process, 'cwd').mockReturnValue(launchDir)
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

afterEach(async () => {
  try {
    await Promise.all(roots.splice(0).map(root => root.fiber.dispose()))
  } finally {
    Object.assign(internals, saved)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
    rmSync(launchDir, { recursive: true, force: true })
  }
})

/**
 * Launch `argv` the way `dsh` does, as far as the app's own program and the
 * trust plugin, and let startup complete. The profile the launcher parsed is
 * composed first and must carry, enabled, both plugins this launch mounts.
 * @param argv - the launcher's command line.
 * @param app - the startup module the named profile's bundle mounts.
 * @returns what the launch observed.
 */
async function launch(argv: readonly string[], app: App): Promise<Launch> {
  const invocation = parseDshArgs(argv, '0.0.0-test')
  if (invocation.mode !== 'profile') throw new Error(`expected a profile launch, got ${invocation.mode}`)
  const rows = composeShippedProfile(invocation.profile)
  expect(rows).toContainEqual({ name: TRUST_PLUGIN, enabled: true })
  expect(rows).toContainEqual({ name: app.specifier, enabled: true })
  const ctx = new Context()
  roots.push(ctx)
  const exits: number[] = []
  const grants: Grant[] = []
  const ready: (() => void)[] = []
  provideCmdline(ctx, {
    args: invocation.args,
    exit: (code) => { exits.push(code) },
    ready: { onReady: (listener) => { ready.push(listener); return () => {} } },
  })
  ctx.provide('commands', { register: () => () => {} } as never)
  ctx.provide('workspaceTrust', {
    grantTrust: (path: string, target: string, principal: unknown, source: unknown) => {
      grants.push({ path, target, principal, source })
      return Promise.resolve({ upgraded: true })
    },
  } as never)
  await ctx.plugin(app.plugin)
  await ctx.plugin(CommandWorkspaceTrust)
  // The grant is written when the provider is injected, one turn later.
  await new Promise(resolve => setTimeout(resolve, 0))
  for (const listener of ready) listener()
  return { args: invocation.args, exits, grants, ctx }
}

describe('P1-07 U.4 — `--trust-workspace=read` passes both parsers on the way to the trust plugin', () => {
  it('the launcher hands it to the headless app intact, and that app\'s own program accepts it on the second pass', async () => {
    const launched = await launch(['--profile', 'headless', '--trust-workspace=read', 'summarize this repository'], HEADLESS)
    expect(launched.args).toEqual(['--trust-workspace=read', 'summarize this repository'])
    expect(launched.exits).toEqual([])
    const startup = launched.ctx.get(HeadlessStartup.HEADLESS_STARTUP_SERVICE) as HeadlessStartup.HeadlessStartupValues | undefined
    expect(startup?.task).toBe('summarize this repository')
  })

  it('the trust plugin on that headless command line asks for a trusted-read grant from the launch argument', async () => {
    const launched = await launch(['--profile', 'headless', '--trust-workspace=read', 'summarize this repository'], HEADLESS)
    expect(launched.grants).toEqual([expectedReadGrant()])
  })

  it('the launcher hands it to the sdk app intact, and that app\'s own program accepts it on the second pass', async () => {
    const launched = await launch(['--profile', 'sdk', '--trust-workspace=read'], SDK)
    expect(launched.args).toEqual(['--trust-workspace=read'])
    expect(launched.exits).toEqual([])
    expect(launched.ctx.get(SdkAppStartup.SDK_APP_STARTUP_SERVICE) as unknown).toEqual({ accepted: true })
  })

  it('the trust plugin on that sdk command line asks for a trusted-read grant from the launch argument', async () => {
    const launched = await launch(['--profile', 'sdk', '--trust-workspace=read'], SDK)
    expect(launched.grants).toEqual([expectedReadGrant()])
  })
})
