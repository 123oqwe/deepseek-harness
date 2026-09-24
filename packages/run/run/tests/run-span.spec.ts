/**
 * One Run across a session and the in-process child sessions it owns (Epic
 * P4-01 acceptance[2]'s second half, BLOCKED-309 route 1).
 *
 * A child joins the Run of the agent that owns it as a member: it keeps its own
 * Run, lease and lifecycle, and the owner's Run records it in `sessionIds`. The
 * owner's lease is the one authority over the owner's Run, so the cases below
 * also pin the two ways a second writer could appear: a child that adopts its
 * owner's Run as its own, and a join written after the owner's lease stopped
 * admitting writes.
 *
 * Two mounts over one store path model a restart, as in `restart.spec.ts`;
 * two mounts over one SQLite lease directory are two holders.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import InMemoryLeaseStorePlugin from '@deepseek-ai/dsh-lease'
import LeaseStoreSqlite from '@deepseek-ai/dsh-lease-sqlite'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RunPlugin, { createFileRunStore, RunService } from '../src/index.ts'

const roots: string[] = []
const mounted: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of mounted.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/**
 * A fresh directory owned through teardown.
 * @param prefix - the directory name prefix.
 * @returns its path.
 */
async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/**
 * A real Context with the agent loop, a lease store, and the Run plugin over
 * `path`; with `leaseDirectory`, the SQLite lease store two mounts can share.
 * @param path - the Run store path.
 * @param leaseDirectory - a SQLite lease directory, for a mount that contends with another.
 * @returns the mounted Context.
 */
async function mount(path: string, leaseDirectory?: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (leaseDirectory === undefined) await ctx.plugin(InMemoryLeaseStorePlugin)
  else await ctx.plugin(LeaseStoreSqlite, { directory: leaseDirectory })
  await ctx.plugin(RunPlugin, { storePath: path })
  mounted.push(ctx)
  return ctx
}

/**
 * Unload one mount and forget it, leaving any other mount in place.
 * @param ctx - the mount to unload.
 */
async function unmount(ctx: Context): Promise<void> {
  mounted.splice(mounted.indexOf(ctx), 1)
  await ctx.fiber.dispose()
}

/**
 * Create an in-process child session owned by `parent`, the way the in-process
 * subagent driver does (`subagent-in-process-driver/src/index.ts`).
 * @param parent - the owning agent.
 * @param id - the child's session id.
 * @returns the child's handle.
 */
async function child(parent: Agent, id: string) {
  return await parent.ctx.agents.create({ sessionId: SessionId(id), parentAgent: parent, meta: { parentSession: parent.id } })
}

/**
 * The Run store as a fresh process would read it.
 * @param path - the Run store path.
 * @returns the restored service.
 */
async function stored(path: string): Promise<RunService> {
  return await RunService.restore(createFileRunStore(path))
}

describe('P4-01 acceptance[2]: one Run spans a session and the in-process child sessions it owns', () => {
  it('records an in-process child session in the Run of the agent that owns it, and no unrelated session', async () => {
    const path = join(await directory('dsh-run-span-'), 'runs.json')
    const ctx = await mount(path)
    const parent = await ctx.agentLoop.create(SessionId('span-parent'))
    // Live while the child opens, so a join that picked any other live agent would take it.
    const unrelated = await ctx.agentLoop.create(SessionId('span-unrelated'))
    const { agent: owned } = await child(parent, 'span-child')

    // A member, not a sharer: the child is owned by the parent and keeps a Run of its own.
    expect(ctx.agents.isOwnedBy(owned.id, parent)).toBe(true)
    expect(owned.runId).toBeDefined()
    expect(owned.runId).not.toBe(parent.runId)
    await vi.waitFor(() => { expect(ctx.runs.service.get(parent.runId!)?.sessionIds).toStrictEqual([parent.id, owned.id]) })

    const [parentRun, unrelatedRun, ownedRun] = [parent.runId!, unrelated.runId!, owned.runId!]
    await unmount(ctx)
    const store = await stored(path)
    expect(store.get(parentRun)?.sessionIds).toStrictEqual([parent.id, owned.id])
    expect(store.get(unrelatedRun)?.sessionIds).toStrictEqual([unrelated.id])
    expect(store.get(ownedRun)?.sessionIds).toStrictEqual([owned.id])
  })

  it('keeps the child in its owner\'s Run across a restart, and the owner continues that Run', async () => {
    const path = join(await directory('dsh-run-span-'), 'runs.json')
    const first = await mount(path)
    const parent = await first.agentLoop.create(SessionId('span-restart-parent'))
    const { agent: owned } = await child(parent, 'span-restart-child')
    const runId = parent.runId!
    await vi.waitFor(() => { expect(first.runs.service.get(runId)?.sessionIds).toStrictEqual([parent.id, owned.id]) })
    await unmount(first)

    const second = await mount(path)
    // Restored at mount, before any agent exists.
    expect(second.runs.service.get(runId)?.sessionIds).toStrictEqual([parent.id, owned.id])
    const continued = await second.agentLoop.create(SessionId('span-restart-parent'))
    expect(continued.runId).toBe(runId)
  })

  it('does not let a continued child session adopt its owner\'s Run, and leaves that Run open when the child ends', async () => {
    const path = join(await directory('dsh-run-span-'), 'runs.json')
    const first = await mount(path)
    const parent = await first.agentLoop.create(SessionId('span-guard-parent'))
    const { agent: owned } = await child(parent, 'span-guard-child')
    const [runId, ownedRun] = [parent.runId!, owned.runId!]
    await unmount(first)

    const second = await mount(path)
    const continuedParent = await second.agentLoop.create(SessionId('span-guard-parent'))
    const continuedChild = await child(continuedParent, 'span-guard-child')
    // The child continues the Run it opened, never the one it joined.
    expect(continuedChild.agent.runId).toBe(ownedRun)
    expect(continuedChild.agent.runId).not.toBe(runId)
    await continuedChild.dispose()
    await unmount(second)

    const store = await stored(path)
    expect(store.listNonTerminal().map(run => run.id)).toContain(runId)
  })

  it('refuses a host that holds only the child\'s lease any write to the owner\'s Run', async () => {
    // Split leases, the two-master risk BLOCKED-196 names: A holds the parent's
    // lease, B takes the child's. B's child must write nothing to the parent's Run.
    const path = join(await directory('dsh-run-span-'), 'runs.json')
    const leases = await directory('dsh-run-span-leases-')
    const a = await mount(path, leases)
    const parent = await a.agentLoop.create(SessionId('span-split-parent'))
    const owned = await child(parent, 'span-split-child')
    const runId = parent.runId!
    await vi.waitFor(() => { expect(a.runs.service.get(runId)?.sessionIds).toStrictEqual([parent.id, owned.agent.id]) })
    // A lets the child go: the child's lease is released and its own Run ends; A keeps the parent's lease.
    const ownedRun = owned.agent.runId!
    await owned.dispose()
    await vi.waitFor(async () => { expect((await stored(path)).listNonTerminal().map(run => run.id)).not.toContain(ownedRun) })
    const snapshot = (await stored(path)).get(runId)
    expect(snapshot?.sessionIds).toStrictEqual([parent.id, owned.agent.id])

    const b = await mount(path, leases)
    expect((await b.agentLoop.create(SessionId('span-split-parent'))).leaseRefused).toBe(true)
    const continued = await b.agentLoop.create(SessionId('span-split-child'))
    expect(continued.leaseRefused).toBeUndefined()
    expect(continued.runId).toBeDefined()
    expect(continued.runId).not.toBe(runId)
    await unmount(b)

    expect((await stored(path)).get(runId)).toStrictEqual(snapshot)
    expect(a.runs.service.get(runId)?.sessionIds).toStrictEqual([parent.id, owned.agent.id])
    expect(a.runs.service.listNonTerminal().map(run => run.id)).toContain(runId)
  })

  it('does not record a child in its owner\'s Run once the owner\'s lease no longer admits writes', async () => {
    const path = join(await directory('dsh-run-span-'), 'runs.json')
    const ctx = await mount(path)
    const parent = await ctx.agentLoop.create(SessionId('span-fenced-parent'))
    // A holder another host has since fenced out: its lease stops admitting writes.
    vi.spyOn(parent.runLease!, 'mayWrite').mockReturnValue(false)
    const { agent: owned } = await child(parent, 'span-fenced-child')
    const [runId, ownedRun] = [parent.runId!, owned.runId!]
    await unmount(ctx)

    const store = await stored(path)
    expect(store.get(runId)?.sessionIds).toStrictEqual([parent.id])
    expect(store.get(ownedRun)?.sessionIds).toStrictEqual([owned.id])
  })
})
