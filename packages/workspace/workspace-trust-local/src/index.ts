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
 * the first time it was read. Every later read re-observes and reconciles, so a
 * directory replaced in place, a symlink retargeted, or a directory moved out
 * from under its path all drop to `'untrusted'` and are never re-granted from
 * configuration: a grant is permission to trust one directory, not standing
 * permission to trust whatever later occupies its path (acceptance[1]).
 *
 * @module @deepseek-ai/dsh-workspace-trust-local
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { observeWorkspaceIdentity, realpathNormalize } from '@deepseek-ai/dsh-workspace'
import {
  bindWorkspaceTrust,
  reconcileWorkspaceTrust,
  type WorkspaceTrustService,
} from '@deepseek-ai/dsh-workspace-trust'
import type { TrustRecord, TrustState, WorkspaceIdentity } from '@deepseek-ai/dsh-workspace-trust/types'

/** Plugin name under which this provider mounts. */
export const name = 'workspace-trust-local'

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
  /** Canonical path to the record currently bound for it. */
  private readonly records = new Map<string, TrustRecord>()
  /** Resolved once and reused: see {@link canonicalGrants}. */
  private canonicalGrantsOnce?: Promise<Map<string, TrustState>>

  /**
   * @param grants - the operator's configured trust grants.
   */
  constructor(grants: readonly TrustGrant[]) {
    this.grants = new Map(grants.map(grant => [grant.path, grant.state]))
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
  private async canonicalGrants(): Promise<Map<string, TrustState>> {
    this.canonicalGrantsOnce ??= (async () => {
      const canonical = new Map<string, TrustState>()
      for (const [path, state] of this.grants) {
        canonical.set(await realpathNormalize(path).catch(() => path), state)
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
    const existing = this.records.get(observed.canonicalPath)
    if (existing !== undefined) {
      const reconciled = reconcileWorkspaceTrust(existing, observed, at)
      this.records.set(observed.canonicalPath, reconciled)
      return reconciled.state
    }
    const granted = (await this.canonicalGrants()).get(observed.canonicalPath)
    // A grant is consulted only at first binding. Once a record exists it is
    // reconciled above and never re-reads configuration, so a directory that
    // lost trust to a swap cannot regain it by still matching a granted path.
    const record: TrustRecord = granted === undefined || granted === 'untrusted'
      ? bindWorkspaceTrust(observed, at)
      : { identity: observed, state: granted, at }
    this.records.set(observed.canonicalPath, record)
    return record.state
  }
}

/**
 * Mount the host-local workspace trust provider.
 * @param ctx - the context to provide `workspaceTrust` on.
 * @param config - the operator's trust grants.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('workspaceTrust', new LocalWorkspaceTrust(config.grants ?? []))
}
