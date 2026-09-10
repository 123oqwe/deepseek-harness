/**
 * The six-phase plugin upgrade transaction Epic P1-10's must[1] declares:
 * freeze, snapshot, migrate in quarantine, validate, atomic switch, health
 * check.
 *
 * The phases are an ordering over real effects, which is why they live here
 * and not beside the decisions in `./index.ts`. The effects themselves belong
 * to whatever medium holds the plugin's data: this module calls the storage
 * backend's migration facet and never names a path, so the same ordering runs
 * over `storage-json`'s files and `storage-sqlite`'s databases alike.
 *
 * The first version of this file wrote to a `plugins/<name>/data/data.db` of
 * its own invention — a path nothing else in the tree touches, while the
 * harness keeps plugin data in the storage hub's units. Recorded because the
 * shape it produced looked complete and had no subject.
 */

import type { KvUnitDescriptor, MigrationFacet, UnitSnapshot } from '@deepseek-ai/dsh-storage'
import type { RunLease } from '@deepseek-ai/dsh-lease-contract'

import { computeMigrationPathDigest, planUpgrade } from './index.ts'
import type { MigrationRefusal, PluginMigrationManifest, PluginSchemaVersion } from './types.ts'

/** The phases must[1] names, in the order it names them. */
export const UPGRADE_PHASES = [
  'freeze',
  'snapshot',
  'quarantine',
  'validate',
  'switch',
  'health-check',
] as const

/** One phase of the upgrade transaction. */
export type UpgradePhase = typeof UPGRADE_PHASES[number]

/** What one upgrade records about itself, in two halves. */
export interface UpgradeRecord {
  /** The plugin upgraded. */
  readonly plugin: string
  /** The version it started at. */
  readonly from: string
  /** The version the manifest declares current. */
  readonly to: string
  /** Digest of the ordered steps, which an operator's confirmation names. */
  readonly pathDigest: string
  /**
   * The snapshot the upgrade took, so a recovery after a crash can discard it
   * without knowing the medium.
   *
   * Backend-private, and that is the point: recovery asks the facet to undo
   * what the facet did, rather than a consumer knowing which directories a
   * backend keeps.
   */
  readonly snapshotHandle?: string
  /** The state the switch replaced, present only once the switch happened. */
  readonly previousHandle?: string
  /** Present only once the health check passed. */
  readonly upgradedTo?: string
  /** Present only once the health check passed. */
  readonly dataDigest?: string
}

/** What the caller supplies to run one upgrade. */
export interface UpgradeRequest {
  /** The plugin being upgraded. */
  readonly plugin: string
  /** Its declared migrations. */
  readonly manifest: PluginMigrationManifest
  /** The version currently stamped on the medium, as the manifest spells it. */
  readonly installed: PluginSchemaVersion
  /** The unit holding this plugin's durable data. */
  readonly unit: KvUnitDescriptor
  /**
   * The backend's migration facet, absent when this medium cannot migrate.
   *
   * Absence is answered by NAME at plan time: a deployment whose backend
   * cannot snapshot is told before anything else happens, rather than
   * discovering it as a missing method.
   */
  readonly migration: MigrationFacet | undefined
  /**
   * The upgrade's cross-process lease.
   *
   * A backend cannot exclude a writer in another process, and `dsh plugin
   * update` is a different process from a running session. The lease is what
   * makes the snapshot consistent, and its FENCING token is what makes the
   * switch safe: a holder superseded while the migration ran must not swap
   * anything in.
   */
  readonly lease: RunLease
  /** Reads the clock; injected so a case can drive expiry deterministically. */
  readonly now: () => number
  /** Converts the records to the new version, inside the quarantine. */
  readonly migrate: (records: readonly unknown[]) => Promise<readonly unknown[]>
  /** Answers whether the migrated copy validates; the digest it returns is recorded. */
  readonly validate: (migrated: UnitSnapshot) => Promise<{ readonly ok: boolean; readonly digest: string }>
  /** Answers whether the plugin works on the switched-in data (must[1]'s last phase). */
  readonly healthCheck: () => Promise<boolean>
  /** Writes the upgrade record durably; the caller owns where it lives. */
  readonly writeRecord: (record: UpgradeRecord) => Promise<void>
  /**
   * Called as each phase completes, before the next begins.
   *
   * Exists so acceptance[0]'s campaign can kill the process at a NAMED phase.
   * A test that threw instead would unwind to the caller's own teardown, which
   * is the error path — the crash path is the one where nothing runs
   * afterwards.
   */
  readonly onPhase?: (phase: UpgradePhase) => void
}

/** How one upgrade ended, and how far it got. */
export type UpgradeOutcome =
  | { readonly upgraded: true; readonly digest: string }
  | { readonly upgraded: false; readonly failedAt: UpgradePhase; readonly refusal?: MigrationRefusal }

/**
 * Run one plugin upgrade as the six-phase transaction (must[1]).
 *
 * Every phase leaves an observable state, and the order is chosen so each
 * intermediate one is resolvable by a restart: the migration runs against a
 * COPY while the live unit stays readable, and the switch keeps the state it
 * replaced as the rollback target until the health check passes.
 *
 * The lease is RENEWED between phases, because a migration can outlast a lease
 * TTL and a lapsed holder is a superseded one. Before the switch — the only
 * step that changes what a reader sees — the holder proves it still holds the
 * lease; a superseded holder refuses to swap and leaves the live unit alone.
 * That check is the whole reason this uses a fencing lease rather than a
 * lockfile, which can say "someone holds it" but not "you no longer do".
 * @param request - the plugin, its unit, the migration facet, the lease and
 *   the caller-owned migrate, validate and health-check operations.
 * @returns the outcome, naming the phase that failed when one did.
 */
export async function runUpgrade(request: UpgradeRequest): Promise<UpgradeOutcome> {
  const plan = planUpgrade(request.manifest, request.installed)
  if (!plan.admitted) return { upgraded: false, failedAt: 'freeze', refusal: plan.refusal }
  const facet = request.migration
  if (facet === undefined) {
    return {
      upgraded: false,
      failedAt: 'freeze',
      refusal: { kind: 'backend-cannot-migrate', plugin: request.plugin },
    }
  }

  // freeze: the lease is already held — taken before the package manager ran,
  // so at this point the code has not moved either.
  request.onPhase?.('freeze')

  const record: UpgradeRecord = {
    plugin: request.plugin,
    from: request.installed,
    to: request.manifest.current,
    pathDigest: computeMigrationPathDigest(request.plugin, plan.steps),
  }
  await request.writeRecord(record)

  const snapshot = await facet.snapshotUnit(request.unit)
  await request.writeRecord({ ...record, snapshotHandle: snapshot.handle })
  request.onPhase?.('snapshot')

  let migrated: UnitSnapshot | undefined
  try {
    migrated = await facet.materializeMigrated(snapshot, Number(request.manifest.current), request.migrate)
    request.onPhase?.('quarantine')

    // Renewed here because the migration is the long phase: a lease that
    // lapsed during it has already been reclaimable by another process.
    if (request.lease.renew(request.now()) !== undefined) {
      await facet.discard(migrated)
      return { upgraded: false, failedAt: 'quarantine' }
    }

    const validated = await request.validate(migrated)
    if (!validated.ok) {
      await facet.discard(migrated)
      return { upgraded: false, failedAt: 'validate' }
    }
    request.onPhase?.('validate')

    // The fencing check, immediately before the only step that changes what a
    // reader sees. A holder superseded while the migration ran must not swap:
    // another process owns this work item now and may already have acted.
    if (!request.lease.mayWrite(request.now())) {
      await facet.discard(migrated)
      return { upgraded: false, failedAt: 'switch' }
    }

    const previous = await facet.switchIn(migrated)
    migrated = undefined
    // Recorded BEFORE the health check: a crash between the switch and the
    // check must leave a recovery able to find what to roll back to, and the
    // handle is the only thing that names it without knowing the medium.
    await request.writeRecord({ ...record, snapshotHandle: snapshot.handle, previousHandle: previous.handle })
    request.onPhase?.('switch')

    if (!await request.healthCheck()) {
      await facet.rollbackTo(previous)
      return { upgraded: false, failedAt: 'health-check' }
    }

    // acceptance[1]: the achieved half is written only NOW. Written earlier it
    // would survive a crash as a record claiming an upgrade that did not
    // finish, and a later reconcile would compare the medium against a version
    // it never reached.
    await request.writeRecord({
      ...record,
      snapshotHandle: snapshot.handle,
      previousHandle: previous.handle,
      upgradedTo: request.manifest.current,
      dataDigest: validated.digest,
    })
    await facet.discard(snapshot)
    request.onPhase?.('health-check')
    return { upgraded: true, digest: validated.digest }
  } catch (failure) {
    // A migrated copy that was never switched in is the transaction's to
    // clean up; one that was is the rollback target and must survive.
    if (migrated !== undefined) await facet.discard(migrated)
    throw failure
  }
}

/**
 * Finish undoing an upgrade a crash left half-done (acceptance[0]).
 *
 * Lives here rather than in the CLI because it is transaction semantics: what
 * a half-done upgrade means, and what undoing it requires, is this module's
 * knowledge. A consumer that did it would have to know which handles a backend
 * keeps and in what order to release them, which is the coupling the medium
 * correction removed.
 *
 * The rule is the one the record's halves already encode: intent with no
 * achievement means the upgrade did not finish. If the switch had happened the
 * replaced state goes back; either way the snapshot is released and the record
 * is cleared, so the next upgrade does not start on the last one's leftovers.
 * @param facet - the backend's migration facet.
 * @param record - the record the interrupted upgrade left.
 * @returns whether anything was undone.
 */
export async function recoverUpgrade(
  facet: MigrationFacet,
  record: UpgradeRecord,
): Promise<boolean> {
  if (record.upgradedTo !== undefined) return false
  if (record.previousHandle !== undefined) {
    await facet.rollbackTo({ unit: record.plugin, handle: record.previousHandle })
  }
  if (record.snapshotHandle !== undefined) {
    await facet.discard({ unit: record.plugin, handle: record.snapshotHandle })
  }
  return true
}
