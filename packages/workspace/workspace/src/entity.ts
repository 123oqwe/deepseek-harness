/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 *
 * The entity also holds this workspace's trust binding (Epic P1-07 must[0]).
 * That binding is process-local, never part of {@link WorkspaceRecord}: see
 * this package's README for why durable trust is deferred. Every trust
 * DECISION comes from `@deepseek-ai/dsh-workspace-trust`'s pure functions —
 * this module contributes only the real `fs.realpath`/`fs.stat` observation
 * they consume, and never re-derives what an observation means.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { Principal } from '@deepseek-ai/dsh-principal/types'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { bindWorkspaceTrust, reconcileWorkspaceTrust, requestTrustUpgrade } from '@deepseek-ai/dsh-workspace-trust'
import type { TrustRecord, TrustState, TrustUpgradeResult } from '@deepseek-ai/dsh-workspace-trust/types'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { observeWorkspaceIdentity, realpathNormalize } from './paths.ts'

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Read a session's canonical directory from the registry's header index.
   * @param id - Session whose indexed path is requested.
   * @returns the canonical directory, or `undefined` when the header is
   * missing or its cwd cannot identify an existing directory.
   */
  sessionPath(id: SessionId): string | undefined

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Publish a successfully validated canonical cwd to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the immutable header cwd.
   */
  rememberSessionPath(id: SessionId, path: string): void
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord
  private trustRecord?: TrustRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   * @param openedPath - The path spelling this workspace was opened through,
   * re-resolved on every trust observation. It is the spelling and not
   * `record.path` because a symlink retargeted between two observations is one
   * of the identity changes trust must not survive, and canonicalizing it away
   * at create time would hide exactly that change.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
    private readonly openedPath: string,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter(id => this.host.sessionPath(id) === this.record.path)
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async attachSession(sessionId: SessionId): Promise<void> {
    // Validation is skipped when the settled snapshot already accounts the
    // id: the cwd fact was checked when it first attached and both inputs
    // (stored header cwd, workspace path) are immutable. Membership itself is
    // decided on the write chain inside `mutate`, never on this snapshot.
    if (!this.record.sessionIds.includes(sessionId)) {
      const header = await this.host.readSessionHeader(sessionId)
      if (header.cwd === undefined) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + 'its stored header carries no cwd to validate against',
        )
      }
      let cwd: string
      try {
        cwd = await realpathNormalize(header.cwd)
      } catch (error) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`,
          { cause: error },
        )
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' is not a directory`,
        )
      }
      if (cwd !== this.record.path) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd resolves to '${cwd}'`,
        )
      }
      this.host.rememberSessionPath(sessionId, cwd)
    }
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? record
      : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
      : record)
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    try {
      return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir'
    } catch {
      // Any stat failure (ENOENT, dangling parent, permission loss) means the
      // directory is not usable right now; the record itself never mutates.
      return 'missing-dir'
    }
  }

  /**
   * Re-observe {@link openedPath} and reconcile this workspace's trust binding
   * against what the filesystem now reports (Epic P1-07 must[0],
   * acceptance[1]). Seeds an `'untrusted'` binding on the first call.
   *
   * The identity comparison itself is
   * `@deepseek-ai/dsh-workspace-trust`'s `reconcileWorkspaceTrust`, so a
   * directory replaced in place, a symlink retargeted, and a directory moved
   * are demoted by the same rule that package already documents — nothing here
   * decides which differences matter. A path that no longer resolves yields no
   * identity to compare, and is demoted to `'untrusted'` on the last identity
   * observed rather than left at its prior state.
   * @returns this workspace's trust binding as of this observation.
   * @throws the `fs` rejection when the very first observation fails: an
   * unobservable workspace that was never bound has no identity to report.
   */
  async reconcileTrust(): Promise<TrustRecord> {
    const at = new Date().toISOString()
    const current = this.trustRecord
    let observed
    try {
      observed = await observeWorkspaceIdentity(this.openedPath)
    } catch (error) {
      if (current === undefined) throw error
      this.trustRecord = bindWorkspaceTrust(current.identity, at)
      return this.trustRecord
    }
    this.trustRecord = current === undefined
      ? bindWorkspaceTrust(observed, at)
      : reconcileWorkspaceTrust(current, observed, at)
    return this.trustRecord
  }

  /**
   * Raise this workspace's trust to `target` on `hostPrincipal`'s authority
   * (Epic P1-07 must[2]'s host-user gate). The binding is reconciled first, so
   * an upgrade is always adjudicated against a freshly observed identity and
   * never against a stale one that a directory swap has already invalidated.
   *
   * The adjudication and the audit record are
   * `@deepseek-ai/dsh-workspace-trust`'s `requestTrustUpgrade`; a refusal
   * leaves the reconciled binding untouched. The returned audit record is not
   * appended anywhere yet — see this package's README for what that needs.
   * @param target - The trust state to raise this workspace to.
   * @param hostPrincipal - The principal presented as the upgrade's author.
   * @returns the upgrade result, carrying the new binding and its audit record
   * on success and a refusal reason otherwise.
   */
  async upgradeTrust(target: TrustState, hostPrincipal: Principal): Promise<TrustUpgradeResult> {
    const current = await this.reconcileTrust()
    const result = requestTrustUpgrade(current, target, hostPrincipal, new Date().toISOString())
    if (result.upgraded) this.trustRecord = result.record
    return result
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the id-plus-canonical-cwd membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter(
          id => this.host.sessionPath(id) === changed.path,
        )
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
