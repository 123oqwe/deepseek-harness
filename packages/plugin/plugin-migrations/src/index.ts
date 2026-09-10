/**
 * Plugin migration decisions for Epic P1-10's Contract stage: whether a
 * manifest's migration DAG can be run at all, which steps an upgrade would
 * take, whether it can be undone, and whether a snapshot reconciles with the
 * data it claims to cover.
 *
 * Every export is a pure function over its arguments. There is no I/O here and
 * no service: the six-phase transaction must[1] names — freeze, snapshot,
 * migrate in quarantine, validate, atomic switch, health check — is an
 * ordering over real effects, and a module that could perform one of them
 * would be a second place the upgrade happens.
 *
 * @module @deepseek-ai/dsh-plugin-migrations
 */

import type {
  MigrationRefusal,
  PluginDataSnapshot,
  PluginMigration,
  PluginMigrationManifest,
  PluginSchemaVersion,
  UpgradePlan,
} from './types.ts'

export type * from './types.ts'

/**
 * Whether the manifest's migrations can be ordered at all (must[0]).
 *
 * A cycle is refused STRUCTURALLY and named as one, rather than being
 * discovered by a traversal that runs out of depth: an operator reading
 * "these versions form a cycle" knows which declarations to fix, while one
 * reading "too many steps" cannot tell a loop from a long history.
 * @param manifest - the plugin's declared migrations.
 * @returns the cycle refusal, or `undefined` when the declarations are acyclic.
 */
export function findMigrationCycle(manifest: PluginMigrationManifest): MigrationRefusal | undefined {
  const next = new Map<PluginSchemaVersion, PluginSchemaVersion>()
  for (const migration of manifest.migrations) next.set(migration.from, migration.to)
  for (const start of next.keys()) {
    const seen: PluginSchemaVersion[] = []
    let at: PluginSchemaVersion | undefined = start
    while (at !== undefined) {
      if (seen.includes(at)) {
        return { kind: 'cyclic', versions: [...seen.slice(seen.indexOf(at)), at] }
      }
      seen.push(at)
      at = next.get(at)
    }
  }
  return undefined
}

/**
 * Whether two migrations leave the same version, which makes the next step
 * ambiguous (must[0]).
 *
 * Refused rather than resolved by a rule such as "prefer the highest target":
 * a manifest declaring two ways forward has not said which is correct, and an
 * upgrade that picked one would be choosing on the author's behalf about their
 * own data.
 * @param manifest - the plugin's declared migrations.
 * @returns the ambiguity refusal, or `undefined` when every version has at
 *   most one outgoing migration.
 */
export function findAmbiguousEdge(manifest: PluginMigrationManifest): MigrationRefusal | undefined {
  const seen = new Set<PluginSchemaVersion>()
  for (const migration of manifest.migrations) {
    if (seen.has(migration.from)) return { kind: 'ambiguous-edge', from: migration.from }
    seen.add(migration.from)
  }
  return undefined
}

/**
 * The steps that carry `installed` up to the manifest's current version, or
 * why they cannot (must[0], must[2]).
 *
 * `reversible` on an admitted plan is the AND over its steps, because an
 * upgrade can only be undone if every step it took can be: one irreversible
 * conversion in the middle makes the whole path one-way, and must[2]'s
 * approval is owed for the path rather than for the step.
 *
 * Preconditions are reported rather than evaluated. This module cannot know
 * whether a plugin's disk is writable or its external system is reachable, and
 * a precondition it silently treated as satisfied would be an upgrade admitted
 * on an assumption nobody made.
 * @param manifest - the plugin's declared migrations.
 * @param installed - the schema version currently on disk.
 * @returns the admitted plan with its steps, or the refusal.
 */
export function planUpgrade(
  manifest: PluginMigrationManifest,
  installed: PluginSchemaVersion,
): UpgradePlan {
  const cyclic = findMigrationCycle(manifest)
  if (cyclic !== undefined) return { admitted: false, refusal: cyclic }
  const ambiguous = findAmbiguousEdge(manifest)
  if (ambiguous !== undefined) return { admitted: false, refusal: ambiguous }

  const byFrom = new Map<PluginSchemaVersion, PluginMigration>()
  for (const migration of manifest.migrations) byFrom.set(migration.from, migration)

  const steps: PluginMigration[] = []
  let at = installed
  while (at !== manifest.current) {
    const step = byFrom.get(at)
    if (step === undefined) {
      return { admitted: false, refusal: { kind: 'unreachable', from: installed, to: manifest.current } }
    }
    steps.push(step)
    at = step.to
  }

  const pending = steps.flatMap(step => step.preconditions ?? [])
  if (pending.length > 0) {
    return { admitted: false, refusal: { kind: 'preconditions-undecided', preconditions: pending } }
  }
  return { admitted: true, steps, reversible: steps.every(step => step.reversible) }
}

/**
 * Whether an upgrade needs human approval and an export before it may run
 * (must[2]).
 *
 * The DECISION, not the asking. `@deepseek-ai/dsh-user-approval` cannot serve
 * this today — its request carries a `toolName` and it refuses outside an open
 * turn, while a plugin upgrade is a CLI command with neither — so a caller
 * that treated a `true` here as "the approval happened" would be claiming a
 * mechanism this stage does not have. Which seam asks is the Usage stage's,
 * and it is an open ruling.
 * @param plan - the planned upgrade.
 * @returns true when the path is irreversible, so must[2]'s approval and
 *   export are owed.
 */
export function requiresApprovalAndExport(plan: UpgradePlan): boolean {
  return plan.admitted && !plan.reversible
}

/**
 * Whether a snapshot can be reconciled with the data it claims to cover
 * (acceptance[1]).
 *
 * Both halves are checked because they fail differently: a snapshot of another
 * PLUGIN is a wiring mistake, and a snapshot at another VERSION is a stale
 * backup that would restore a shape the current code cannot read. Recording
 * the digest is the transaction's job; deciding what makes it reconcilable is
 * this one's.
 * @param snapshot - the snapshot offered.
 * @param plugin - the plugin being restored.
 * @param version - the version the restore expects.
 * @returns the mismatch refusal, or `undefined` when the snapshot matches.
 */
export function reconcileSnapshot(
  snapshot: PluginDataSnapshot,
  plugin: string,
  version: PluginSchemaVersion,
): MigrationRefusal | undefined {
  if (snapshot.plugin !== plugin) {
    return { kind: 'snapshot-mismatch', expected: plugin, actual: snapshot.plugin }
  }
  if (snapshot.version !== version) {
    return { kind: 'snapshot-mismatch', expected: version, actual: snapshot.version }
  }
  return undefined
}

/**
 * Whether a snapshot path stays inside the plugin's own storage (P3-11's
 * boundary).
 *
 * A workspace path is REFUSED rather than unsupported. P3-11 owns workspace
 * checkpointing, and the manifest's backup strategy is exactly where the two
 * would blur: a plugin declaring a workspace directory as its backup would
 * make this epic's transaction responsible for a user's files.
 *
 * The comparison is on the already-resolved path the caller supplies. This
 * module resolves nothing — resolution reads a filesystem, and a decision that
 * did that would be the I/O this stage has none of.
 * @param path - the resolved snapshot path.
 * @param pluginStorageRoot - the resolved root of the plugin's own storage.
 * @returns the boundary refusal, or `undefined` when the path is inside.
 */
export function refuseOutsidePluginStorage(
  path: string,
  pluginStorageRoot: string,
): MigrationRefusal | undefined {
  const root = pluginStorageRoot.endsWith('/') ? pluginStorageRoot : `${pluginStorageRoot}/`
  // `startsWith` on the root WITH its separator, so a sibling directory whose
  // name merely begins with the root's does not pass as being inside it.
  return path.startsWith(root) ? undefined : { kind: 'outside-plugin-storage', path }
}
