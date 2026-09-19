/**
 * Host-local Service Provider for the workspace trust capability
 * (`ctx.workspaceTrust`), the seam Epic P1-07's Consumers read before they load
 * anything a project directory supplied.
 *
 * `@deepseek-ai/dsh-workspace-trust` owns every decision and
 * `@deepseek-ai/dsh-workspace`'s `observeWorkspaceIdentity` owns every real
 * filesystem observation; this package binds the two together for a session
 * `cwd` and holds the resulting `TrustRecord` for the process lifetime. It adds
 * no second decision table.
 *
 * A grant names a path, but trust binds to the identity that path resolved to
 * the first time it was read, and that binding is DURABLE. Every later read —
 * in this process or a later one — re-observes and reconciles against the
 * stored identity, so a directory replaced in place, a symlink retargeted, or
 * a directory moved out from under its path all drop to `'untrusted'` and are
 * never re-granted from configuration: a grant is permission to trust one
 * directory, not standing permission to trust whatever later occupies its path
 * (acceptance[1]).
 *
 * The durability is the load-bearing half and it was missing. While the
 * binding lived only in memory this paragraph was true within one process and
 * false across a restart, which is the whole of BLOCKED-199: a second process
 * re-read the grants and re-trusted whatever then stood at the granted path.
 *
 * @module @deepseek-ai/dsh-workspace-trust-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Principal } from '@deepseek-ai/dsh-principal/types'
import z from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { observeWorkspaceIdentity, realpathNormalize } from '@deepseek-ai/dsh-workspace'
import {
  bindWorkspaceTrust,
  downgradeTrust,
  reconcileWorkspaceTrust,
  requestTrustUpgrade,
  type WorkspaceTrustService,
} from '@deepseek-ai/dsh-workspace-trust'
// The `cmdlineArgs` and `appReady` slots are declared by the cmdline
// package's Context augmentation; nothing else here needs it.
import type {} from '@deepseek-ai/dsh-cmdline'
import { LAUNCH_TRUST_FLAG } from '@deepseek-ai/dsh-workspace-trust/types'
import type {
  TrustDowngradeResult,
  TrustGrantSource,
  TrustRecord,
  TrustState,
  TrustUpgradeResult,
  WorkspaceIdentity,
} from '@deepseek-ai/dsh-workspace-trust/types'
import { workspaceTrustDomainSpec } from './spec.ts'
import type { StoredConsumedGrant } from './spec.ts'

/**
 * When this process began, as an ISO-8601 instant.
 *
 * Module scope and not `Service.init`: the rule it serves — a launch argument
 * must not resurrect trust a human lowered — exists precisely for the case
 * where this provider is REPLACED, and a value taken at mount would be reset
 * by the very reload it is meant to survive. A module instance is created once
 * per process, and `performance.timeOrigin` is fixed at process start, so this
 * is the same instant for every mount in this process.
 */
const PROCESS_STARTED_AT_UTC = new Date(performance.timeOrigin).toISOString()

/** The two durable tables this provider reads, opened together. */
interface TrustTables {
  /** One record per canonical workspace path. */
  readonly records: KvTable<string, TrustRecord>
  /** One marker per grant already spent, keyed by its configured spelling. */
  readonly consumedGrants: KvTable<string, StoredConsumedGrant>
}

/** Plugin name under which this provider mounts. */
export const name = 'workspace-trust-local'

/** The durable record table lives in a storage domain, so the trust binding outlives the process. */
export const inject = ['storageDomain']

/** One operator-configured trust grant for a workspace path. */
export interface TrustGrant {
  /** Path of the workspace this grant applies to; canonicalized before it is matched. */
  path: string
  /** The state that path is granted, bound to the identity observed the first time it is read. */
  state: TrustState
}

/** Host-local workspace trust provider configuration. */
export interface Config {
  /**
   * Workspace paths this host grants a state above `'untrusted'`, standing in
   * for must[2]'s host-user interaction until an interactive upgrade exists. A
   * path absent here resolves to `'untrusted'`.
   */
  grants?: TrustGrant[]
}

export const Config: z<Config> = z.object({
  grants: z.array(z.object({
    path: z.string().required(),
    state: z.union([
      z.const('untrusted' as const),
      z.const('trusted-read' as const),
      z.const('trusted-execute' as const),
    ]).required(),
  })).default([]),
})

/**
 * Resolves trust for real directories: binds each workspace to the identity it
 * first resolved to, and reconciles every later read against a fresh
 * observation.
 */
class LocalWorkspaceTrust implements WorkspaceTrustService {
  /** Configured path spelling to the state the operator granted it. */
  private readonly grants: ReadonlyMap<string, TrustState>
  /** Resolved once and reused: see {@link canonicalGrants}. */
  private canonicalGrantsOnce?: Promise<Map<string, { canonicalPath: string; state: TrustState }>>
  /** Opened once and reused; see {@link tables}. */
  private tablesOnce?: Promise<TrustTables>

  /**
   * Held while a launch-time trust request may still be unwritten, and
   * `undefined` when this startup carries none.
   *
   * **Armed here rather than registered later, and that is the whole point.**
   * A reader asks this provider, so the provider is the only place a barrier
   * covers every reader — project instructions, the policy facts a tool call
   * assembles, the skill catalog a client can ask for before any turn, and the
   * in-session command. Registering it from the entry point that writes the
   * record would arm it one microtask after this service publishes (measured:
   * an `inject` callback runs after the publishing segment, before the next
   * microtask completes), leaving a window where a read could pass unheld.
   */
  // `| undefined` rather than `?`: this field is CLEARED when the barrier is
  // released, and under `exactOptionalPropertyTypes` an optional property
  // cannot be assigned `undefined` -- only omitted. The two spellings differ
  // exactly here, and "present and empty" is what a released barrier is.
  private launchBarrier: Promise<void> | undefined
  /** Releases {@link launchBarrier}. */
  private releaseBarrier: () => void = () => {}
  /**
   * How many writes have claimed the barrier and not yet settled.
   *
   * Startup finishing is the upper bound for a request nobody claimed — but
   * only for that case. The measured order on a shipped profile is that this
   * provider publishes LATE, so the write is normally still in flight when
   * readiness fires; releasing then would hand every reader the state from
   * before the grant, which is the hole the barrier exists to close.
   */
  private launchWritesInFlight = 0

  /**
   * @param ctx - the mounting context, whose `storageDomain` holds the records.
   * @param grants - the operator's configured trust grants.
   */
  constructor(private readonly ctx: Context, grants: readonly TrustGrant[]) {
    this.grants = new Map(grants.map(grant => [grant.path, grant.state]))
    this.armLaunchBarrier()
  }

  /**
   * Hold reads if this startup's command line carries a trust request.
   *
   * The test is a literal one over the launcher's own arguments, not a parse:
   * the flag's grammar belongs to `@deepseek-ai/dsh-command-workspace-trust`,
   * and all this needs to know is whether someone is about to write a record.
   *
   * Two conditions, and both bound the wait. A launcher with no `appReady`
   * signal is not armed at all, because nothing could then tell this provider
   * that startup finished — and that is also the composition where the entry
   * point refuses the request outright. With a signal, readiness releases the
   * barrier whatever happened, so a request nobody claims costs one startup's
   * delay and never a hang.
   * @returns Nothing.
   */
  private armLaunchBarrier(): void {
    const args = this.ctx.get('cmdlineArgs')?.get() ?? []
    if (!args.some(arg => arg === LAUNCH_TRUST_FLAG || arg.startsWith(`${LAUNCH_TRUST_FLAG}=`))) return
    const ready = this.ctx.get('appReady')
    if (ready === undefined) return
    this.launchBarrier = new Promise<void>((resolve) => {
      this.releaseBarrier = () => {
        this.launchBarrier = undefined
        resolve()
      }
    })
    // Startup finishing releases a barrier NOBODY claimed. A write already
    // under way keeps it: the write's own completion is what releases it then.
    this.ctx.effect(() => ready.onReady(() => {
      if (this.launchWritesInFlight === 0) this.releaseBarrier()
    }))
  }

  /**
   * Hold the barrier for one write that is about to happen, and release it
   * when that write settles.
   *
   * The provider claims its own barrier because it can see what a claim is:
   * every write passes through this service, so nothing outside it has to be
   * trusted to report one — and a caller that could report one could also
   * withhold the report.
   * @param write - the write to run while the barrier is held.
   * @returns whatever the write returned.
   */
  private async whileHoldingBarrier<T>(write: () => Promise<T>): Promise<T> {
    if (this.launchBarrier === undefined) return write()
    this.launchWritesInFlight += 1
    try {
      return await write()
    } finally {
      this.launchWritesInFlight -= 1
      // However it ended, and whatever it was: a write that failed must not
      // leave readers waiting, and the state they then read is the stored one.
      if (this.launchWritesInFlight === 0) this.releaseBarrier()
    }
  }

  /**
   * The durable record table, opened on first use.
   *
   * Opened lazily rather than in `apply`, which is synchronous: a composition
   * that mounts this provider and never resolves a workspace should not pay
   * for a domain it does not read.
   * @returns the table of records keyed by canonical path.
   */
  private async tables(): Promise<TrustTables> {
    // The one conversion between the stored row and the vocabulary's record.
    // They are the same shape; what the schema cannot express is `grantedBy`'s
    // brand and the difference `exactOptionalPropertyTypes` draws between an
    // absent optional and one set to `undefined`. Converting at the handle
    // rather than declaring the schema as `TrustRecord` keeps the schema
    // honest about what it actually validates.
    this.tablesOnce ??= (async () => {
      const domain = await this.ctx.storageDomain.open(workspaceTrustDomainSpec)
      return {
        records: domain.table('records') as unknown as KvTable<string, TrustRecord>,
        consumedGrants: domain.table('consumed_grants'),
      }
    })()
    return await this.tablesOnce
  }

  /**
   * Canonicalize each granted path so a grant written through a symlink or with
   * `..` segments still matches the canonical identity a Consumer resolves. A
   * grant naming a path that cannot be canonicalized keeps its configured
   * spelling and simply never matches an observation.
   *
   * Resolved exactly once and reused for the process lifetime. Re-resolving per
   * call would make the grant follow its own path rather than name a directory:
   * retargeting a granted symlink would canonicalize the grant onto the
   * attacker's directory, which then matches as a first binding and is trusted —
   * the precise inheritance acceptance[1] forbids, and a real failure this
   * package's own symlink-retarget case caught.
   * @returns the granted states keyed by the canonical path each named when first resolved.
   */
  private async canonicalGrants(): Promise<Map<string, { canonicalPath: string; state: TrustState }>> {
    this.canonicalGrantsOnce ??= (async () => {
      const canonical = new Map<string, { canonicalPath: string; state: TrustState }>()
      for (const [path, state] of this.grants) {
        canonical.set(path, { canonicalPath: await realpathNormalize(path).catch(() => path), state })
      }
      return canonical
    })()
    return await this.canonicalGrantsOnce
  }

  /**
   * Resolve the trust state bound to `cwd` against a fresh identity observation.
   * @param cwd - the session working directory to resolve trust for.
   * @returns the workspace's current trust state.
   */
  async stateFor(cwd: string): Promise<TrustState> {
    // Every reader passes here, which is why the barrier lives here. It is
    // released on success, on failure and at readiness, so a read is delayed
    // by one startup at most and never denied: a write that failed leaves the
    // stored state, which for an ungranted workspace is `'untrusted'`.
    if (this.launchBarrier !== undefined) await this.launchBarrier
    let observed: WorkspaceIdentity
    try {
      observed = await observeWorkspaceIdentity(cwd)
    } catch {
      // A path that cannot be observed cannot be confirmed as the directory any
      // grant was bound to, so it gets what a stranger gets.
      return 'untrusted'
    }
    const at = new Date().toISOString()
    const { records, consumedGrants } = await this.tables()
    const existing = records.get(observed.canonicalPath)
    if (existing !== undefined) {
      const reconciled = reconcileWorkspaceTrust(existing, observed, at)
      await records.put(observed.canonicalPath, reconciled)
      return reconciled.state
    }
    // A grant is consumed ONCE. Two durable facts are what make that true
    // across a restart, and each covers a case the other does not
    // (BLOCKED-199): the RECORD stops a directory that lost trust to a swap
    // from regaining it at the same canonical path, and the CONSUMED MARKER
    // stops a grant from being resolved a second time at all -- which is the
    // only thing that stops a retargeted symlink, because the attacker's
    // directory is a canonical path with no record of its own and would
    // otherwise bind as a first binding.
    const grant = await this.unspentGrantFor(observed.canonicalPath, consumedGrants)
    const record: TrustRecord = grant === undefined || grant.state === 'untrusted'
      ? bindWorkspaceTrust(observed, at)
      : { identity: observed, state: grant.state, at }
    await records.put(observed.canonicalPath, record)
    if (grant !== undefined) await consumedGrants.put(grant.configuredPath, { canonicalPath: observed.canonicalPath, at })
    return record.state
  }

  /**
   * Raise this workspace's trust on the host user's authority.
   *
   * The decision is `requestTrustUpgrade`'s — this method observes, reads the
   * record the decision needs as its starting point, and persists the result.
   * It does not ask: the Consumer that put the question to the host user is
   * the one that knows an answer was given, and a provider that asked would be
   * a second place where trust can be granted.
   *
   * Reconciled first, so a directory that lost its binding to a swap cannot be
   * raised from the state it no longer has.
   * @param cwd - the session working directory whose workspace is being raised.
   * @param target - the state to raise it to.
   * @param hostPrincipal - the principal authorizing it.
   * @returns the upgrade result; the new binding is persisted only on success.
   */
  async grantTrust(
    cwd: string,
    target: TrustState,
    hostPrincipal: Principal,
    source: TrustGrantSource = 'command',
  ): Promise<TrustUpgradeResult> {
    return this.whileHoldingBarrier(() => this.writeGrant(cwd, target, hostPrincipal, source))
  }

  /**
   * The grant itself, with the barrier bookkeeping left to its caller.
   * @param cwd - the session working directory whose workspace is being raised.
   * @param target - the state to raise it to.
   * @param hostPrincipal - the principal authorizing it.
   * @param source - the entry point the grant is written through.
   * @returns the upgrade result; the new binding is persisted only on success.
   */
  private async writeGrant(
    cwd: string,
    target: TrustState,
    hostPrincipal: Principal,
    source: TrustGrantSource,
  ): Promise<TrustUpgradeResult> {
    const observed = await observeWorkspaceIdentity(cwd)
    const at = new Date().toISOString()
    const { records } = await this.tables()
    const stored = records.get(observed.canonicalPath)
    const current = stored === undefined
      ? bindWorkspaceTrust(observed, at)
      : reconcileWorkspaceTrust(stored, observed, at)
    const result = requestTrustUpgrade(current, target, hostPrincipal, at, source, PROCESS_STARTED_AT_UTC)
    await records.put(observed.canonicalPath, result.upgraded ? result.record : current)
    if (result.upgraded) this.auditTrustChange(result.record, current.state, 'granted')
    return result
  }

  /**
   * Lower this workspace's trust and persist the result (acceptance[2],
   * BLOCKED-214).
   *
   * Reconciled first for the same reason `grantTrust` reconciles: a directory
   * that lost its binding to a swap is lowered from the state it actually has.
   * The revocation set comes from `downgradeTrust`, computed against the very
   * transition being applied.
   * @param cwd - the session working directory whose workspace is being lowered.
   * @param target - the state to lower it to.
   * @returns the downgrade result and the project content kinds it revoked.
   */
  async revokeTrust(cwd: string, target: TrustState): Promise<TrustDowngradeResult> {
    return this.whileHoldingBarrier(() => this.writeRevocation(cwd, target))
  }

  /**
   * The revocation itself, with the barrier bookkeeping left to its caller.
   *
   * A revocation claims the barrier too, and deliberately: `revokeTrust`
   * carries no source, so this provider cannot tell a launch-time
   * `--trust-workspace=none` from an in-session one — and either way what is
   * landing is a decision about this workspace, which is what a reader waiting
   * on the barrier is waiting for.
   * @param cwd - the session working directory whose workspace is being lowered.
   * @param target - the state to lower it to.
   * @returns the downgrade result and the project content kinds it revoked.
   */
  private async writeRevocation(cwd: string, target: TrustState): Promise<TrustDowngradeResult> {
    const observed = await observeWorkspaceIdentity(cwd)
    const at = new Date().toISOString()
    const { records } = await this.tables()
    const stored = records.get(observed.canonicalPath)
    const current = stored === undefined
      ? bindWorkspaceTrust(observed, at)
      : reconcileWorkspaceTrust(stored, observed, at)
    const result = downgradeTrust(current, target, at)
    await records.put(observed.canonicalPath, result.record)
    this.auditTrustChange(result.record, current.state, 'revoked')
    return result
  }

  /**
   * Append one trust transition to the Trust Kernel's audit (BLOCKED-214).
   *
   * A persisted grant outlives every session that could have logged it, so the
   * session log is the wrong home: an operator asking "when did this workspace
   * become trusted, and through what" is asking about the host, not about one
   * conversation. The kernel's audit is the one append-only record that spans
   * both.
   *
   * Never throws: a composition that pins no kernel still enforces trust, and a
   * failure to RECORD a transition must not prevent the transition the host
   * user asked for. The record is already persisted by the time this runs.
   * @param record - the record as persisted after the transition.
   * @param fromState - the state the workspace held before it.
   * @param transition - whether trust was raised or lowered.
   */
  private auditTrustChange(record: TrustRecord, fromState: TrustState, transition: 'granted' | 'revoked'): void {
    // Typed at the read: `trustKernel` is an optional service this package does
    // not inject, so `ctx.get` hands back a value the compiler cannot narrow.
    const kernel = this.ctx.get('trustKernel') as { auditAppend: (entry: { payload: unknown }) => void } | undefined
    if (kernel === undefined) return
    kernel.auditAppend({
      payload: {
        kind: 'workspace-trust',
        transition,
        canonicalPath: record.identity.canonicalPath,
        // The identity, not only the path: two directories can occupy one path
        // over time, and an audit that recorded only the path could not tell
        // a re-grant from a grant to a different directory.
        volume: record.identity.volume,
        fromState,
        toState: record.state,
        at: record.at,
        ...record.grantedBy === undefined ? {} : { grantedBy: record.grantedBy },
        ...record.source === undefined ? {} : { source: record.source },
      },
    })
  }

  /**
   * The grant that applies to `canonicalPath` and has not been spent yet.
   *
   * A grant is matched by the canonical path it resolves to now, and refused
   * if its configured spelling was already spent — on any directory. Spending
   * is per CONFIGURED path rather than per canonical one precisely because the
   * attack this closes moves the canonical path: a symlink retargeted between
   * runs resolves the same configured spelling onto a new directory.
   * @param canonicalPath - the canonical path observed for this read.
   * @param consumedGrants - the marker table.
   * @returns the applicable unspent grant, or undefined.
   */
  private async unspentGrantFor(
    canonicalPath: string,
    consumedGrants: KvTable<string, StoredConsumedGrant>,
  ): Promise<{ configuredPath: string; state: TrustState } | undefined> {
    for (const [configuredPath, resolved] of await this.canonicalGrants()) {
      if (resolved.canonicalPath !== canonicalPath) continue
      if (consumedGrants.get(configuredPath) !== undefined) continue
      return { configuredPath, state: resolved.state }
    }
    return undefined
  }
}

/**
 * Mount the host-local workspace trust provider.
 * @param ctx - the context to provide `workspaceTrust` on.
 * @param config - the operator's trust grants.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('workspaceTrust', new LocalWorkspaceTrust(ctx, config.grants ?? []))
}
