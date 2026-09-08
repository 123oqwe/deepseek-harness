/**
 * The dispatch risk gate (Epic P2-04 must[1], Epic P2-03 acceptance[2];
 * §12.50).
 *
 * **What the default policy actually stops.** Under the shipped rules a
 * sandboxed action — reading, writing, running a command — classifies below
 * the interactive threshold and runs without asking, because the SANDBOX is
 * the enforcer of that boundary and a second prompt in front of it would ask
 * about something already governed. Three things do stop:
 *
 * 1. a tool that declares NO domain tags, which classifies by the unknown
 *    default and so needs approval where one can be asked and is refused
 *    where nothing can answer;
 * 2. an action a rule places in a high band (`security-sensitive`,
 *    `financial`);
 * 3. an action a rule places in the kernel band, which no preset permits.
 *
 * These cases live in `permission-presets` rather than in `dsh-tools` because
 * the gate reads the policy through a structural port: the policy package sits
 * ABOVE the core, so the core cannot depend on it, and a test that mounted a
 * fake would prove only that the port is called.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { gateActionRisk, refusedRiskResult } from '@deepseek-ai/dsh-tools/external-effect'
import type { Agent } from '@deepseek-ai/dsh-agent'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import type { Config } from '@deepseek-ai/dsh-permission-presets'

/** The rules the shipped base bundle configures, in the shape the service takes. */
const SHIPPED_RULES: NonNullable<Config['riskRules']> = [
  { domainTag: 'filesystem-read', riskClass: 'read' },
  { domainTag: 'filesystem-write', riskClass: 'internal-write' },
  { domainTag: 'shell-execute', riskClass: 'internal-write' },
  { domainTag: 'network-fetch', riskClass: 'external-communication' },
  { domainTag: 'key-material', riskClass: 'security-sensitive' },
  { domainTag: 'fire-suppression', riskClass: 'safety-critical' },
]

/** An approval service that records what it was asked and answers as configured. */
function approver(outcome: string): { asked: string[]; request: (req: { toolName: string; reason?: string }) => Promise<string> } {
  const asked: string[] = []
  return {
    asked,
    request(req) {
      asked.push(req.reason ?? req.toolName)
      return Promise.resolve(outcome)
    },
  }
}

async function mounted(options: { preset: string; approval?: ReturnType<typeof approver> }): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('risk-gate tests do not execute bash') },
    run() { throw new Error('risk-gate tests do not execute bash') },
    start() { throw new Error('risk-gate tests do not execute bash') },
  })
  // ONE approval service: `PermissionPresetService` reads `.config.policy`
  // from it and the gate calls `.request`, so the stand-in carries both. A
  // composition with no answerer is modelled by a `request` that resolves
  // `unavailable`, which is what `user-approval` itself normalizes to — not
  // by an object missing the method, which no real composition produces.
  const approval = options.approval ?? approver('unavailable')
  ctx.provide('approval', { config: { policy: 'ask' }, request: approval.request })
  await ctx.plugin(PermissionPresetService, {
    riskRules: SHIPPED_RULES,
    presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask', approvalThreshold: 'destructive' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', approvalThreshold: 'safety-critical' },
    },
    defaultPreset: options.preset,
  })
  const session = ctx.sessions.create(SessionId('risk-gate'))
  return { ctx, agent: { id: session.id, session } as unknown as Agent }
}

describe('P2-04 must[1]: the default policy does not ask about sandboxed work', () => {
  it('runs a declared filesystem write and a declared shell command without asking', async () => {
    const approval = approver('rejected')
    const { ctx, agent } = await mounted({ preset: 'workspace-write', approval })

    expect(await gateActionRisk(ctx, agent, 'write', ['filesystem-write'])).toBeUndefined()
    expect(await gateActionRisk(ctx, agent, 'bash', ['shell-execute'])).toBeUndefined()
    // Not merely "allowed": nothing was ASKED. A gate that asked and was
    // answered yes would pass the assertion above while interrupting the user
    // on every command.
    expect(approval.asked).toEqual([])
  })
})

describe('P2-03 acceptance[2]: an undeclared tool is the case the gate is for', () => {
  it('ASKS about a tool that declares no domain tags, naming the undeclared tags as the cause', async () => {
    const approval = approver('allowed-once')
    const { ctx, agent } = await mounted({ preset: 'workspace-write', approval })

    expect(await gateActionRisk(ctx, agent, 'mystery_tool', [])).toBeUndefined()
    expect(approval.asked).toHaveLength(1)
    // The reason names the CAUSE, not only the score: "it scored high" and
    // "it never said what it touches" call for different fixes.
    expect(approval.asked[0]).toContain('declares no risk domain tags')
    expect(approval.asked[0]).toContain('security-sensitive')
  })

  it('REFUSES an undeclared tool when nothing can answer, rather than proceeding on silence', async () => {
    // No answerer composed. `user-approval` already fails closed to
    // `unavailable`; a missing service must fail closed the same way, or a
    // composition could obtain silence and read it as consent.
    const { ctx, agent } = await mounted({ preset: 'workspace-write' })

    const refusal = await gateActionRisk(ctx, agent, 'mystery_tool', [])
    expect(refusal).toEqual({ kind: 'approval-refused', riskClass: 'security-sensitive', outcome: 'unavailable', undeclared: true })
    expect(refusedRiskResult(refusal!, 'mystery_tool').error?.message).toContain('declares no risk domain tags')
  })

  it('lets an undeclared tool run under a preset whose threshold is above the unknown default', async () => {
    // The negative half, so the two cases above are not a constant: the same
    // undeclared tool passes under `danger-full-access`, whose threshold is
    // the kernel band. A deployment that wants this everywhere sets that
    // preset; that is the documented way out, not a silent one.
    const { ctx, agent } = await mounted({ preset: 'danger-full-access' })

    expect(await gateActionRisk(ctx, agent, 'mystery_tool', [])).toBeUndefined()
  })
})

describe('P2-04 must[1]: a declared high band asks, and the kernel band never does', () => {
  it('asks about a declared security-sensitive action, and refuses it when approval is declined', async () => {
    const approval = approver('rejected')
    const { ctx, agent } = await mounted({ preset: 'workspace-write', approval })

    const refusal = await gateActionRisk(ctx, agent, 'read_private_key', ['key-material'])
    expect(refusal).toEqual({ kind: 'approval-refused', riskClass: 'security-sensitive', outcome: 'rejected', undeclared: false })
    // Declared, so the reason does NOT claim the tool said nothing.
    expect(approval.asked[0]).not.toContain('declares no risk domain tags')
  })

  it('HARD-DENIES a declared safety-critical action under EVERY preset, without asking', async () => {
    const approval = approver('allowed-once')
    for (const preset of ['workspace-write', 'danger-full-access']) {
      const { ctx, agent } = await mounted({ preset, approval })

      const refusal = await gateActionRisk(ctx, agent, 'suppress_fire', ['fire-suppression'])
      expect(refusal).toEqual({ kind: 'hard-deny', riskClass: 'safety-critical', undeclared: false })
      expect(refusedRiskResult(refusal!, 'suppress_fire').error?.message).toContain('No approval can permit it')
    }
    // Never asked, under either preset: offering a choice that does not exist
    // is worse than refusing, because a granted approval would imply it did.
    expect(approval.asked).toEqual([])
  })
})

describe('P2-04: a composition with no policy service has no gate', () => {
  it('runs an undeclared tool when no permission service is composed, which is capability absence', async () => {
    // Absent policy is not "an action nobody vouched for" — it is a
    // composition that never had an organisation policy to enforce.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('no-policy'))
    const agent = { id: session.id, session } as unknown as Agent

    expect(await gateActionRisk(ctx, agent, 'mystery_tool', [])).toBeUndefined()
  })
})
