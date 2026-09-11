/**
 * The context facts a policy actually receives (Epic P2-05 must[0]; BLOCKED-201).
 *
 * **What these cases are for.** `PolicyRequest.facts` existed from the start
 * and `enforceManifestedAction` filled it in place from an optional argument.
 * No dispatch path ever passed that argument, so on every shipped composition
 * the workspace was `untrusted`, the posture was `default`, and there was no
 * risk class at all — a policy about any of them could not match however it
 * was written, and the base bundle's Cedar row said so in a paragraph where a
 * rule should have been. Both paths now classify before asking and read the
 * facts from what the composition mounts.
 *
 * Each case drives a real turn through the stack and states its expectation
 * through a Cedar rule that matches only on the fact under test, so a fact
 * that failed to arrive is a permit rather than a differently-worded deny.
 */
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { callWriter, PERMIT_ALL, resultText, runTurn, stack } from './fixtures/stack.ts'

/** An absolute cwd; `stateFor` is asked about the session's own directory. */
const CWD = '/tmp/p2-05-facts'

describe('P2-05 must[0]: the policy sees the action, the workspace and the posture', () => {
  it("forbids the kernel hard-deny band by POLICY, because the action's risk class now reaches Cedar", async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      preset: 'workspace-write',
      tags: ['fire-suppression'],
      policies: {
        ...PERMIT_ALL,
        'kernel-hard-deny': 'forbid(principal, action, resource) when { context.riskClass == "safety-critical" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-risk', CWD)
    expect(resultText(events)).toContain('policy')
    expect(audit.at(-1)?.decision.effect).toBe('deny')
  })

  it('permits the same action when its declared tag classifies below that band, so the rule is not a constant', async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      preset: 'workspace-write',
      tags: ['filesystem-write'],
      policies: {
        ...PERMIT_ALL,
        'kernel-hard-deny': 'forbid(principal, action, resource) when { context.riskClass == "safety-critical" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-risk-control', CWD)
    expect(resultText(events)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
  })

  it("forbids on the workspace's REAL trust state, read from the mounted seam", async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      trust: 'untrusted',
      policies: {
        ...PERMIT_ALL,
        'untrusted-workspace': 'forbid(principal, action, resource) when { context.workspaceTrust == "untrusted" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-trust', CWD)
    expect(resultText(events)).toContain('policy')
    expect(audit.at(-1)?.decision.effect).toBe('deny')
  })

  it('permits under the SAME rule when the seam answers trusted-execute, so the fact is read rather than assumed', async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      trust: 'trusted-execute',
      policies: {
        ...PERMIT_ALL,
        'untrusted-workspace': 'forbid(principal, action, resource) when { context.workspaceTrust == "untrusted" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-trust-control', CWD)
    expect(resultText(events)).toContain('wrote')
    expect(audit.at(-1)?.decision.effect).toBe('permit')
  })

  it('CHARACTERIZATION (BLOCKED-202): the posture Cedar sees is the constant `default`, whatever preset is mounted', async () => {
    // Not an assertion that this is right. `PermissionPostureFact` enumerates
    // `default | plan | accept-edits | bypass`, and no composition configures a
    // preset by any of those names — the shipped table is `read-only`,
    // `workspace-write`, `danger-full-access`, and preset names are a
    // deployment's own config. So there is no real posture that can be spelled
    // in that vocabulary, and this case pins the gap where a reader will find
    // it rather than leaving the field looking supplied.
    const { ctx } = await stack({
      kernel: 'deployment',
      preset: 'read-only',
      tags: ['filesystem-write'],
      policies: {
        ...PERMIT_ALL,
        'posture-read-only': 'forbid(principal, action, resource) when { context.permissionPosture == "read-only" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-posture', CWD)
    expect(resultText(events)).toContain('wrote')
  })

  it('CHARACTERIZATION (BLOCKED-202): a rule naming `default` matches under the read-only preset, which is the defect stated positively', async () => {
    const { ctx, audit } = await stack({
      kernel: 'deployment',
      preset: 'read-only',
      tags: ['filesystem-write'],
      policies: {
        ...PERMIT_ALL,
        'posture-default': 'forbid(principal, action, resource) when { context.permissionPosture == "default" };',
      },
    })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([callWriter('call-1'), textResponse('done')]))
    const events = await runTurn(ctx, 'facts-posture-default', CWD)
    expect(resultText(events)).toContain('policy')
    expect(audit.at(-1)?.decision.effect).toBe('deny')
  })
})
