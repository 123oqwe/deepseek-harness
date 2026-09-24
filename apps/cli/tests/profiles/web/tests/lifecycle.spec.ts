/**
 * P6-07 must[0] and acceptance[0] on the shipped web profile: the session
 * controller's list returns every persisted session, filters it by tenant,
 * workspace, lifecycle status and created-at, and pages through it by cursor.
 *
 * Each case writes its own sessions before boot, through the JSONL
 * persistence the profile mounts, into `$DSH_HOME/sessions` in the shipped
 * layout and default encoding. A tenant comes only from an `identity/attached`
 * event (the input a caller of the product writes, not one the web profile
 * produces), so tenant seeds carry one and the unattributed seed (V5) carries
 * none. Every seed's `cwd` is one of two real directories: the workspace
 * registry's startup bootstrap groups persisted sessions by that path, which
 * gives the workspace dimension its two workspaces. The profile then boots
 * in-process through `runProfile`, as `dsh --profile web --no-open --port 0`
 * does.
 *
 * The request fields and the lifecycle methods these cases use are the ones
 * the P6-07 work order adds (LB-3: `filters`, `limit`, `cursor` and
 * `nextCursor`; LB-5: `softDelete`, `placeLegalHold` and `erase`), called
 * through loose types so the file builds before they exist and a missing one
 * fails an assertion.
 * @module apps/cli/tests/profiles/web/tests/lifecycle
 */

import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { createChain, createUserPrincipal } from '@deepseek-ai/dsh-principal'
import { type IdentityContext, PrincipalId, RunId, TenantId } from '@deepseek-ai/dsh-principal/types'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionLifecycleFilter } from '@deepseek-ai/dsh-session-lifecycle'
import type {} from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { runProfile } from '../../../../src/profile-boot.ts'
import { startRoutingStubModelServer } from '../../routing-stub-model.ts'

/** The process events `runProfile` adds listeners for. */
const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const
/** Case deadline: seeding, one in-process boot and a handful of list calls. */
const CASE_TIMEOUT_MS = 180_000
const ACME = TenantId('acme')
const GLOBEX = TenantId('globex')
/** Every seed's `createdAt` except the created-at dimension's. */
const EARLIER = 1_758_700_000_000
/** One day later: the created-at dimension's seed. */
const LATER = EARLIER + 86_400_000
/** T2's page size. */
const PAGE_SIZE = 4
/** Upper bound on T2's walk, so a cursor that never ends fails instead of hanging. */
const MAX_PAGES = 30

/** One session a case writes before boot. */
interface Seed {
  readonly id: string
  /** Which of the case's two workspace directories is the session's `cwd`. */
  readonly workspace: 'a' | 'b'
  /** The tenant its `identity/attached` names; absent for an unattributed session (V5). */
  readonly tenant?: ReturnType<typeof TenantId>
  readonly createdAt: number
}

/** The two workspace directories of a case. */
interface Directories {
  readonly a: string
  readonly b: string
}

/** The list request P6-07's LB-3 adds to the controller. */
interface LifecycleListRequest {
  readonly filters?: readonly SessionLifecycleFilter[]
  readonly limit?: number
  readonly cursor?: string
}

/** The list value LB-3 returns: one page, and the cursor to the next one when more remain. */
interface LifecycleListValue {
  readonly items: readonly { readonly sessionId: string }[]
  readonly nextCursor?: string
}

/** The session controller as these cases call it, with LB-3's request and LB-5's lifecycle methods. */
interface LifecycleSessionController {
  list(request: LifecycleListRequest, signal: AbortSignal): Promise<LifecycleListValue>
  readonly softDelete?: (request: { readonly sessionId: SessionId }, signal: AbortSignal) => Promise<unknown>
  readonly placeLegalHold?: (request: { readonly sessionId: SessionId; readonly reason: string }, signal: AbortSignal) => Promise<unknown>
  readonly erase?: (request: { readonly sessionId: SessionId }, signal: AbortSignal) => Promise<unknown>
}

/** A lifecycle status a list request can filter on. */
type LifecycleStatus = Extract<SessionLifecycleFilter, { readonly kind: 'status' }>['values'][number]

/**
 * The identity a tenant seed's `identity/attached` carries.
 * @param tenant - the principal's tenant.
 * @param principal - the principal id.
 * @returns a one-entry identity rooted at a user principal.
 */
function identity(tenant: ReturnType<typeof TenantId>, principal: string): IdentityContext {
  const root = createUserPrincipal(PrincipalId(principal), tenant)
  return { principal: root, runId: RunId(`run-${principal}`), chain: createChain(root, 1) }
}

/**
 * The events a seed's log holds: its identity when it has a tenant, otherwise
 * one turn start so the log still exists on disk.
 * @param seed - the seed.
 * @returns its events.
 */
function seedEvents(seed: Seed): SessionEvent[] {
  return seed.tenant === undefined
    ? [{ type: 'turn/start', seq: SessionSeq(0), time: seed.createdAt, data: { turn: 1 } }]
    : [{ type: 'identity/attached', seq: SessionSeq(0), time: seed.createdAt, data: { identity: identity(seed.tenant, `user-${seed.id}`) } }]
}

/**
 * Write the seeds through the JSONL persistence the web profile mounts.
 * @param sessionsRoot - `$DSH_HOME/sessions`.
 * @param directories - the case's workspace directories.
 * @param seeds - the sessions to write.
 */
async function writeSeeds(sessionsRoot: string, directories: Directories, seeds: readonly Seed[]): Promise<void> {
  const ctx = new Context()
  try {
    await ctx.plugin(JsonlSessionPersistence, { root: sessionsRoot })
    for (const seed of seeds) {
      const header: SessionHeader = {
        version: SESSION_FORMAT_VERSION,
        id: SessionId(seed.id),
        createdAt: seed.createdAt,
        isSeeded: false,
        cwd: directories[seed.workspace],
      }
      const handle = await ctx.sessionPersistence.create(header)
      try {
        await handle.append(seedEvents(seed))
      } finally {
        await handle.close()
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Boot the shipped `web` profile in-process, as `dsh --profile web --no-open
 * --port 0` does.
 * @param project - the invoking directory, whose `.env` layer the launch reads; it has none.
 * @returns the root context once every row has started.
 */
async function launchWeb(project: string): Promise<Context> {
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh', project),
    profile: 'web',
    fromDefaultProfile: undefined,
    patchFiles: [],
    args: ['--no-open', '--port', '0'],
  })
  return ctx
}

/**
 * Remove the process listeners added since a snapshot.
 * @param before - each event's listeners when the snapshot was taken.
 */
function removeAddedListeners(before: ReadonlyMap<string, readonly unknown[]>): void {
  const emitter: NodeJS.EventEmitter = process
  for (const [event, listeners] of before) {
    for (const listener of emitter.listeners(event)) {
      if (!listeners.includes(listener)) emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }
}

/**
 * Write `seeds`, boot the web profile over them, run `body`, and restore the
 * process environment and listeners the boot changed.
 * @param seeds - the sessions to write before boot.
 * @param body - the case, given the booted root, the workspace directories,
 * and a restart that disposes the composition and boots it again on the same
 * home.
 */
async function withWeb(
  seeds: readonly Seed[],
  body: (ctx: Context, directories: Directories, restart: () => Promise<Context>) => Promise<void>,
): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-p6-07-web-')))
  const home = join(root, '.dsh')
  const project = join(root, 'project')
  const directories: Directories = { a: join(root, 'ws-a'), b: join(root, 'ws-b') }
  for (const directory of [project, directories.a, directories.b]) await mkdir(directory)
  await writeSeeds(join(home, 'sessions'), directories, seeds)
  const stub = await startRoutingStubModelServer(() => undefined)
  const launchEnv: Readonly<Record<string, string>> = {
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(root, '.agents'),
    DEEPSEEK_API_KEY: 'sk-dummy-for-boot',
    DEEPSEEK_BASE_URL: stub.baseUrl,
    DSH_PERMISSION_MODE: 'danger-full-access',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_TRUST_KERNEL_INSECURE: '',
  }
  const savedEnv = new Map(Object.keys(launchEnv).map((name): [string, string | undefined] => [name, process.env[name]]))
  const emitter: NodeJS.EventEmitter = process
  const savedListeners = new Map(PROCESS_EVENTS.map((event): [string, readonly unknown[]] => [event, emitter.listeners(event)]))
  let ctx: Context | undefined
  try {
    Object.assign(process.env, launchEnv)
    ctx = await launchWeb(project)
    const restart = async (): Promise<Context> => {
      await ctx?.fiber.dispose()
      ctx = undefined
      removeAddedListeners(savedListeners)
      ctx = await launchWeb(project)
      return ctx
    }
    await body(ctx, directories, restart)
  } finally {
    await ctx?.fiber.dispose()
    removeAddedListeners(savedListeners)
    for (const [name, value] of savedEnv) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
    await stub.close()
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * The controller as these cases call it.
 * @param ctx - a booted web profile's root context.
 * @returns the session controller typed with LB-3's request and LB-5's soft delete.
 */
function lifecycleController(ctx: Context): LifecycleSessionController {
  return ctx.sessionController
}

/**
 * The session ids one list request returns.
 * @param controller - the session controller.
 * @param request - the list request.
 * @returns the ids of the returned page.
 */
async function listIds(controller: LifecycleSessionController, request: LifecycleListRequest): Promise<string[]> {
  const { items } = await controller.list(request, new AbortController().signal)
  return items.map(item => item.sessionId)
}

/**
 * The workspace the registry bootstrapped for a directory.
 * @param ctx - a booted web profile's root context.
 * @param path - the directory.
 * @returns its workspace id.
 */
async function workspaceIdOf(ctx: Context, path: string): Promise<WorkspaceId> {
  const workspace = await ctx.workspaceRegistry.resolveByPath(path)
  if (workspace === undefined) throw new Error(`the workspace registry bootstrapped no workspace for ${path}`)
  return workspace.id
}

/**
 * The LB-5 methods the controller does not have.
 * @param controller - the session controller.
 * @returns the names of the missing ones.
 */
function missingLifecycleMethods(controller: LifecycleSessionController): string[] {
  return (['softDelete', 'placeLegalHold', 'erase'] as const).filter(name => typeof controller[name] !== 'function')
}

/**
 * The session ids listed under one lifecycle status.
 * @param controller - the session controller.
 * @param status - the status to filter on.
 * @returns the listed ids.
 */
async function idsWithStatus(controller: LifecycleSessionController, status: LifecycleStatus): Promise<string[]> {
  return listIds(controller, { filters: [{ kind: 'status', values: [status] }] })
}

/**
 * The seed ids a list result lacks.
 * @param ids - the listed ids.
 * @param seedIds - the ids that must be there.
 * @returns the missing ones.
 */
function missing(ids: readonly string[], seedIds: readonly string[]): string[] {
  return seedIds.filter(id => !ids.includes(id))
}

describe('P6-07 on the shipped web profile, booted in-process: the session list (no key required)', () => {
  it('lists every persisted session when the shipped list request carries no filter', async () => {
    const seeds: Seed[] = [
      { id: 'p6-07-t0-acme', workspace: 'a', tenant: ACME, createdAt: EARLIER },
      { id: 'p6-07-t0-globex', workspace: 'a', tenant: GLOBEX, createdAt: EARLIER },
      { id: 'p6-07-t0-other-workspace', workspace: 'b', tenant: ACME, createdAt: EARLIER },
      // V5: no identity/attached, so no tenant. Listing must not drop it.
      { id: 'p6-07-t0-unattributed', workspace: 'a', createdAt: EARLIER },
    ]
    await withWeb(seeds, async (ctx) => {
      const ids = await listIds(lifecycleController(ctx), {})
      expect(missing(ids, seeds.map(seed => seed.id))).toEqual([])
    })
  }, CASE_TIMEOUT_MS)

  it('filters the shipped session list by tenant, workspace, lifecycle status and created-at, excluding each non-matching session', async () => {
    // One seed per dimension that differs from `base` in that dimension only.
    const base = 'p6-07-t1-base'
    const otherTenant = 'p6-07-t1-other-tenant'
    const otherWorkspace = 'p6-07-t1-other-workspace'
    const later = 'p6-07-t1-later'
    const softDeleted = 'p6-07-t1-soft-deleted'
    const unattributed = 'p6-07-t1-unattributed'
    const seeds: Seed[] = [
      { id: base, workspace: 'a', tenant: ACME, createdAt: EARLIER },
      { id: otherTenant, workspace: 'a', tenant: GLOBEX, createdAt: EARLIER },
      { id: otherWorkspace, workspace: 'b', tenant: ACME, createdAt: EARLIER },
      { id: later, workspace: 'a', tenant: ACME, createdAt: LATER },
      { id: softDeleted, workspace: 'a', tenant: ACME, createdAt: EARLIER },
      // V5: an unattributed session is listed, and a workspace filter keeps it.
      { id: unattributed, workspace: 'a', createdAt: EARLIER },
    ]
    await withWeb(seeds, async (ctx, directories) => {
      const controller = lifecycleController(ctx)
      // Every excluded id below is listed unfiltered first, so its absence is the filter's doing.
      expect(missing(await listIds(controller, {}), seeds.map(seed => seed.id))).toEqual([])

      const byTenant = await listIds(controller, { filters: [{ kind: 'tenant', values: [ACME] }] })
      expect(byTenant).toContain(base)
      expect(byTenant).not.toContain(otherTenant)
      expect(byTenant).not.toContain(unattributed)

      const workspaceB = await listIds(controller, { filters: [{ kind: 'workspace', values: [await workspaceIdOf(ctx, directories.b)] }] })
      expect(workspaceB).toContain(otherWorkspace)
      expect(workspaceB).not.toContain(base)
      const workspaceA = await listIds(controller, { filters: [{ kind: 'workspace', values: [await workspaceIdOf(ctx, directories.a)] }] })
      expect(missing(workspaceA, [base, unattributed])).toEqual([])
      expect(workspaceA).not.toContain(otherWorkspace)

      const byTime = await listIds(controller, { filters: [{ kind: 'time', from: LATER }] })
      expect(byTime).toContain(later)
      expect(byTime).not.toContain(base)

      expect(typeof controller.softDelete).toBe('function')
      await controller.softDelete?.({ sessionId: SessionId(softDeleted) }, new AbortController().signal)
      const byStatus = await listIds(controller, { filters: [{ kind: 'status', values: ['soft-deleted'] }] })
      expect(byStatus).toContain(softDeleted)
      expect(byStatus).not.toContain(base)
    })
  }, CASE_TIMEOUT_MS)

  it('walks the shipped session list page by page via its cursor, returning every matching session exactly once', async () => {
    const seeds: Seed[] = [
      ...Array.from({ length: 24 }, (_, index): Seed => ({
        id: `p6-07-t2-${String(index).padStart(2, '0')}`,
        workspace: 'a',
        tenant: ACME,
        createdAt: EARLIER + index * 1_000,
      })),
      // V5: the unattributed session is walked like any other.
      { id: 'p6-07-t2-unattributed', workspace: 'a', createdAt: EARLIER + 99_000 },
    ]
    await withWeb(seeds, async (ctx) => {
      const controller = lifecycleController(ctx)
      const pages: string[][] = []
      const cursors: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const value = await controller.list({ limit: PAGE_SIZE, ...cursor === undefined ? {} : { cursor } }, new AbortController().signal)
        pages.push(value.items.map(item => item.sessionId))
        if (value.nextCursor === undefined) break
        cursors.push(value.nextCursor)
        cursor = value.nextCursor
      }
      expect(pages.length).toBeGreaterThan(1)
      expect(pages.filter(items => items.length > PAGE_SIZE)).toEqual([])
      const walked = pages.flat()
      expect(walked.length).toBe(new Set(walked).size)
      expect(cursors.length).toBe(new Set(cursors).size)
      const unfiltered = await listIds(controller, {})
      const byId = (left: string, right: string): number => left.localeCompare(right)
      expect([...walked].sort(byId)).toEqual([...unfiltered].sort(byId))
      expect(missing(walked, seeds.map(seed => seed.id))).toEqual([])
    })
  }, CASE_TIMEOUT_MS)

  it('keeps archive, soft delete, legal hold and hard erase distinct on the shipped session API', async () => {
    // Five sessions, one operation each, plus one left active.
    const active = 'p6-07-t3-active'
    const archived = 'p6-07-t3-archived'
    const softDeleted = 'p6-07-t3-soft-deleted'
    const held = 'p6-07-t3-held'
    const softDeletedHeld = 'p6-07-t3-soft-deleted-held'
    const erased = 'p6-07-t3-erased'
    const ids = [active, archived, softDeleted, held, softDeletedHeld, erased]
    await withWeb(ids.map((id): Seed => ({ id, workspace: 'a', tenant: ACME, createdAt: EARLIER })), async (ctx) => {
      const controller = lifecycleController(ctx)
      expect(missingLifecycleMethods(controller)).toEqual([])
      // The session about to be erased exists first.
      expect(missing(await listIds(controller, {}), ids)).toEqual([])

      await ctx.workspaceController.archiveSession({ sessionId: SessionId(archived) })
      await controller.softDelete?.({ sessionId: SessionId(softDeleted) }, new AbortController().signal)
      await controller.placeLegalHold?.({ sessionId: SessionId(held), reason: 'p6-07 T3' }, new AbortController().signal)
      await controller.softDelete?.({ sessionId: SessionId(softDeletedHeld) }, new AbortController().signal)
      await controller.placeLegalHold?.({ sessionId: SessionId(softDeletedHeld), reason: 'p6-07 T3' }, new AbortController().signal)
      await controller.erase?.({ sessionId: SessionId(erased) }, new AbortController().signal)

      const isArchived = await idsWithStatus(controller, 'archived')
      expect(isArchived).toContain(archived)
      expect(isArchived).not.toContain(active)
      expect(isArchived).not.toContain(softDeleted)
      const isSoftDeleted = await idsWithStatus(controller, 'soft-deleted')
      expect(missing(isSoftDeleted, [softDeleted, softDeletedHeld])).toEqual([])
      expect(isSoftDeleted).not.toContain(archived)
      expect(isSoftDeleted).not.toContain(held)
      const isActive = await idsWithStatus(controller, 'active')
      expect(missing(isActive, [active, held])).toEqual([])
      expect(isActive).not.toContain(archived)
      expect(isActive).not.toContain(softDeleted)
      // A hold, with or without a soft delete, refuses erase.
      await expect(controller.erase?.({ sessionId: SessionId(held) }, new AbortController().signal)).rejects.toThrow(/legal hold/i)
      const eraseSoftDeletedHeld = controller.erase?.({ sessionId: SessionId(softDeletedHeld) }, new AbortController().signal)
      await expect(eraseSoftDeletedHeld).rejects.toThrow(/legal hold/i)
      // The erased session is gone under every status and from the unfiltered list.
      for (const listed of [await listIds(controller, {}), isArchived, isSoftDeleted, isActive]) expect(listed).not.toContain(erased)
    })
  }, CASE_TIMEOUT_MS)

  it('a legal hold placed through the shipped API still blocks erase after the composition restarts', async () => {
    const held = 'p6-07-t8-held'
    await withWeb([{ id: held, workspace: 'a', tenant: ACME, createdAt: EARLIER }], async (ctx, _directories, restart) => {
      const controller = lifecycleController(ctx)
      expect(missingLifecycleMethods(controller)).toEqual([])
      await controller.placeLegalHold?.({ sessionId: SessionId(held), reason: 'p6-07 T8' }, new AbortController().signal)
      // The hold is in force before the restart.
      await expect(controller.erase?.({ sessionId: SessionId(held) }, new AbortController().signal)).rejects.toThrow(/legal hold/i)

      const restarted = lifecycleController(await restart())
      expect(await listIds(restarted, {})).toContain(held)
      await expect(restarted.erase?.({ sessionId: SessionId(held) }, new AbortController().signal)).rejects.toThrow(/legal hold/i)
    })
  }, CASE_TIMEOUT_MS)
})
