/**
 * P2-04 acceptance[0] on the Web surface: the shipped Web composition gives the
 * bash action the risk class its recorded session holds, asserted in a case
 * body.
 *
 * `minimal-preset.snapshot.ts` replays the same recording, but it compares the
 * session with the recording only in `afterAll` (`scaffold.close()`), where a
 * mismatch fails the suite and no named case. This file drives the same turn
 * through `launchWebScaffold` (the shipped base and web-app bundle layers,
 * in-process) with that comparison off, and compares the `action/risk-gated`
 * records itself. It launches no browser.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/minimal-preset/session.v3.jsonl', import.meta.url))
const PROMPT = "Use the bash tool to run exactly: printf 'MINIMAL_BASH_CARD_OK\\n'. Then reply exactly MINIMAL_PRESET_REQUEST_OK and stop."

/**
 * The `action/risk-gated` payloads among session records, in log order.
 * @param records - session log records or events.
 * @returns their `data` members.
 */
function riskGated(records: readonly { readonly type: string; readonly data?: unknown }[]): unknown[] {
  return records.filter(record => record.type === 'action/risk-gated').map(record => record.data)
}

describe('P2-04 acceptance[0]: the shipped Web composition classifies bash as its recorded session does (no browser)', () => {
  let scaffold: WebScaffold | undefined
  let agentHandle: AgentHandle | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, compareReplaySession: false, paceMs: 10 })
    const launched = scaffold
    agentHandle = await launched.ctx.agents.create({
      sessionId: SessionId('minimal-preset-smoke'),
      meta: { cwd: launched.workspaceCwd, agentPreset: 'minimal' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => launched.ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
    })
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()
  })

  afterAll(async () => {
    try {
      await agentHandle?.dispose()
    } finally {
      await scaffold?.close()
    }
  })

  it('the replayed bash call is gated with the risk class, preset and decision the recording holds', () => {
    if (agentHandle === undefined) throw new Error('beforeAll created no agent')
    const recorded = riskGated(readFileSync(FIXTURE, 'utf8').split('\n').filter(line => line.length > 0)
      .map(line => JSON.parse(line) as { type: string; data?: unknown }))
    expect(recorded).toEqual([{ actionId: 'bash', riskClass: 'internal-write', preset: 'workspace-write', decision: 'allowed-by-preset' }])
    expect(riskGated(agentHandle.agent.session.snapshotEvents())).toEqual(recorded)
  })
})
