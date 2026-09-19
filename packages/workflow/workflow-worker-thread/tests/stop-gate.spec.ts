/**
 * P2-12 must[2] where the workflow engine takes its lease: no run starts while
 * an emergency stop is in force, and the refusal is routed as the stop.
 *
 * Its own file rather than a case inside `integration.spec.ts`, whose cases are
 * cited by P4-07's and P4-09's frozen cells: a diagnostic added there changes a
 * file two sealed commands run.
 *
 * The engine is mounted on the real stack, because the refusal happens inside
 * `takeRunLease` on the way into `start` and nothing shorter reaches it. What
 * is asserted is the CODE and not only the sentence — callers branch on
 * `WorkflowErrorCode`, and a stop announced under `RUN_HELD_BY_ANOTHER_HOST`
 * would be retried against a host that does not exist.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { brandString } from '@deepseek-ai/dsh-brand'
import ControlPlaneService from '@deepseek-ai/dsh-control-plane/plugin'
import type { ControlRequest } from '@deepseek-ai/dsh-control-plane/channel'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LeaseStorePlugin from '@deepseek-ai/dsh-lease-sqlite'
import MessageBusPlugin from '@deepseek-ai/dsh-message-bus'
import type { PrincipalId } from '@deepseek-ai/dsh-principal'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { WorkflowError } from '@deepseek-ai/dsh-workflow'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkerThreadWorkflowEngine from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/**
 * A directory removed after the case.
 * @param prefix - what it holds, so a leftover names itself.
 * @returns the directory path.
 */
function directory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

const REQUEST: ControlRequest = {
  requestedBy: brandString<PrincipalId>('operator-1'),
  reason: 'human-requested',
  requestedAtMs: 1_700_000_000_000,
}

/**
 * The engine on the real stack, with a durable lease store and a control plane.
 *
 * The plane is mounted AFTER the engine deliberately: the provider reads it per
 * acquisition, so a gate that had captured it at mount would let a stopped run
 * start and this case would pass for the wrong reason.
 * @returns the context and the parent agent a run is started under.
 */
async function setup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MessageBusPlugin)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(LeaseStorePlugin, { directory: directory('workflow-stop-leases-') })
  await ctx.plugin(WorkerThreadWorkflowEngine, {})
  await ctx.plugin(ControlPlaneService, { storePath: directory('workflow-stop-plane-') })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

describe('P2-12 must[2]: the workflow engine starts no run under a stop', () => {
  it('refuses with EMERGENCY_STOP_IN_FORCE rather than reporting a holder that does not exist', async () => {
    const { ctx, parent } = await setup()
    ctx.get('controlPlane')?.control('pause-new-actions', REQUEST)
    let thrown: unknown
    try {
      ctx.workflowEngine.start({ meta: { name: 'stopped', description: 'refused under a stop' }, script: "return 'ok'", parent })
    } catch (error) {
      thrown = error
    }
    // The code, because that is what a caller branches on; the sentence is
    // checked too, because it is what an operator reads.
    expect(thrown).toBeInstanceOf(WorkflowError)
    expect((thrown as WorkflowError).code).toBe('EMERGENCY_STOP_IN_FORCE')
    expect((thrown as WorkflowError).message).toMatch(/emergency stop is in force/u)
  })

  it('starts a run with the same shape once the stop is released', async () => {
    // The positive control: the refusal above belongs to the stop and not to
    // this stack being unable to start runs at all.
    const { ctx, parent } = await setup()
    const plane = ctx.get('controlPlane')
    plane?.control('pause-new-actions', REQUEST)
    plane?.control('resume', REQUEST)
    const run = ctx.workflowEngine.start({ meta: { name: 'released', description: 'runs after a resume' }, script: "return 'ok'", parent })
    await run.result
    await run.dispose()
  })
})
