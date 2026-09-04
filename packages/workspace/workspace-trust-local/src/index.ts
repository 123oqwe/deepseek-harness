/**
 * Host-local Service Provider for the workspace trust capability
 * (`ctx.workspaceTrust`), the seam Epic P1-07's Consumers read before they load
 * anything a project directory supplies.
 *
 * `@deepseek-ai/dsh-workspace-trust` owns every decision and
 * `@deepseek-ai/dsh-workspace`'s `observeWorkspaceIdentity` owns every real
 * filesystem observation; this package only binds the two together for a
 * session `cwd` and holds the resulting {@link TrustRecord} for the process
 * lifetime. It adds no third decision table.
 *
 * A grant names a path, but trust binds to the identity that path resolved to
 * the first time it was observed. Every later read re-observes and runs
 * `reconcileWorkspaceTrust`, so a directory replaced in place, a symlink
 * retargeted, or a directory moved out from under its path all drop to
 * `'untrusted'` and are NOT re-granted from configuration — a grant is
 * permission to trust one directory, not standing permission to trust whatever
 * later occupies its path (acceptance[1]).
 *
 * @module @deepseek-ai/dsh-workspace-trust-local
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TrustState } from '@deepseek-ai/dsh-workspace-trust/types'

/** Plugin name under which this provider mounts. */
export const name = 'workspace-trust-local'

/** One operator-configured trust grant for a workspace path. */
export interface TrustGrant {
  /** Path of the workspace this grant applies to; canonicalized before use. */
  path: string
  /** The state that path is granted, bound to the identity observed on first read. */
  state: TrustState
}

/** Host-local workspace trust provider configuration. */
export interface Config {
  /**
   * Workspace paths this host grants a state above `'untrusted'`, standing in
   * for must[2]'s host-user interaction until an interactive upgrade exists.
   * A path absent here resolves to `'untrusted'`.
   */
  grants?: TrustGrant[]
}

/**
 * Mount the host-local workspace trust provider.
 * @param ctx - the context to provide `workspaceTrust` on.
 * @param config - the operator's trust grants.
 */
export function apply(_ctx: Context, _config: Config): void {
  throw new Error('not implemented: workspace-trust-local does not yet provide ctx.workspaceTrust')
}
