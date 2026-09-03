/**
 * Package entry point. Contract-stage RED scaffold for Epic P1-07's project
 * trust boundary: this module's exported decision functions have real,
 * epic-accurate signatures but placeholder bodies (`'not implemented'`) —
 * the pure decision logic itself is this epic's Contract-stage deliverable
 * to a later fix-round, not this scaffold's. `isHostUserPrincipal` is the
 * one exception: a one-line predicate directly grounded in must[2]'s "宿主
 * 用户交互" (host USER interaction) text — distinguishing a genuine
 * `UserPrincipal` from `@deepseek-ai/dsh-principal`'s `'service'`/`'agent'`/
 * `'anonymous-dev'` principal kinds — not itself the fail-closed adjudication
 * `requestTrustUpgrade` performs.
 *
 * None of these functions read a file, spawn a process, stat a path, or
 * construct a Cordis `Context` — every `WorkspaceIdentity`,
 * `TrustRecord`, and `Principal` input is a plain value the caller already
 * resolved, matching this repo's pure-function Contract-stage convention
 * (see `@deepseek-ai/dsh-plugin-ownership`). Usage-stage wires
 * `bindWorkspaceTrust`/`authorizeProjectLoad`/`reconcileWorkspaceTrust` into
 * `packages/workspace/workspace/src/{entity,index,paths}.ts` (real
 * `fs.stat`/`fs.realpath` observation) and
 * `packages/context/agent-instructions/src/{index,files}.ts` /
 * `apps/cli/src/profile-boot.ts` (real project plugin/hook/MCP-server/skill/
 * patch-override load sites) — none of those files are this stage's job.
 *
 * @module @deepseek-ai/dsh-workspace-trust
 */
export type * from './types.ts'

import type { Principal } from '@deepseek-ai/dsh-principal/types'
import type {
  LoadDecision,
  ProjectContentKind,
  TrustDowngradeResult,
  TrustRecord,
  TrustState,
  TrustUpgradeResult,
  WorkspaceIdentity,
} from './types.ts'

/**
 * must[2]'s "宿主用户交互" (host USER interaction) predicate: `true` only for
 * a `Principal` whose `kind` is `'user'`. Does not by itself decide whether
 * an upgrade succeeds — `requestTrustUpgrade` combines this with the
 * requested {@link TrustState} transition and produces the must[2] audit
 * record; a `'service'`, `'agent'`, or `'anonymous-dev'` principal can never
 * satisfy a trust upgrade regardless of any other field it carries.
 * @param principal - the principal presented as the upgrade requester.
 * @returns `true` when `principal.kind` is `'user'`.
 */
export function isHostUserPrincipal(principal: Principal): boolean {
  return principal.kind === 'user'
}

/**
 * must[0]'s binding entry point: seed a fresh {@link TrustRecord} for
 * `identity` at `'untrusted'` (validation's "headless profile 无交互时默认
 * 不信任" — a workspace never starts above `'untrusted'`; only
 * `requestTrustUpgrade` may raise it). `grantedBy` is absent on the returned
 * record — no upgrade has happened yet to attribute one.
 * @param identity - the canonical-realpath-plus-inode/volume binding to seed trust for.
 * @param at - ISO-8601 instant of binding.
 * @returns a fresh `'untrusted'` {@link TrustRecord} for `identity`.
 */
export function bindWorkspaceTrust(identity: WorkspaceIdentity, at: string): TrustRecord {
  throw new Error(`not implemented: bindWorkspaceTrust(${identity.canonicalPath}, ${at})`)
}

/**
 * must[1]/acceptance[0]'s load-gate entry point: decide whether `kind` may
 * load under `state`. `'safe-read'` is permitted at every state;
 * `'trusted-read'` never admits any other kind (reading is not executing);
 * only `'trusted-execute'` admits a project plugin, hook, MCP server,
 * executable skill, or home/profile patch override. Refusing every kind
 * other than `'safe-read'` while `state` is `'untrusted'` or `'trusted-read'`
 * is what makes acceptance[0]'s "clone and open a malicious repo produces
 * zero subprocess/network/credential-read activity" hold: none of those
 * activities has a load site this function admits before `'trusted-execute'`.
 * @param state - the workspace's current {@link TrustState}.
 * @param kind - the {@link ProjectContentKind} a caller wants to load.
 * @returns `{ permitted: true }`, or `{ permitted: false, reason, requiredState }` naming the minimum state that would admit `kind`.
 */
export function authorizeProjectLoad(state: TrustState, kind: ProjectContentKind): LoadDecision {
  throw new Error(`not implemented: authorizeProjectLoad(${state}, ${kind})`)
}

/**
 * acceptance[1]'s continuity check: re-validate `record` against a freshly
 * observed {@link WorkspaceIdentity}. When `observed` matches
 * `record.identity` on every field (canonical path, device, and inode),
 * `record` is returned unchanged; any mismatch — a directory replaced in
 * place (same path, different device/inode), a symlink retargeted (path
 * changes), or the directory moved (path changes even though device/inode
 * are preserved) — demotes the returned record to `'untrusted'`, bound to
 * `observed` (not the stale identity), with no `grantedBy`. Trust never
 * survives a change this function was not asked to re-validate against: a
 * caller that skips calling this after re-resolving a workspace path is
 * exactly the auto-inheritance acceptance[1] forbids.
 * @param record - the previously bound {@link TrustRecord}.
 * @param observed - the {@link WorkspaceIdentity} just freshly observed for the same nominal workspace.
 * @param at - ISO-8601 instant of this reconciliation.
 * @returns `record` unchanged when `observed` matches `record.identity`; otherwise a demoted `'untrusted'` record bound to `observed`.
 */
export function reconcileWorkspaceTrust(record: TrustRecord, observed: WorkspaceIdentity, at: string): TrustRecord {
  throw new Error(`not implemented: reconcileWorkspaceTrust(${record.identity.canonicalPath}, ${observed.canonicalPath}, ${at})`)
}

/**
 * must[2]'s upgrade entry point: raise `current` to `target`, gated on
 * `hostPrincipal` being a genuine host user ({@link isHostUserPrincipal}).
 * Refuses with `'non-host-principal'` and produces neither a new record nor
 * an audit entry when `hostPrincipal.kind` is not `'user'` — a service,
 * agent, or anonymous-dev principal can never author a trust upgrade,
 * regardless of `target`. On success, returns both the new {@link TrustRecord}
 * (bound to `current.identity`, `grantedBy` set to `hostPrincipal.id`) and
 * the `TrustUpgradeAuditRecord` (`./types.ts`) must[2] requires be written.
 * @param current - the workspace's current {@link TrustRecord}.
 * @param target - the requested {@link TrustState} to upgrade to.
 * @param hostPrincipal - the principal presented as the upgrade requester.
 * @param at - ISO-8601 instant of the upgrade attempt.
 * @returns `{ upgraded: true, record, audit }`, or `{ upgraded: false, reason }`.
 */
export function requestTrustUpgrade(
  current: TrustRecord,
  target: TrustState,
  hostPrincipal: Principal,
  at: string,
): TrustUpgradeResult {
  throw new Error(
    `not implemented: requestTrustUpgrade(${current.state} -> ${target}, isHostUser=${String(isHostUserPrincipal(hostPrincipal))}, ${at})`,
  )
}

/**
 * acceptance[2]'s downgrade entry point: lower `current` to `target` and
 * name exactly the {@link ProjectContentKind}s this downgrade revokes —
 * every kind `authorizeProjectLoad` permitted under `current.state` but no
 * longer permits under `target`. "立即撤销项目能力" (immediately revokes
 * project capabilities) means the returned record already reflects `target`
 * and `revokedKinds` is computed against that same transition — no separate
 * revoke step a caller could race or skip.
 * @param current - the workspace's current {@link TrustRecord}.
 * @param target - the {@link TrustState} to downgrade to.
 * @param at - ISO-8601 instant of the downgrade.
 * @returns the demoted {@link TrustRecord} together with the {@link ProjectContentKind}s it revokes.
 */
export function downgradeTrust(current: TrustRecord, target: TrustState, at: string): TrustDowngradeResult {
  throw new Error(`not implemented: downgradeTrust(${current.state} -> ${target}, ${at})`)
}
