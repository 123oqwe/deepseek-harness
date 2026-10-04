import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from '@deepseek-ai/dsh-workflow'
import * as WorkflowInvariant from '@deepseek-ai/dsh-workflow/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(WorkflowInvariant)
  return ctx
}

const info = (overrides: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo => ({
  id: WorkflowRunId('workflow-1'),
  meta: { name: 'review', description: 'Review a change' },
  ...overrides,
})

const agent = (overrides: Partial<WorkflowAgentInfo> = {}): WorkflowAgentInfo => ({
  seq: 1,
  label: 'reviewer',
  childId: SessionId('child-1'),
  ...overrides,
})

const agentEnd = (overrides: Partial<WorkflowAgentEndInfo> = {}): WorkflowAgentEndInfo => ({
  ...agent(),
  outcome: 'completed',
  ...overrides,
})

const result = (overrides: Partial<WorkflowResultInfo> = {}): WorkflowResultInfo => ({
  stopReason: 'completed',
  agentsStarted: 1,
  ...overrides,
})

describe('workflow invariants', () => {
  it('accepts a complete workflow and child lifecycle', async () => {
    const ctx = await setup()
    const run = info()
    ctx.emit('workflow/start', run)
    ctx.emit('workflow/phase', run, 'inspect')
    ctx.emit('workflow/log', run, 'working')
    ctx.emit('workflow/agent-start', run, agent())
    ctx.emit('workflow/agent-end', run, agentEnd())
    ctx.emit('workflow/end', run, result())
    ctx.emit('tools/change')
  })

  it('rejects invalid run identity and enclosure', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('workflow/start', info({ id: WorkflowRunId('') })) }).toThrow(/must be non-empty/)
    const run = info()
    ctx.emit('workflow/start', run)
    expect(() => { ctx.emit('workflow/start', run) }).toThrow(/repeated run id/)
    expect(() => { ctx.emit('workflow/log', info({ meta: { name: 'other', description: 'x' } }), 'x') })
      .toThrow(/meta diverges/)
    const fresh = await setup()
    expect(() => { fresh.emit('workflow/log', info(), 'x') }).toThrow(/no matching workflow\/start/)
  })

  it('rejects malformed and unpaired child lifecycles', async () => {
    const ctx = await setup()
    const run = info()
    ctx.emit('workflow/start', run)
    expect(() => { ctx.emit('workflow/agent-start', run, agent({ seq: 0 })) }).toThrow(/seq must be positive/)
    ctx.emit('workflow/agent-start', run, agent())
    expect(() => { ctx.emit('workflow/agent-start', run, agent()) }).toThrow(/repeated seq/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ seq: 2 })) }).toThrow(/no matching start/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ childId: SessionId('other') })) })
      .toThrow(/identity diverges/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ outcome: 'unknown' as never })) })
      .toThrow(/unknown outcome/)
  })

  it('rejects inconsistent terminal results', async () => {
    const active = await setup()
    active.emit('workflow/start', info())
    active.emit('workflow/agent-start', info(), agent())
    expect(() => { active.emit('workflow/end', info(), result()) }).toThrow(/without workflow\/agent-end/)

    const count = await setup()
    count.emit('workflow/start', info())
    count.emit('workflow/agent-start', info(), agent())
    count.emit('workflow/agent-end', info(), agentEnd())
    expect(() => { count.emit('workflow/end', info(), result({ agentsStarted: 0 })) })
      .toThrow(/covering every observed agent start/)

    const completed = await setup()
    completed.emit('workflow/start', info())
    expect(() => { completed.emit('workflow/end', info(), result({ error: 'unexpected' })) })
      .toThrow(/present exactly for cancelled and failed/)

    const failed = await setup()
    failed.emit('workflow/start', info())
    expect(() => { failed.emit('workflow/end', info(), result({ stopReason: 'error' })) })
      .toThrow(/present exactly for cancelled and failed/)
  })

  it('accepts a run that settles waiting on an approval, which names the approval and carries no error (Epic P2-07)', async () => {
    const waiting = await setup()
    waiting.emit('workflow/start', info())
    waiting.emit('workflow/end', info(), result({ stopReason: 'waiting_for_approval', waitingFor: { approvalId: 'approval-1' } }))

    const unnamed = await setup()
    unnamed.emit('workflow/start', info())
    expect(() => { unnamed.emit('workflow/end', info(), result({ stopReason: 'waiting_for_approval' })) })
      .toThrow(/waitingFor must be present exactly for a run waiting/)

    const erred = await setup()
    erred.emit('workflow/start', info())
    expect(() => {
      erred.emit('workflow/end', info(), result({ stopReason: 'waiting_for_approval', waitingFor: { approvalId: 'approval-1' }, error: 'x' }))
    }).toThrow(/present exactly for cancelled and failed/)

    const stray = await setup()
    stray.emit('workflow/start', info())
    expect(() => { stray.emit('workflow/end', info(), result({ waitingFor: { approvalId: 'approval-1' } })) })
      .toThrow(/waitingFor must be present exactly for a run waiting/)
  })
})
