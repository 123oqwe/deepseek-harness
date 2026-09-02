/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, apply its selected patch-reload
 * lifecycle, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  partitionProfileLayersByAdmission,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type DeniedProfileLayer,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { createTrustKernel, pinTrustKernel, type TrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { resolveFeatureGate } from '@deepseek-ai/dsh-feature-gates'
import type { FeatureGateDeclaration, FeatureGateResolution, FeatureGateState } from '@deepseek-ai/dsh-feature-gates'
import { buildPluginPermissionStates } from '@deepseek-ai/dsh-host-plugin-inventory'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/** Launcher-owned readiness signal committed only after boot and host setup succeed. */
function createAppReady(): { service: AppReady; commit(): void } {
  let ready = false
  const listeners = new Set<() => void>()
  return {
    service: {
      onReady(listener) {
        if (ready) {
          listener()
          return () => {}
        }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    commit() {
      if (ready) return
      ready = true
      for (const listener of [...listeners]) listener()
      listeners.clear()
    },
  }
}

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name` and (re)write the empty root config. The
 * root is always rewritten: the whole composition is patch layers, and the
 * vendored Loader's tree write-back (a plugin self-disposing persists the
 * current tree) can bake composed rows into this file — which would duplicate
 * every bundle insert on the next boot. The file exists on disk only because
 * the Loader needs a real include root to anchor `baseUrl` at the profile
 * directory (the config dump anchors on the same file, so both compose over
 * the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers, in application order. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /**
   * Bundle layer package names actually composed into `bundlePatches` (Epic
   * P1-01.U must[3]/acceptance[0]) — a production boot's pre-mount admission
   * already excluded any denied layer's patches, so every name here is
   * admitted, in `profile.layers` order.
   */
  admittedLayerNames: readonly string[]
  /** Every bundle layer a production boot refused to compose, and why; empty outside production. */
  deniedLayers: readonly DeniedProfileLayer[]
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (a base-backed profile gets the base bundle's
 * platform-gated shell rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * then the telemetry switch.
 *
 * Epic P1-01.U's real pre-mount plugin admission (must[3]/acceptance[0])
 * happens here, before any patch reaches `boot()`: {@link partitionProfileLayersByAdmission}
 * judges every bundle layer's own `package.json` `dsh` field, and only an
 * admitted layer's patches are composed — a denied layer's plugin code never
 * mounts at all. `production: false` (the default outside an explicit
 * `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` opt-in) admits every layer
 * unconditionally, so an existing profile boots exactly as it did before
 * this policy existed.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param production - whether this boot enforces production plugin admission.
 * @returns the profile, its patch layers, and the admission outcome.
 */
export async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  production: boolean,
): Promise<ComposedProfile> {
  const profile = prepareProfile(name)
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile })
  const { admitted, denied } = partitionProfileLayersByAdmission(profile, production)
  for (const { layer, reason, wildcardFindings } of denied) {
    const detail = wildcardFindings.length > 0 ? `: ${wildcardFindings.map(finding => finding.path).join(', ')}` : ''
    process.stderr.write(
      `${NAME}: plugin admission: excluding bundle ${JSON.stringify(layer.packageName)} from profile `
      + `${JSON.stringify(name)} (${reason}${detail})\n`,
    )
  }
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = admitted.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  return {
    profile,
    bundlePatches,
    homePatches,
    overlays: composedOverlays,
    admittedLayerNames: admitted.map(layer => layer.packageName),
    deniedLayers: denied,
  }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
}

/** Env var whose non-empty value opts a development boot into skipping Trust Kernel initialization. */
const TRUST_KERNEL_INSECURE_ENV = 'DSH_TRUST_KERNEL_INSECURE'

/**
 * Resolve the Trust Kernel insecure-boot opt-in (Epic P0-02 acceptance
 * clause 3). ANY non-empty value opts in, mirroring
 * {@link resolveTelemetryPatch}'s bias -- here the deliberate value is
 * presence, not absence, because skipping a security control must be an
 * explicit developer choice, never an accidental empty-string default.
 * @param raw - the raw DSH_TRUST_KERNEL_INSECURE value.
 * @returns whether this boot may proceed without a pinned Trust Kernel.
 */
export function resolveTrustKernelInsecureOptIn(raw: string | undefined): boolean {
  return (raw ?? '') !== ''
}

/**
 * Enforce Epic P0-02's fail-closed/insecure-opt-in split (must[1],
 * acceptance clause 3) once host preparation has had its chance to pin
 * `trustKernel`. A production boot (no opt-in) with no pinned kernel
 * refuses to continue; an opted-in development boot prints a permanent
 * warning -- every boot while the opt-in is set, not once -- and proceeds.
 * @param initialized - whether `ctx.get('trustKernel')` returned a value after preparation.
 * @param insecureOptIn - the resolved {@link resolveTrustKernelInsecureOptIn} value.
 * @param warn - sink for the permanent insecure-mode warning; defaults to a stderr write.
 * @throws when uninitialized without the insecure opt-in.
 */
export function enforceTrustKernelPosture(
  initialized: boolean,
  insecureOptIn: boolean,
  warn: (message: string) => void = (message) => { process.stderr.write(message) },
): void {
  if (initialized) return
  if (!insecureOptIn) {
    throw new Error(`${NAME}: Trust Kernel not initialized -- refusing to boot (set ${TRUST_KERNEL_INSECURE_ENV} to explicitly opt into an insecure development boot)`)
  }
  warn(`${NAME}: WARNING: booting with no Trust Kernel (${TRUST_KERNEL_INSECURE_ENV} set) -- root identity, signature roots, policy enforcement, audit append, secret broker, and sandbox attestation are all unavailable; never use in production.\n`)
}

/**
 * Declared feature gates for this installation (Epic P0-05 must[2]/must[3]).
 * Empty: no major capability in this repository has migrated behind a gate
 * yet -- {@link resolveProfileFeatureGates} and its `--dump-config` and
 * boot-time wiring below are the real, tested mechanism a future epic
 * appends its {@link FeatureGateDeclaration} to; declaring an illustrative
 * production gate here would be vertical business logic unrelated to this
 * epic (Epic P0-05 nonGoals). See `@deepseek-ai/dsh-feature-gates`'s own
 * Known Limitations for the same deferral.
 */
export const FEATURE_GATE_DECLARATIONS: readonly FeatureGateDeclaration[] = []

const FEATURE_GATE_STATES: readonly FeatureGateState[] = ['off', 'shadow', 'enforce']

/**
 * The environment variable name one gate's highest-precedence override reads
 * from: `DSH_FEATURE_GATE_<GATE_ID>`, upper-cased with every run of
 * non-alphanumeric characters collapsed to a single underscore.
 * @param gateId - the declared gate's id.
 * @returns the deterministic env var name for that gate's override.
 */
export function featureGateEnvVarName(gateId: string): string {
  return `DSH_FEATURE_GATE_${gateId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

/**
 * Parse one gate's env override (Epic P0-05 must[3]'s highest-precedence
 * `'env'` chain layer). Unset or empty contributes no override, matching
 * {@link resolveTelemetryPatch}/{@link resolveTrustKernelInsecureOptIn}'s own
 * empty-string convention; any other value must be exactly one of the three
 * declared states -- misconfiguration fails loud rather than silently
 * resolving to an unintended state.
 * @param raw - the raw environment variable value.
 * @returns the override state, or `undefined` when none was supplied.
 * @throws {TypeError} when `raw` is non-empty and not a valid {@link FeatureGateState}.
 */
export function resolveFeatureGateEnvOverride(raw: string | undefined): FeatureGateState | undefined {
  if (raw === undefined || raw === '') return undefined
  if ((FEATURE_GATE_STATES as readonly string[]).includes(raw)) return raw as FeatureGateState
  throw new TypeError(`${NAME}: feature gate env override must be one of ${FEATURE_GATE_STATES.join('|')}, got ${JSON.stringify(raw)}`)
}

/**
 * Resolve every declared feature gate for one profile (Epic P0-05 must[3]):
 * the same computation `--dump-config` renders and boot provides on
 * `ctx.get('featureGates')`, so both surfaces agree for an identical
 * profile/environment. No `settings` chain layer is supplied: this
 * repository registers no `feature-gates` settings namespace yet (a later
 * Composition-stage slice's deliverable, once a real gate exists), so that
 * layer's absence is correct today, not a gap in this function.
 * @param profile - the active `dsh --profile` name.
 * @param declarations - the declared gates to resolve; defaults to {@link FEATURE_GATE_DECLARATIONS}.
 * @param env - the environment to read each gate's override from; defaults to `process.env`.
 * @returns each declaration's {@link FeatureGateResolution}, in `declarations` order.
 */
export function resolveProfileFeatureGates(
  profile: string,
  declarations: readonly FeatureGateDeclaration[] = FEATURE_GATE_DECLARATIONS,
  env: NodeJS.ProcessEnv = process.env,
): readonly FeatureGateResolution[] {
  return declarations.map((declaration) => {
    const envOverride = resolveFeatureGateEnvOverride(env[featureGateEnvVarName(declaration.id)])
    return resolveFeatureGate(declaration, profile, envOverride === undefined ? {} : { env: envOverride })
  })
}

/** Env var whose value switches Epic P1-01.U's real plugin-admission/quarantine enforcement on. */
const PLUGIN_ENFORCEMENT_ENV = 'DSH_PLUGIN_MANIFEST_ENFORCEMENT'

/**
 * Resolve must[3]/acceptance[0]'s production plugin-admission enforcement
 * switch, mirroring {@link resolveFeatureGateEnvOverride}'s fail-loud
 * validation (unlike {@link resolveTrustKernelInsecureOptIn}'s any-non-empty-value
 * convention: a two-state on/off switch has exactly one non-default spelling,
 * so anything else is a typo worth failing on, not a second meaning). Unset
 * or empty means off — every existing profile boots exactly as it did before
 * this policy existed. This default is a real, disclosed migration gap, not
 * a formality: no bundle package shipped in this installation declares a
 * Manifest v2 yet, so turning this on for a real shipped profile
 * (`dsh-base` and every profile built on it) currently denies every one of
 * its bundles — enforcement is real and tested against fixtures, but a
 * production profile does not yet opt in by default because there is
 * nothing shipped today that would pass it.
 * @param raw - the raw `DSH_PLUGIN_MANIFEST_ENFORCEMENT` value.
 * @returns whether this boot enforces production plugin admission/quarantine.
 * @throws {TypeError} when `raw` is non-empty and not exactly `'enforce'`.
 */
export function resolvePluginEnforcementMode(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  if (raw === 'enforce') return true
  throw new TypeError(`${NAME}: ${PLUGIN_ENFORCEMENT_ENV} must be "enforce" or unset, got ${JSON.stringify(raw)}`)
}

/**
 * Post-mount plugin quarantine (Epic P1-01.U's must[3]/acceptance[0] second
 * half): after `boot()` settles, build every live Loader entry's real
 * declared-vs-observed permission state (`@deepseek-ai/dsh-plugin-inventory`'s
 * `buildPluginPermissionStates`, which walks the actual Cordis `Context`) and
 * dispose the fiber of any entry `decidePluginTrust` marked `'quarantined'` —
 * a plugin that registered a capability its manifest never declared loses
 * every registration it made, for real, not just a returned decision value.
 * A no-op outside production (`production: false`): every profile keeps
 * running exactly as before. Pre-mount admission ({@link partitionProfileLayersByAdmission},
 * called from {@link composeProfile}) already excluded a denied bundle
 * layer's patches before this ever runs, so this only ever sees a
 * `'manifest-v2'`-declared entry (or one with no resolvable package, which
 * `buildPluginPermissionStates` already skips).
 * @param ctx - the settled, active root context.
 * @param production - whether this boot enforces production plugin admission.
 * @param admittedLayerNames - the composed profile's admitted bundle layer names, for provenance.
 */
export async function applyPostMountPluginEnforcement(
  ctx: Context,
  production: boolean,
  admittedLayerNames: readonly string[],
): Promise<void> {
  if (!production) return
  const states = buildPluginPermissionStates(ctx, { bundlePackageNames: admittedLayerNames })
  for (const state of states) {
    if (state.trustDecision !== 'quarantined') continue
    process.stderr.write(
      `${NAME}: plugin quarantine: disposing ${JSON.stringify(state.packageIdentity.name)} `
      + `(declared/observed mismatch: ${JSON.stringify(state.comparison?.mismatches)})\n`,
    )
    for (const entry of ctx.loader.entries()) {
      if (entry.id === state.entryId) await entry.fiber?.dispose()
    }
  }
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  const pluginEnforcement = resolvePluginEnforcementMode(process.env[PLUGIN_ENFORCEMENT_ENV])
  const composed = await composeProfile(options.profile, options.patchFiles, pluginEnforcement)
  const trustKernelInsecure = resolveTrustKernelInsecureOptIn(process.env[TRUST_KERNEL_INSECURE_ENV])
  // Constructed before boot() creates the Cordis Context at all (must[1]):
  // createTrustKernel is pure and synchronous, so it cannot itself fail --
  // the insecure opt-in is the only way this boot proceeds without one.
  const kernel: TrustKernel | undefined = trustKernelInsecure ? undefined : createTrustKernel()
  const app: { current?: Context } = {}
  const appReady = createAppReady()
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // The command line and bounded exit request are launcher facts available
    // to every app plugin that injects the argument snapshot.
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
      ready: appReady.service,
    })
    // Never ctx.plugin(...): a Trust Kernel pinned through the Loader would
    // be a replaceable Cordis Service, exactly what must[2] forbids.
    // pinTrustKernel (not a bare ctx.provide) also freezes the store entry
    // so no plugin can delete-then-reprovide past the duplicate-registration
    // guard (must[3]; @deepseek-ai/dsh-trust-kernel's own doc comment).
    if (kernel !== undefined) pinTrustKernel(hostCtx, kernel)
    enforceTrustKernelPosture(hostCtx.get('trustKernel') !== undefined, trustKernelInsecure)
    // Feature gates (Epic P0-05 must[3]): resolved once per boot, before any
    // config-tree entry mounts, so a future gated plugin reads exactly the
    // resolution `--dump-config` shows for this same profile/environment.
    // Provided under a bare service name -- no capability yet injects
    // `featureGates`, so the typed `declare module '@deepseek-ai/cordis'`
    // augmentation belongs with `@deepseek-ai/dsh-feature-gates` once a real
    // consumer exists, matching that package's own Known Limitations.
    hostCtx.provide('featureGates', resolveProfileFeatureGates(options.profile))
  })
  app.current = ctx
  // Post-mount quarantine (must[3]/acceptance[0]): after every bundle's
  // plugins have mounted and had their chance to register, before HMR/watch
  // setup adds any further Loader entries of its own.
  if (!signalShutdown.signal.aborted && ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
    await applyPostMountPluginEnforcement(ctx, pluginEnforcement, composed.admittedLayerNames)
  }
  // A live-reload profile can dispose the whole tree while post-boot watcher
  // setup is in flight — a signal or appExit. Loader presence and fiber state
  // own liveness; the initial check skips a tree that already exited, and the
  // catch below re-checks for an exit that landed mid-setup. Startup-frozen
  // profiles apply every user layer above but install no HMR fallback or watcher.
  if (composed.profile.patchReload === 'live'
    && !signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: dsh-base disables
      // module reload by default, so when no profile explicitly enabled that
      // service, mount a watch-only instance with no module roots —
      // cordis.patch.yml edits stay live without replacing source modules. A
      // silent skip would break the documented reload contract. HMR injects
      // the timer service, which a bare custom profile may not mount either.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    appReady.commit()
  }
  return { ctx, shutdown }
}
