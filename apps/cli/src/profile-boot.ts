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

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  negotiateProfileLayerCompatibility,
  partitionProfileLayersByAdmission,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveProfileDir,
  watchUserPatches,
  type BlockedProfileLayer,
  type DeniedProfileLayer,
  type Profile,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { DSH_RUNTIME_API_VERSION } from '@deepseek-ai/dsh-plugin-compat'
import { brandString } from '@deepseek-ai/dsh-brand'
import { computeManifestDigest, gateProductionBoot, readLockfileIntegrity, UNAVAILABLE_PREFIX } from '@deepseek-ai/dsh-plugin-lock'
import type { GateOutcome, InstalledPlugin, PluginLockFile, PluginPackageName, UnlockedProfilePolicy } from '@deepseek-ai/dsh-plugin-lock'
import { resolveHostCompatContext } from '@deepseek-ai/dsh-plugin-compat/solver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import { createTrustKernel, pinTrustKernel, type TrustKernel } from '@deepseek-ai/dsh-trust-kernel'
import { DEVELOPMENT_PROFILE_KEY, endorseComposedDecision, isDevelopmentProfile } from '@deepseek-ai/dsh-policy-enforcement'
import { evaluateFeatureGate, resolveFeatureGate } from '@deepseek-ai/dsh-feature-gates'
import type {
  FeatureGateDecisionOutcome,
  FeatureGateDeclaration,
  FeatureGateId,
  FeatureGateResolution,
  FeatureGateShadowDecisionRecord,
  FeatureGateState,
} from '@deepseek-ai/dsh-feature-gates'
import { buildPluginPermissionStates, type BundleLayerScope, type PluginPermissionState } from '@deepseek-ai/dsh-host-plugin-inventory'
import { admitUnsignedDevMode, sealTrustAnchors, type ProvenanceAuditRecord } from '@deepseek-ai/dsh-plugin-provenance'
import { appendProvenanceAudit, verifyBootProvenance } from './install-provenance.ts'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'
import { readProfileTrustAnchors } from './trust-anchors.ts'

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
 * Initialize a missing profile from one shipped template. This copies only
 * the template's bundle list and patch-reload policy; local state from the
 * same-named shipped profile is not read, and no inheritance metadata is
 * persisted. Shipped profile names are reserved, and the target directory is
 * claimed exclusively so existing or concurrent state is never reused.
 * @param name - the new profile name.
 * @param fromDefaultProfile - shipped profile template to copy.
 * @param home - Harness home containing the profile directory.
 * @throws when the template is unknown, the target name is shipped, or the target directory exists.
 */
export function initializeProfileFromDefault(
  name: string,
  fromDefaultProfile: string,
  home: string = resolveDshHome(),
): void {
  const dir = resolveProfileDir(name, home)
  const template = Object.hasOwn(PROFILE_TEMPLATES, fromDefaultProfile)
    ? PROFILE_TEMPLATES[fromDefaultProfile]
    : undefined
  if (template === undefined) {
    const expected = Object.keys(PROFILE_TEMPLATES).sort().map(value => JSON.stringify(value)).join(', ')
    throw new Error(
      `${NAME}: unknown default profile ${JSON.stringify(fromDefaultProfile)}; expected one of ${expected}`,
    )
  }
  if (Object.hasOwn(PROFILE_TEMPLATES, name)) {
    throw new Error(
      `${NAME}: profile ${JSON.stringify(name)} is shipped and cannot be a custom profile target; `
      + 'omit --from-default-profile to use it',
    )
  }
  mkdirSync(dirname(dir), { recursive: true })
  try {
    mkdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      throw new Error(
        `${NAME}: profile ${JSON.stringify(name)} already exists at ${manifestPath}; `
        + 'omit --from-default-profile to use it',
      )
    }
    throw new Error(
      `${NAME}: profile directory ${dir} already exists; choose an unused profile name`,
    )
  }
  try {
    initProfile(dir, template.bundles, template.patchReload)
  } catch (error) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${NAME}: profile initialization failed and ${dir} could not be removed`,
      )
    }
    throw error
  }
}

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
 * @param fromDefaultProfile - shipped template used once to initialize a missing profile.
 * @returns the loaded profile.
 * @throws when explicit initialization names an unknown template or an existing profile.
 */
export function prepareProfile(name: string, userLayer = true, fromDefaultProfile?: string): Profile {
  if (fromDefaultProfile !== undefined) initializeProfileFromDefault(name, fromDefaultProfile)
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
   * P1-01.U must[3]/acceptance[0]) — an enforcing boot's pre-mount admission
   * already excluded any denied layer's patches, so every name here is
   * admitted, in `profile.layers` order.
   */
  admittedLayerNames: readonly string[]
  /**
   * The same admitted layers with each one's package directory and the row
   * ids its patches insert, which post-mount enforcement matches to Loader
   * entries and judges each layer by (P1-01 acceptance[0]).
   */
  bundleLayers: readonly BundleLayerScope[]
  /** Every bundle layer an enforcing boot refused to compose, and why; empty unless the gate is `'enforce'`. */
  deniedLayers: readonly DeniedProfileLayer[]
  /**
   * Every bundle layer Epic P1-08's compatibility negotiation blocked, with
   * the activation naming why. Its patches are absent from `bundlePatches`,
   * so its plugin code never mounts (acceptance[1]).
   */
  compatBlockedLayers: readonly BlockedProfileLayer[]
}

/**
 * The id of every entry `patches` insert, entries inside an inserted group included.
 * @param patches - one bundle layer's patch list.
 * @returns the inserted entry ids, in patch order.
 */
function insertedEntryIds(patches: readonly PatchOptions[]): string[] {
  const ids: string[] = []
  const visit = (entry: EntryOptions): void => {
    if (typeof entry.id === 'string') ids.push(entry.id)
    if (entry.group && Array.isArray(entry.config)) entry.config.forEach(visit)
  }
  for (const patch of patches) patch.insert?.forEach(visit)
  return ids
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

/** An admission partition as a gate decision; its summary keeps layer names, denial reasons, and wildcard field paths. */
function admissionOutcome(
  partition: ReturnType<typeof partitionProfileLayersByAdmission>,
): FeatureGateDecisionOutcome<ReturnType<typeof partitionProfileLayersByAdmission>> {
  return {
    value: partition,
    summary: {
      admitted: partition.admitted.map(layer => layer.packageName),
      denied: partition.denied.map(({ layer, reason, wildcardFindings }) => ({
        layer: layer.packageName,
        reason,
        wildcardPaths: wildcardFindings.map(finding => finding.path),
      })),
    },
  }
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
 * mounts at all. The decision goes through {@link PLUGIN_MANIFEST_ENFORCEMENT_GATE}:
 * `'enforce'` composes only the admitted layers, `'off'` composes every
 * layer, and `'shadow'` composes every layer and appends which layers
 * `'enforce'` would have denied to {@link featureGateShadowLogPath}.
 *
 * Epic P1-08's compatibility negotiation (must[1]/acceptance[1]) runs on the
 * admitted layers immediately after, and likewise before any patch reaches
 * `boot()`: {@link negotiateProfileLayerCompatibility} solves every layer's
 * declared `package.json` `dsh.compat` manifest as one graph, and only a
 * layer the solved load plan marks `'active'` contributes patches. Unlike
 * admission this needs no production opt-in, because a bundle that declares
 * no `dsh.compat` is unconstrained and always active — no shipped profile's
 * composition changes. A graph-level contradiction no per-layer blocking can
 * resolve (must[2]) aborts the boot with the minimal unsat core rather than
 * silently picking a side.
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param enforcement - this boot's resolved {@link PLUGIN_MANIFEST_ENFORCEMENT_GATE} state.
 * @param fromDefaultProfile - shipped template used once to initialize a missing profile.
 * @returns the profile, its patch layers, and the admission and compatibility outcomes.
 * @throws Error when compatibility negotiation reports a graph-level contradiction.
 */
export async function composeProfile(
  name: string,
  patchFiles: readonly string[],
  enforcement: FeatureGateState,
  fromDefaultProfile?: string,
): Promise<ComposedProfile> {
  const profile = prepareProfile(name, true, fromDefaultProfile)
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile })
  const admission = evaluateFeatureGate(
    PLUGIN_MANIFEST_ENFORCEMENT_GATE.id,
    enforcement,
    () => admissionOutcome(partitionProfileLayersByAdmission(profile, false)),
    () => admissionOutcome(partitionProfileLayersByAdmission(profile, true)),
    ['admitted', 'denied'],
  )
  if (admission.shadowRecord !== undefined) appendShadowDecision('pre-mount-admission', admission.shadowRecord)
  const { admitted, denied } = admission.value
  for (const { layer, reason, wildcardFindings } of denied) {
    const detail = wildcardFindings.length > 0 ? `: ${wildcardFindings.map(finding => finding.path).join(', ')}` : ''
    process.stderr.write(
      `${NAME}: plugin admission: excluding bundle ${JSON.stringify(layer.packageName)} from profile `
      + `${JSON.stringify(name)} (${reason}${detail})\n`,
    )
  }
  const negotiation = negotiateProfileLayerCompatibility(admitted, resolveHostCompatContext(DSH_RUNTIME_API_VERSION))
  if (!negotiation.solvable) {
    const core = negotiation.unsatCore
      .map(entry => `  ${entry.pluginId}: ${entry.reasonCode} (${entry.constraintRef}) — ${entry.detail}`)
      .join('\n')
    throw new Error(
      `${NAME}: plugin compatibility: profile ${JSON.stringify(name)} has no solvable plugin graph.\n`
      + `Minimal conflicting constraint set:\n${core}`,
    )
  }
  for (const { layer, activation } of negotiation.blocked) {
    process.stderr.write(
      `${NAME}: plugin compatibility: excluding bundle ${JSON.stringify(layer.packageName)} from profile `
      + `${JSON.stringify(name)} (${activation.reasonCode}`
      + `${activation.missingCapabilities.length > 0 ? `: ${activation.missingCapabilities.join(', ')}` : ''})\n`,
    )
  }
  for (const { layer, activation } of negotiation.admitted) {
    if (activation.disabledOptionalCapabilities.length === 0) continue
    // acceptance[2]: an unsatisfied optional capability disables that feature
    // only, and is shown rather than left for the user to infer from absence.
    process.stderr.write(
      `${NAME}: plugin compatibility: bundle ${JSON.stringify(layer.packageName)} is active with disabled optional `
      + `capabilities: ${activation.disabledOptionalCapabilities.join(', ')}\n`,
    )
  }
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = negotiation.admitted.flatMap(entry => entry.layer.patches)
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
    admittedLayerNames: negotiation.admitted.map(entry => entry.layer.packageName),
    bundleLayers: negotiation.admitted.map(({ layer }) => ({
      packageName: layer.packageName,
      packageDir: layer.packageDir,
      entryIds: insertedEntryIds(layer.patches),
    })),
    deniedLayers: denied,
    compatBlockedLayers: negotiation.blocked,
  }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** Shipped template used once to initialize a missing profile. */
  fromDefaultProfile?: string | undefined
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
}

/** Env var whose non-empty value opts a development boot into skipping Trust Kernel initialization. */
const TRUST_KERNEL_INSECURE_ENV = 'DSH_TRUST_KERNEL_INSECURE'

/** Name of the system-prompt section that tells the model it runs without a Trust Kernel (Epic P0-02 acceptance[3]). */
const INSECURE_MODE_SECTION = 'insecure-development-mode'

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
 * Whether a profile's own `package.json` declares it an explicit development
 * profile (`dsh.profile.development: true`).
 * @param manifest - the profile's parsed `package.json`.
 * @returns whether the profile is an explicit development profile.
 */
export function isDevelopmentProfileManifest(manifest: ProfileManifest): boolean {
  return (manifest.dsh?.profile as { readonly development?: unknown } | undefined)?.development === true
}

/**
 * Show the untrusted status of plugins with no verified provenance, on every
 * boot and on every `dsh plugin add` that installs one, on every profile
 * (Epic P1-02 must[4]; question 30 (b)). An explicit development profile gets
 * `admitUnsignedDevMode`'s banner; any other profile is refused that admission
 * and gets a plain warning instead. Either line names every plugin whose
 * provenance record is `'unverified'`, and nothing is refused; with no such
 * plugin nothing is written.
 * @param profileName - the active profile's name.
 * @param developmentProfile - whether the profile is an explicit development profile.
 * @param records - the provenance record for each profile dependency the boot or install decided.
 * @param warn - sink for the untrusted-status warning; defaults to a stderr write.
 */
export function warnUnsignedDevPlugins(
  profileName: string,
  developmentProfile: boolean,
  records: ReadonlyMap<string, ProvenanceAuditRecord>,
  warn: (message: string) => void = (message) => { process.stderr.write(message) },
): void {
  const unverified = [...records].flatMap(([name, record]) => record.trust === 'unverified' ? [name] : [])
  if (unverified.length === 0) return
  const admission = admitUnsignedDevMode(
    { profileName, explicitDevOptIn: true },
    { allowedDevProfileNames: new Set(developmentProfile ? [profileName] : []) },
  )
  if (!admission.admitted) {
    warn(`${NAME}: WARNING: plugins with no verified provenance: ${unverified.join(', ')}.\n`)
    return
  }
  warn(`${NAME}: WARNING: ${admission.banner.message} Plugins with no verified provenance: ${unverified.join(', ')}.\n`)
}

/**
 * Epic P1-01's plugin admission and post-mount quarantine as a feature gate
 * (BLOCKED-322). Every profile defaults to `'shadow'`: the shipped bundles'
 * manifests do not yet declare everything their layers register, so
 * `'enforce'` would deny or quarantine shipped layers, and must[3]'s
 * `'enforce'` default waits until they do.
 * `'shadow'` composes and keeps every plugin exactly as `'off'` does, and
 * appends what `'enforce'` would have denied or quarantined to
 * {@link featureGateShadowLogPath}; `'off'` warns on stderr at every boot.
 * `scripts/release/feature-gate-expiry.ts` declares the same gate for the
 * release expiry check.
 */
export const PLUGIN_MANIFEST_ENFORCEMENT_GATE: FeatureGateDeclaration = {
  id: brandString<FeatureGateId>('plugin-manifest-enforcement'),
  owner: '@deepseek-ai/dsh-plugin-manifest',
  introducedVersion: '0.1.5-rc.2',
  defaultByProfile: { default: 'shadow' },
  removalVersion: '0.2.0',
}

/**
 * Declared feature gates for this installation (Epic P0-05 must[2]/must[3]),
 * which {@link resolveProfileFeatureGates} resolves for `--dump-config` and
 * for every boot.
 */
export const FEATURE_GATE_DECLARATIONS: readonly FeatureGateDeclaration[] = [PLUGIN_MANIFEST_ENFORCEMENT_GATE]

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
 * repository registers no `feature-gates` settings namespace yet, so that
 * layer's absence is correct today, not a gap in this function.
 *
 * The `env` layer may lower an `'enforce'` floor (user decision G1b): it is
 * the launch environment, set by whoever starts this process, who can already
 * edit the profile's `package.json` and patch files. A `settings` layer,
 * which a running process can change, must not share that authority.
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
    return resolveFeatureGate(declaration, profile, envOverride === undefined
      ? {}
      : { env: envOverride, hasKernelAdministrativeAuthority: true })
  })
}

/**
 * This boot's state for one declared gate.
 * @param resolutions - {@link resolveProfileFeatureGates}'s result for this boot.
 * @param declaration - a gate {@link FEATURE_GATE_DECLARATIONS} lists.
 * @returns the gate's resolved state.
 * @throws when `resolutions` holds no resolution for `declaration`.
 */
function resolvedGateState(resolutions: readonly FeatureGateResolution[], declaration: FeatureGateDeclaration): FeatureGateState {
  const resolution = resolutions.find(candidate => candidate.gateId === declaration.id)
  if (resolution === undefined) throw new Error(`${NAME}: feature gate ${JSON.stringify(declaration.id)} was not resolved for this boot`)
  return resolution.resolved.value
}

/**
 * The JSONL file every shadow-mode gate decision is appended to: one line
 * per decision, a {@link FeatureGateShadowDecisionRecord} with the boot stage
 * that made it and when. It is the only boot-decision record under
 * `$DSH_HOME`.
 * @returns the absolute file path under the Harness home.
 */
export function featureGateShadowLogPath(): string {
  return join(resolveDshHome(), 'feature-gates', 'shadow-decisions.jsonl')
}

/**
 * Append one shadow decision to {@link featureGateShadowLogPath}.
 * @param stage - the boot stage that made the decision.
 * @param record - the redacted legacy/enforce comparison.
 */
function appendShadowDecision(stage: 'pre-mount-admission' | 'post-mount-comparison', record: FeatureGateShadowDecisionRecord): void {
  const path = featureGateShadowLogPath()
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify({ recordedAt: new Date().toISOString(), stage, ...record })}\n`)
}

/**
 * One post-mount quarantine: the package whose manifest judged a group of
 * entries quarantined, one quarantined state of that group (its comparison
 * names why), and the id of every entry the group loses.
 */
interface ManifestQuarantine {
  readonly judgedBy: string
  readonly state: PluginPermissionState
  readonly entryIds: readonly string[]
}

/** Quarantines as a gate decision; its summary keeps the judging package names, entry ids, and the mismatched names. */
function quarantineOutcome(
  quarantines: readonly ManifestQuarantine[],
): FeatureGateDecisionOutcome<readonly ManifestQuarantine[]> {
  return {
    value: quarantines,
    summary: {
      quarantined: quarantines.map(({ judgedBy, state, entryIds }) => ({
        package: judgedBy,
        entries: [...entryIds],
        mismatches: (state.comparison?.mismatches ?? []).map(({ kind, category, name }) => ({ kind, category, name })),
        wildcardPaths: (state.comparison?.wildcardFindings ?? []).map(finding => finding.path),
      })),
    },
  }
}

/**
 * The layers with each row id replaced by the Loader entry id that row
 * received. A profile's patches land in the tree of the include `boot()`
 * mounts at the root, and an entry in a nested tree is identified by its
 * tree's entry id followed by its own (`include:<row id>`), so the rows of
 * that tree, groups included, are matched by the id they were configured with.
 * @param ctx - the settled root context.
 * @param layers - the admitted layers with the row ids their patches insert.
 * @returns the same layers with Loader entry ids; a row with no entry is dropped.
 */
function withLoaderEntryIds(ctx: Context, layers: readonly BundleLayerScope[]): BundleLayerScope[] {
  const entryIdOf = new Map<string, string>()
  for (const entry of ctx.loader.entries()) {
    const include = entry.parent.tree.ctx.fiber.entry
    if (include === undefined || include.parent.tree.ctx.fiber.entry !== undefined) continue
    entryIdOf.set(entry.options.id, entry.id)
  }
  return layers.map(layer => ({ ...layer, entryIds: layer.entryIds.flatMap(rowId => entryIdOf.get(rowId) ?? []) }))
}

/**
 * Every quarantine the live tree calls for, one per manifest that judged an
 * entry `'quarantined'`: it takes every entry judged with that manifest and,
 * for a bundle layer, every entry the layer inserted that no other manifest
 * judged.
 * @param ctx - the settled, active root context.
 * @param admittedLayerNames - the composed profile's admitted bundle layer names, for provenance.
 * @param bundleLayers - the same layers with the row ids each one's patches insert.
 * @param provenanceRecords - this boot's provenance record for each profile dependency, for the inventory.
 * @returns the quarantines, in the order their first quarantined state appears.
 */
function manifestQuarantines(
  ctx: Context,
  admittedLayerNames: readonly string[],
  bundleLayers: readonly BundleLayerScope[],
  provenanceRecords: ReadonlyMap<string, ProvenanceAuditRecord>,
): ManifestQuarantine[] {
  const layers = withLoaderEntryIds(ctx, bundleLayers)
  const states = buildPluginPermissionStates(ctx, { bundlePackageNames: admittedLayerNames, bundleLayers: layers, provenanceRecords })
  const quarantined = new Map<string, PluginPermissionState>()
  for (const state of states) {
    if (state.trustDecision === 'quarantined' && state.judgedBy !== undefined && !quarantined.has(state.judgedBy)) {
      quarantined.set(state.judgedBy, state)
    }
  }
  return [...quarantined].map(([judgedBy, state]) => {
    const judgedElsewhere = new Set<string>(states.flatMap(other =>
      other.judgedBy !== undefined && other.judgedBy !== judgedBy ? [other.entryId] : []))
    const entryIds = new Set<string>([
      ...states.flatMap(other => other.judgedBy === judgedBy ? [other.entryId] : []),
      ...(layers.find(layer => layer.packageName === judgedBy)?.entryIds ?? []).filter(id => !judgedElsewhere.has(id)),
    ])
    return { judgedBy, state, entryIds: [...entryIds] }
  })
}

/**
 * Post-mount plugin quarantine (Epic P1-01.U's must[3]/acceptance[0] second
 * half): after `boot()` settles, build every live Loader entry's real
 * declared-vs-observed permission state (`@deepseek-ai/dsh-plugin-inventory`'s
 * `buildPluginPermissionStates`, which walks the actual Cordis `Context`) and
 * dispose the fiber of every entry judged with a manifest `decidePluginTrust`
 * marked `'quarantined'` — a plugin that registered a capability its manifest
 * never declared loses every registration it made, for real, not just a
 * returned decision value. An admitted bundle layer is judged with the
 * packages it mounts that declare no manifest of their own, so a quarantined
 * layer loses every entry it inserted that no other manifest judged, and the
 * line names the layer. The decision goes through
 * {@link PLUGIN_MANIFEST_ENFORCEMENT_GATE}: `'enforce'` disposes those
 * entries, `'off'` builds no state and disposes nothing, and `'shadow'`
 * disposes nothing and appends which layers and entries `'enforce'` would
 * have disposed to {@link featureGateShadowLogPath}. Under `'enforce'`,
 * pre-mount admission ({@link partitionProfileLayersByAdmission}, called
 * from {@link composeProfile}) already excluded a denied bundle layer's
 * patches before this runs.
 * @param ctx - the settled, active root context.
 * @param enforcement - this boot's resolved {@link PLUGIN_MANIFEST_ENFORCEMENT_GATE} state.
 * @param admittedLayerNames - the composed profile's admitted bundle layer names, for provenance.
 * @param bundleLayers - the same layers with the row ids each one's patches insert, as {@link composeProfile} records them.
 * @param provenanceRecords - this boot's provenance record for each profile dependency, for the inventory (P1-02 acceptance[2]).
 */
export async function applyPostMountPluginEnforcement(
  ctx: Context,
  enforcement: FeatureGateState,
  admittedLayerNames: readonly string[],
  bundleLayers: readonly BundleLayerScope[] = [],
  provenanceRecords: ReadonlyMap<string, ProvenanceAuditRecord> = new Map(),
): Promise<void> {
  const quarantine = evaluateFeatureGate(
    PLUGIN_MANIFEST_ENFORCEMENT_GATE.id,
    enforcement,
    () => quarantineOutcome([]),
    () => quarantineOutcome(manifestQuarantines(ctx, admittedLayerNames, bundleLayers, provenanceRecords)),
    ['quarantined'],
  )
  if (quarantine.shadowRecord !== undefined) appendShadowDecision('post-mount-comparison', quarantine.shadowRecord)
  for (const { judgedBy, state, entryIds } of quarantine.value) {
    process.stderr.write(
      `${NAME}: plugin quarantine: disposing ${JSON.stringify(judgedBy)} `
      + `(declared/observed mismatch: ${JSON.stringify(state.comparison?.mismatches)})\n`,
    )
    const disposing = new Set(entryIds)
    for (const entry of ctx.loader.entries()) {
      if (disposing.has(entry.id)) await entry.fiber?.dispose()
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
  // Before the first plugin mounts and before anything can issue a request: Node's fetch ignores the
  // proxy environment on its own, so every profile would otherwise connect directly. Resolving from
  // the launcher's snapshot — not `process.env` — is what lets a proxy declared in a `.env` layer
  // work, which the NODE_USE_ENV_PROXY flag cannot do because Node samples the environment at start.
  const disposeProxy = await installProxyFromEnvironment(
    options.environment,
    (message) => { process.stderr.write(`${NAME}: ${message}\n`) },
  )

  const featureGates = resolveProfileFeatureGates(options.profile)
  const pluginEnforcement = resolvedGateState(featureGates, PLUGIN_MANIFEST_ENFORCEMENT_GATE)
  if (pluginEnforcement === 'off') {
    process.stderr.write(
      `${NAME}: WARNING: plugin manifest enforcement is off -- every bundle layer is composed without admission and `
      + `no plugin is quarantined; set ${featureGateEnvVarName(PLUGIN_MANIFEST_ENFORCEMENT_GATE.id)}=enforce to enforce it.\n`,
    )
  }
  const composed = await composeProfile(options.profile, options.patchFiles, pluginEnforcement, options.fromDefaultProfile)
  const trustKernelInsecure = resolveTrustKernelInsecureOptIn(process.env[TRUST_KERNEL_INSECURE_ENV])
  // Only a profile that declares `dsh.profile.development: true` in its own
  // package.json may opt out of the Trust Kernel (Epic P0-02 acceptance[2]/[3]).
  // Read once here — before boot() creates any Context — and reused below for
  // the model-visible insecure notice. A shipped profile with the insecure
  // opt-in set refuses to start before any config-tree entry mounts.
  const profileManifest = readProfileManifest(NAME, composed.profile.dir)
  const developmentProfile = isDevelopmentProfileManifest(profileManifest)
  if (trustKernelInsecure && !developmentProfile) {
    throw new Error(`${NAME}: ${TRUST_KERNEL_INSECURE_ENV} is set but profile ${JSON.stringify(options.profile)} is not a development profile -- refusing to boot (only a profile declaring dsh.profile.development may boot without a Trust Kernel)`)
  }
  // Epic P1-02 acceptance[1]: every dependency installed from a local tarball
  // with a claim beside it is verified again, offline, before any plugin code
  // runs. A refused claim stops the boot in every mode, a development
  // profile's included: a claim that fails is not an unsigned package.
  const provenance = verifyBootProvenance(
    profileManifest.dependencies ?? {},
    composed.profile.dir,
    readLockedProvenance(composed.profile.dir),
  )
  // Constructed before boot() creates the Cordis Context at all (must[1]):
  // createTrustKernel is pure and synchronous, so it cannot itself fail --
  // the insecure opt-in is the only way this boot proceeds without one.
  // The kernel's decider ENDORSES the composed decision and adds none of its
  // own. Without one, `policyEnforcement` denies every query — the correct
  // default for an entrypoint with no provider behind it, and the reason every
  // tool call on a factory profile was refused `policy-unavailable` even after
  // an engine was mounted: the engine answered permit and the kernel's
  // placeholder overrode it (BLOCKED-187).
  //
  // It states the two contracts the enforcement point already pins: a deny
  // survives (a kernel `allow` never widens a refusal the engine or a
  // constraint made), and a permit is passed through unchanged because THERE
  // IS NO KERNEL-LEVEL POLICY PROVIDER TODAY. When one exists, this is where
  // it decides; until then, inventing a kernel refusal here would be a second
  // policy nobody wrote.
  //
  // The anchors are the profile's own `dsh.trustAnchors`, the field
  // `dsh plugin` verifies installs against (P1-02 must[2]).
  const kernel: TrustKernel | undefined = trustKernelInsecure
    ? undefined
    : createTrustKernel({ policyDecider: endorseComposedDecision, trustAnchors: readProfileTrustAnchors(composed.profile.dir) })
  // Epic P1-02 acceptance[2]: the boot's provenance decisions, refusals
  // included, go to the kernel's audit chain before a refusal stops the boot.
  if (kernel !== undefined) appendProvenanceAudit(kernel.auditAppend, 'boot', provenance)
  if (provenance.refused.length > 0) {
    throw new Error(
      `${NAME}: plugin provenance: refusing to boot profile ${JSON.stringify(options.profile)} -- `
      + provenance.refused.map(({ name, reason }) => `${name}: provenance claim refused (${reason})`).join('; '),
    )
  }
  const app: { current?: Context } = {}
  const appReady = createAppReady()
  const shutdown = createProcessShutdown(async () => {
    await app.current?.fiber.dispose()
    await disposeProxy()
  })
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
    // Sealing its anchor set means no plugin can admit or withdraw a trust
    // anchor on the kernel it reaches (Epic P1-02 must[3]).
    if (kernel !== undefined) {
      pinTrustKernel(hostCtx, kernel)
      sealTrustAnchors(kernel.signatureRoots)
    }
    enforceTrustKernelPosture(hostCtx.get('trustKernel') !== undefined, trustKernelInsecure)
    // Whether THIS launch is an explicit development profile (Epic P0-02
    // acceptance[2]/[3], C19 §2), published once here — before any config-tree
    // entry mounts, on every launch — so the dispatch paths, and later P1-02's
    // unsigned-development admission and the G4 untrusted banner, read one
    // launcher fact rather than re-reading the manifest. The dispatch paths refuse a
    // kernel-less dispatch unless the launch is a development profile; by this
    // line an insecure opt-in on a non-development profile has already refused
    // the boot, so a kernel-less launch that reaches here is a development one.
    hostCtx.provide(DEVELOPMENT_PROFILE_KEY, developmentProfile)
    // Epic P1-02 must[4]: a development profile names, on every boot, each
    // plugin that runs with no verified provenance; no other profile does.
    warnUnsignedDevPlugins(options.profile, isDevelopmentProfile(hostCtx), provenance.records)
    // Feature gates (Epic P0-05 must[3]): the resolution composeProfile
    // already used, provided before any config-tree entry mounts, so a gated
    // plugin reads exactly what `--dump-config` shows for this same
    // profile/environment. Provided under a bare service name -- no plugin
    // injects `featureGates`, so the typed `declare module '@deepseek-ai/cordis'`
    // augmentation belongs with `@deepseek-ai/dsh-feature-gates` once a plugin
    // consumes it, matching that package's own Known Limitations.
    hostCtx.provide('featureGates', featureGates)
  })
  app.current = ctx
  // Post-mount quarantine (must[3]/acceptance[0]): after every bundle's
  // plugins have mounted and had their chance to register, before HMR/watch
  // setup adds any further Loader entries of its own.
  if (!signalShutdown.signal.aborted && ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
    await applyPostMountPluginEnforcement(ctx, pluginEnforcement, composed.admittedLayerNames, composed.bundleLayers, provenance.records)
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
  if (trustKernelInsecure && developmentProfile) {
    // A development profile that opted out of the Trust Kernel tells the model,
    // in its own request, that it runs without that protection (Epic P0-02
    // acceptance[3]). The launcher adds this section, not the Kernel API, so the
    // Kernel API carries no model-visible text (acceptance[1]).
    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt !== undefined) {
      systemPrompt.section({
        name: INSECURE_MODE_SECTION,
        order: systemPrompt.getSectionOrder('INSECURE_MODE'),
        text: 'This DeepSeek Harness runs in an insecure development mode: no Trust Kernel is pinned, so root identity, signature roots, policy enforcement, audit append, the secret broker and sandbox attestation are all unavailable. Never rely on those protections here, and never use this mode in production.',
      })
    }
  }
  return { ctx, shutdown }
}

/** The lock file a profile keeps beside its `package.json`. */
const PROFILE_LOCK_FILENAME = 'plugins.lock.json'

/**
 * The provenance the profile's lock records, by package name (Epic P1-02).
 * @param profileDir - the profile directory holding the lock file.
 * @returns each locked package's record; empty when the profile has no lock.
 */
function readLockedProvenance(profileDir: string): ReadonlyMap<string, ProvenanceAuditRecord> {
  const lockPath = join(profileDir, PROFILE_LOCK_FILENAME)
  if (!existsSync(lockPath)) return new Map()
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as PluginLockFile
  return new Map(lock.entries.flatMap(entry => entry.provenance === undefined ? [] : [[entry.name, entry.provenance] as const]))
}

/** The bundle `package.json` key each shipped bundle declares its boot policy under. */
const UNLOCKED_POLICY_KEY = 'dsh.pluginLock.unlockedProfilePolicy'

/**
 * The unlocked-profile policy in force for a composed profile (P1-03 must[2]).
 *
 * Each shipped bundle declares its own under `dsh.pluginLock.unlockedProfilePolicy`
 * in its `package.json`, beside the bundle metadata `readPluginDeclaration`
 * already reads. It lives there rather than in `cordis.patch.yml` because that
 * file is a LIST of patch operations validated as an entry list — a top-level
 * key in it is not merely unconventional, it fails validation.
 *
 * **Most restrictive wins.** A profile composing a `production-controlled`
 * preset beside an ordinary bundle enforces the preset: any layer declaring
 * `refuse` makes the whole boot refuse. The opposite rule would let adding one
 * bundle silently relax a deployment's own hardening.
 *
 * **Required, with no default.** A profile whose layers declare nothing at all
 * throws rather than picking one: the choice is a product-visible boot policy,
 * and this repository's rule is that defaulting is an explicit resolve step
 * and never a hidden fallback.
 * @param layerDirs - the admitted bundle package directories.
 * @returns the effective policy.
 * @throws Error when no layer declares one, or a layer declares an unknown value.
 */
export function resolveUnlockedProfilePolicy(layerDirs: readonly string[]): UnlockedProfilePolicy {
  const declared: UnlockedProfilePolicy[] = []
  for (const packageDir of layerDirs) {
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { pluginLock?: { unlockedProfilePolicy?: unknown } }
    }
    const value = manifest.dsh?.pluginLock?.unlockedProfilePolicy
    if (value === undefined) continue
    if (value !== 'refuse' && value !== 'warn-and-proceed') {
      throw new Error(
        `${NAME}: plugin lock: ${packageDir} declares ${UNLOCKED_POLICY_KEY} as ${JSON.stringify(value)}; `
        + 'the only values are "refuse" and "warn-and-proceed"',
      )
    }
    declared.push(value)
  }
  if (declared.length === 0) {
    throw new Error(
      `${NAME}: plugin lock: no composed bundle declares ${UNLOCKED_POLICY_KEY}. `
      + 'It is required and has no default, because what a production boot does with an unlocked profile is a '
      + 'product decision rather than one this code may make silently.',
    )
  }
  return declared.includes('refuse') ? 'refuse' : 'warn-and-proceed'
}

/**
 * Gate a production boot against the profile's lock (P1-03 must[2]).
 *
 * The Contract stage proved `gateProductionBoot` decides correctly; this is
 * the call site that makes a real boot ask it. A drifted manifest digest is
 * refused whatever the policy says — the policy governs only what happens when
 * there is NO lock, never whether a lock that exists is honoured.
 * @param profileDir - the profile directory holding the lock file.
 * @param layerDirs - the admitted bundle package directories.
 * @param policy - the effective unlocked-profile policy.
 * @returns the gate's outcome.
 */
export async function gateProfileAgainstLock(
  profileDir: string,
  layerDirs: readonly string[],
  policy: UnlockedProfilePolicy,
): Promise<GateOutcome> {
  const lockPath = join(profileDir, PROFILE_LOCK_FILENAME)
  const lock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, 'utf8')) as PluginLockFile
    : undefined
  // Integrity comes from the profile's own lockfile, the same source the lock
  // was BUILT from, so the two sides are observations of one record rather
  // than of a manifest field nothing writes (BLOCKED-135).
  const recorded = await readLockfileIntegrity(profileDir)
  const installed: InstalledPlugin[] = []
  for (const packageDir of layerDirs) {
    const manifestPath = join(packageDir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name: string; version?: string }
    installed.push({
      // Every field is recomputed from what is on disk right now, never read
      // back from the lock: comparing a lock against itself would admit any
      // profile. A package the lockfile does not record keeps the
      // `unavailable:` marker, which `admitBoot` now REFUSES rather than
      // matching against itself.
      name: manifest.name,
      version: manifest.version ?? '0.0.0',
      integrity: recorded.get(brandString<PluginPackageName>(manifest.name))?.integrity
        ?? `${UNAVAILABLE_PREFIX}installer-recorded-no-integrity`,
      manifestDigest: computeManifestDigest(manifest),
    } as InstalledPlugin)
  }
  return gateProductionBoot(lock, installed, policy)
}
