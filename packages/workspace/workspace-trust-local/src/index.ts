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
   * @param ctx - the mounting context, whose `storageDomain` holds the records.
   * @param grants - the operator's configured trust grants.
   */
  constructor(private readonly ctx: Context, grants: readonly TrustGrant[]) {
    this.grants = new Map(grants.map(grant => [grant.path, grant.state]))
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
    const observed = await observeWorkspaceIdentity(cwd)
    const at = new Date().toISOString()
    const { records } = await this.tables()
    const stored = records.get(observed.canonicalPath)
    const current = stored === undefined
      ? bindWorkspaceTrust(observed, at)
      : reconcileWorkspaceTrust(stored, observed, at)
    const result = requestTrustUpgrade(current, target, hostPrincipal, at, source)
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
