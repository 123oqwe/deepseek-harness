import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ObservedPluginCapabilities,
  PluginDeclaration,
  PluginRegistrationComparison,
  PluginTrustDecision,
} from '@deepseek-ai/dsh-plugin-manifest'
import type { PluginActivationStatus } from '@deepseek-ai/dsh-plugin-compat'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  /**
   * Epic P1-08's solved compatibility-graph outcome for this entry's
   * plugin, present once a `@deepseek-ai/dsh-plugin-compat` `solvePluginGraph`
   * call has recorded one for the current boot (registry's own validation
   * guidance: "将结果写入 `--dump-config` 和 plugin inventory" / write the
   * result to `--dump-config` and plugin inventory); absent before that
   * Usage-stage wiring runs. Mirrors one `PluginGraphSolution.loadPlan`
   * row's `activation` field so a reader does not need its own copy of
   * `PluginId` resolution to find this entry's outcome.
   */
  readonly compatActivation?: PluginActivationStatus
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One plugin row an agent preset's composition names. */
export interface AgentPresetPluginRow {
  /** Composition row id, or null when the row declares none. */
  readonly entryId: string | null
  /** Module specifier the row names. */
  readonly moduleName: string
  /**
   * Effective enablement, including disabled ancestor groups. `'conditional'`
   * marks a `!!js` disabled expression on a composition no session has
   * mounted, which only a Loader context can decide.
   */
  readonly enabled: PresetPluginEnablement
  /** The row's own `!!js` disabled expression, when it carries one. */
  readonly condition?: string
  /** Root-fiber phase when the composition is live; null otherwise. */
  readonly fiberPhase: PluginFiberPhase
}

/** One agent preset's identity and flattened composition in the inventory. */
export interface AgentPresetPluginGroup {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Display name the preset published; a reader falls back to the id. */
  readonly name?: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Why this preset's composition cannot be read; absent when rows answer. */
  readonly broken?: string
  /** Plugin rows in composition order; empty when the preset is broken. */
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /**
   * Per-preset compositions, present only when an agent-preset roster is
   * composed in this deployment.
   */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
}

/**
 * One installed plugin package's exact identity: the npm package name and
 * installed version its own `package.json` declares. Mirrors this repo's
 * existing `DeepSeekPluginPackageIdentity` naming
 * (`@deepseek-ai/dsh-plugin-package-inventory-deepseek`, which resolves the
 * same real-world fact — the `name`/`version` of the package that owns an
 * active Loader entry — for DeepSeek request contribution) without this
 * host package depending on that DeepSeek-request-specific one.
 */
export interface PluginPackageIdentity {
  readonly name: string
  readonly version: string
}

/**
 * How a plugin entry's manifest/bundle patch reached the running Loader
 * tree. `'bundle'` — a `dsh.profile.bundles` layer (`ProfileLayer.packageName`
 * in `@deepseek-ai/dsh-app-boot`'s profile composition); `'agent-preset'` — a
 * row in a composed {@link AgentPresetPluginGroup}; `'built-in'` — mounted
 * directly by the harness with no package or preset boundary of its own.
 */
export type PluginProvenanceKind = 'bundle' | 'agent-preset' | 'built-in'

/** Where one plugin entry's manifest/bundle patch reached the running Loader tree. */
export interface PluginProvenance {
  readonly kind: PluginProvenanceKind
  /**
   * The bundle package name (`kind: 'bundle'`) or agent-preset id
   * (`kind: 'agent-preset'`, matching {@link AgentPresetPluginGroup.id})
   * this entry composed through; absent for a `'built-in'` entry, which has
   * no such identity to name.
   */
  readonly source?: string
}

/**
 * must[0]/acceptance[1]'s declared-vs-observed permission state for one
 * plugin entry: what its package.json's `dsh` field declares
 * ({@link PluginDeclaration}, `@deepseek-ai/dsh-plugin-manifest`'s
 * Contract-stage classification, reused directly here rather than
 * summarized — a plugin with a valid manifest carries the full
 * `PluginManifestV2` through `declaration.manifest`), what it actually
 * registered into the live Cordis `Context`
 * ({@link ObservedPluginCapabilities}), the installed package identity, and
 * where the entry came from. `comparison`/`trustDecision` are present only
 * once a caller has actually run
 * `@deepseek-ai/dsh-plugin-manifest`'s `compareDeclaredToObserved`/
 * `decidePluginTrust` against `declaration`/`observed` — this Provider-stage
 * type only fixes the shape; pairing a live `PluginInventoryEntry` with a
 * real `package.json` read, a real `classifyPluginDeclaration` call, and a
 * real observed-registration walk is a later stage's job — this package's
 * own `src/index.ts` does not build one.
 */
export interface PluginPermissionState {
  readonly entryId: PluginEntryId
  readonly packageIdentity: PluginPackageIdentity
  readonly provenance: PluginProvenance
  readonly declaration: PluginDeclaration
  readonly observed: ObservedPluginCapabilities
  readonly comparison?: PluginRegistrationComparison
  readonly trustDecision?: PluginTrustDecision
}
