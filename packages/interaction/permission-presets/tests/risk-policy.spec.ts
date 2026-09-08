/**
 * The organisation risk policy this deployment classifies actions under
 * (Epic P2-04 Provider stage: must[1], must[3], acceptance[0], acceptance[2]).
 *
 * The classifier is pure and takes the policy as a parameter. That makes
 * "which class does this action land in" a question with no single answer
 * until something BINDS the parameter, and binding it in one mounted service
 * is what stops two surfaces from classifying the same action differently
 * (acceptance[0]). These cases are about the binding, not about the
 * classification rules — those are the Contract stage's, and duplicating them
 * here would test `classify` twice and the provider not at all.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import type { Config } from '@deepseek-ai/dsh-permission-presets'

async function mounted(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('risk-policy tests do not execute bash') },
    run() { throw new Error('risk-policy tests do not execute bash') },
    start() { throw new Error('risk-policy tests do not execute bash') },
  })
  ctx.provide('approval', { config: { policy: 'ask' } })
  await ctx.plugin(PermissionPresetService, config)
  return ctx
}

describe('P2-04 P — the deployment binds the organisation policy the classifier takes as a parameter', () => {
  it('must[1]: the SAME action classifies by the mounted rules, not by anything the action says about itself', async () => {
    const ctx = await mounted({ riskRules: [{ domainTag: 'wire-transfer', riskClass: 'financial' }] })

    const decided = ctx.permissionPresets.classifyAction({ actionId: 'a-1', domainTags: ['wire-transfer'] })
    expect(decided.riskClass).toBe('financial')
    expect(decided.ground).toBe('policy-rule')
    expect(decided.decidedBy).toBe('wire-transfer')
  })

  it('acceptance[0]: two callers of the SAME mount get the same answer, because the policy is bound once', async () => {
    // The consistency acceptance[0] asks for across CLI, Web and SDK is
    // structural rather than tested per surface: none of those surfaces has
    // its own dispatch, and the parameter is bound here. What is testable is
    // that binding — a caller cannot supply a policy of its own.
    const ctx = await mounted({ riskRules: [{ domainTag: 'read-file', riskClass: 'read' }] })

    const first = ctx.permissionPresets.classifyAction({ actionId: 'a-2', domainTags: ['read-file'] })
    const second = ctx.permissionPresets.classifyAction({ actionId: 'a-3', domainTags: ['read-file'] })
    expect(first.riskClass).toBe(second.riskClass)
    expect(first.riskClass).toBe('read')
  })

  it('must[3]: an action whose tags no rule mentions reaches the approval threshold rather than passing quietly', async () => {
    const ctx = await mounted({ riskRules: [] })

    const unknown = ctx.permissionPresets.classifyAction({ actionId: 'a-4', domainTags: ['never-declared'] })
    expect(unknown.ground).toBe('unknown-default')
    expect(ctx.permissionPresets.requiresApproval(unknown)).toBe(true)
    // And it is a question, not a refusal: §12.47 reserves the kernel band for
    // an action a policy DECLARES catastrophic.
    expect(unknown.hardDenied).toBe(false)
  })

  it('must[1]: the threshold is the deployment\'s, so the same class can pass under one profile and stop under another', async () => {
    const strict = await mounted({
      riskRules: [{ domainTag: 'send-email', riskClass: 'external-communication' }],
      approvalThreshold: 'external-communication',
    })
    const relaxed = await mounted({
      riskRules: [{ domainTag: 'send-email', riskClass: 'external-communication' }],
      approvalThreshold: 'safety-critical',
    })
    const subject = { actionId: 'a-5', domainTags: ['send-email'] }

    expect(strict.permissionPresets.requiresApproval(strict.permissionPresets.classifyAction(subject))).toBe(true)
    // The negative half, so the case above is not a constant: the threshold is
    // read, rather than every action reaching it whatever the profile says.
    expect(relaxed.permissionPresets.requiresApproval(relaxed.permissionPresets.classifyAction(subject))).toBe(false)
  })

  it('acceptance[2]: a deployment that switches off a kernel hard-deny class is refused AT MOUNT, naming the class', async () => {
    // Refused where the deployment says it, not at the first action it
    // classifies. `classify` refuses such a policy on every call, so without
    // this the misconfiguration would surface as a runtime error per action —
    // in a profile that had already started serving.
    await expect(mounted({ riskRules: [], removedHardDenyClasses: ['safety-critical'] }))
      .rejects.toThrow(/safety-critical/u)
    // The positive control: removing a class the kernel does NOT pin removes
    // nothing and is not an error, so the refusal above is about the kernel
    // floor rather than about the field being set at all.
    await expect(mounted({ riskRules: [], removedHardDenyClasses: ['financial'] }))
      .resolves.toBeDefined()
  })

  it('acceptance[2]: a deployment may RAISE its own bar, and the raise reaches classification', async () => {
    const ctx = await mounted({
      riskRules: [{ domainTag: 'wire-transfer', riskClass: 'financial' }],
      addedHardDenyClasses: ['financial'],
    })

    const decided = ctx.permissionPresets.classifyAction({ actionId: 'a-6', domainTags: ['wire-transfer'] })
    expect(decided.hardDenied).toBe(true)
    // A hard deny is not reported as "needs approval": approval is a question,
    // and this is a band the deployment does not ask about.
    expect(decided.ground).toBe('kernel-hard-deny')
  })
})
