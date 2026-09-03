/**
 * Contract-stage type surface for Epic P1-07's project trust boundary: the
 * three workspace trust states and the canonical-realpath-plus-inode/volume
 * binding they carry (must[0]), the closed set of project-level executable
 * content kinds an untrusted workspace never loads (must[1]), and the
 * host-user-interaction-gated upgrade/downgrade decisions that keep trust
 * from silently surviving a directory swap, a symlink retarget, or a move
 * (must[2], acceptance[1], acceptance[2]).
 *
 * **Grounding.** `packages/workspace/workspace/src/types.ts`'s `Workspace.path`
 * is today a plain canonicalized `string` (the `fs.realpath` output — see
 * `packages/workspace/workspace/src/paths.ts`'s `realpathNormalize`) with no
 * trust concept and no binding beyond that string: a symlink retargeted to a
 * different directory, or the directory replaced in place, canonicalizes to
 * the same string today with nothing to notice the swap. This module is new
 * vocabulary this epic introduces, not an extension of an existing trust
 * type — `packages/workspace/workspace/src/{entity,index,paths}.ts` carry no
 * `TrustState` field to widen. {@link WorkspaceIdentity} closes that gap by
 * binding the canonical realpath from `realpathNormalize` to the
 * `fs.Stats.dev`/`fs.Stats.ino` pair an `fs.stat` call on the same path
 * reports (must[0]'s "inode/volume identity") — same-path-different-inode
 * catches a directory replaced or a symlink retargeted, and same-inode
 * either can be, but does not have to be, a different canonical path when
 * the directory itself moved.
 *
 * must[2]'s "宿主用户交互" (real host-user interaction) is modeled with
 * `@deepseek-ai/dsh-principal`'s already-ACCEPTED (first100 registry P2-01)
 * `Principal` union (`@deepseek-ai/dsh-principal/types`) rather than a redundant ad hoc identity shape:
 * only a `Principal` whose `kind` is `'user'` counts (see `./index.ts`'s
 * `isHostUserPrincipal`) — a `'service'`, `'agent'`, or `'anonymous-dev'`
 * principal never satisfies a trust upgrade, matching P2-01's own
 * "never infer identity from prompt text" discipline: an upgrade requester
 * is an already-branded `Principal`, never free text.
 *
 * must[2]'s "并写审计" (and writes an audit record) is modeled as this
 * package's own plain {@link TrustUpgradeAuditRecord} data, not
 * `@deepseek-ai/dsh-trust-kernel`'s `TrustKernelAuditEntry`/`TrustKernelAuditAppend`
 * (first100 registry P0-02, already ACCEPTED). This Contract stage commits
 * only to the shape a later `TrustKernelAuditEntry.payload` will carry, not
 * to a real append call: `docs/architecture/trust-kernel-boundary.md` and
 * this repo's own `AGENTS.md` both require the vendored Cordis `Fiber`
 * structural fix (Option A) to land BEFORE any epic wires a real
 * policy/audit/signature-verifier enforcement point consuming the Trust
 * Kernel, and must[2]'s audit write is exactly such an enforcement point —
 * that wiring is a later, Fiber-fix-gated stage's job, not this Contract
 * stage's.
 *
 * @module @deepseek-ai/dsh-workspace-trust/types
 */

import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'

/**
 * must[0]'s three workspace trust states, in ascending order of what a
 * workspace's project-level content may do: `'untrusted'` permits only safe
 * reads; `'trusted-read'` still never loads project-level executable content
 * (must[1] — reading is not executing); `'trusted-execute'` is the only
 * state `./index.ts`'s `authorizeProjectLoad` ever admits a project plugin,
 * hook, MCP server, executable skill, or home/profile patch override under.
 */
export type TrustState = 'untrusted' | 'trusted-read' | 'trusted-execute'

/**
 * The `fs.Stats.dev`/`fs.Stats.ino` pair Node's `fs.stat`/`fs.lstat` report
 * for a canonical path (must[0]'s "inode/volume identity"). `device` is the
 * volume identity; `inode` is the file/directory identity within that
 * volume. Two stats of the SAME directory always agree on both; a directory
 * replaced in place, or a symlink retargeted to a different directory on the
 * same volume, changes `inode` while `device` may stay fixed.
 */
export interface WorkspaceVolumeIdentity {
  /** The volume's device id (`fs.Stats.dev`). */
  readonly device: number
  /** The inode number within that volume (`fs.Stats.ino`). */
  readonly inode: number
}

/**
 * must[0]'s complete workspace binding: the canonical realpath
 * (`packages/workspace/workspace/src/paths.ts`'s `realpathNormalize` output)
 * together with the {@link WorkspaceVolumeIdentity} an `fs.stat` of that same
 * path reports at the moment of binding. Trust is bound to BOTH fields
 * together, never the path string alone (acceptance[1]'s directory-replaced
 * and symlink-retargeted attacks keep the path string fixed while changing
 * `volume`) and never the volume identity alone (acceptance[1]'s
 * directory-moved attack keeps `volume` fixed while changing the path).
 */
export interface WorkspaceIdentity {
  /** Canonical `fs.realpath` output at binding time. */
  readonly canonicalPath: string
  /** The volume/inode identity `fs.stat` reported for `canonicalPath` at binding time. */
  readonly volume: WorkspaceVolumeIdentity
}

/**
 * must[0]'s durable binding of one {@link TrustState} to the
 * {@link WorkspaceIdentity} it was granted for. `grantedBy` is present only
 * once `state` has ever left `'untrusted'` through a successful
 * `requestTrustUpgrade` (`./index.ts`) — a workspace that has never been
 * upgraded, and one just demoted back to `'untrusted'` by
 * `reconcileWorkspaceTrust`/`downgradeTrust`, both carry no grantor.
 */
export interface TrustRecord {
  /** The workspace binding this record's `state` applies to. */
  readonly identity: WorkspaceIdentity
  /** The currently bound trust state. */
  readonly state: TrustState
  /** ISO-8601 instant this record's `state` was last set. */
  readonly at: string
  /** The host user principal that authorized the current `state`, when it is above `'untrusted'`. */
  readonly grantedBy?: PrincipalId
}

/**
 * must[1]'s closed set of project-level content kinds: `'safe-read'` is
 * permitted at every {@link TrustState} (untrusted included); every other
 * member names one of must[1]'s five explicitly forbidden-while-untrusted
 * project-level executable surfaces — a project plugin, a project hook, an
 * MCP server the project configures, an executable skill, or a project file
 * that would override the host's home- or profile-level patch composition
 * (`apps/cli/src/profile-boot.ts`'s `homePatchPath`/`PROFILE_PATCH_FILENAME`
 * layer). `./index.ts`'s `authorizeProjectLoad` decides each kind against a
 * {@link TrustState}; only `'trusted-execute'` admits any kind other than
 * `'safe-read'`.
 */
export type ProjectContentKind =
  | 'safe-read'
  | 'project-plugin'
  | 'project-hook'
  | 'mcp-server'
  | 'executable-skill'
  | 'home-profile-patch-override'

/** Why `authorizeProjectLoad` refused a {@link ProjectContentKind} at the presented {@link TrustState}. */
export type LoadDenialReason = 'trust-required'

/**
 * The outcome of `authorizeProjectLoad`: either the load is permitted, or it
 * is refused naming the minimum {@link TrustState} that would have permitted
 * it — never a partial or advisory permission (acceptance[0]'s "clone and
 * open produces zero subprocess/network/credential-read activity" requires a
 * binary gate, not a warn-and-continue).
 */
export type LoadDecision =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly reason: LoadDenialReason; readonly requiredState: TrustState }

/** Why `requestTrustUpgrade` refused an upgrade (must[2]). */
export type TrustUpgradeDenialReason = 'non-host-principal'

/**
 * must[2]'s audit record: written once a trust upgrade succeeds, naming the
 * workspace identity, the state transition, the host principal that
 * authorized it, and when. Deliberately package-local plain data, not
 * `@deepseek-ai/dsh-trust-kernel`'s `TrustKernelAuditEntry` — see this
 * module's top-of-file note on why real Trust Kernel audit-append wiring is
 * a later, Fiber-fix-gated stage's job.
 */
export interface TrustUpgradeAuditRecord {
  /** The workspace binding the upgrade applies to. */
  readonly identity: WorkspaceIdentity
  /** The state before the upgrade. */
  readonly fromState: TrustState
  /** The state after the upgrade. */
  readonly toState: TrustState
  /** The host user principal's id that authorized the upgrade. */
  readonly hostPrincipalId: PrincipalId
  /** ISO-8601 instant the upgrade was authorized. */
  readonly at: string
}

/**
 * The outcome of `requestTrustUpgrade`: either the upgrade is admitted,
 * carrying both the new {@link TrustRecord} and the {@link TrustUpgradeAuditRecord}
 * must[2] requires, or it is refused with a {@link TrustUpgradeDenialReason}
 * and neither is produced — a refused upgrade writes no audit record,
 * because no upgrade happened to audit.
 */
export type TrustUpgradeResult =
  | { readonly upgraded: true; readonly record: TrustRecord; readonly audit: TrustUpgradeAuditRecord }
  | { readonly upgraded: false; readonly reason: TrustUpgradeDenialReason }

/**
 * acceptance[2]'s downgrade outcome: the demoted {@link TrustRecord} together
 * with exactly the {@link ProjectContentKind}s that `authorizeProjectLoad`
 * permitted under the prior state but no longer permits under `record.state`
 * — "立即撤销项目能力" (immediately revokes project capabilities) requires
 * naming what was revoked, not merely that the state number changed.
 */
export interface TrustDowngradeResult {
  /** The record after downgrade. */
  readonly record: TrustRecord
  /** The {@link ProjectContentKind}s revoked by this downgrade, in {@link ProjectContentKind}'s declared order. */
  readonly revokedKinds: readonly ProjectContentKind[]
}
