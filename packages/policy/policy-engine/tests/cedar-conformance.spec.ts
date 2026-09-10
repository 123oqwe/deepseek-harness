/**
 * Epic P2-05 Contract stage: the three properties this epic adopts an engine
 * FOR, proven against the real `@cedar-policy/cedar-wasm` 4.12.0.
 *
 * The make-vs-use record's whole argument is that forbid-overrides-permit,
 * default-deny and a matched-policy explain are Cedar's documented semantics
 * rather than something this repository has to write. A record that CITES those
 * semantics and never runs them is a decision resting on a claim, so the
 * preFlight recorded them `differs` (unprobed) and this file is where they
 * become `ok`.
 *
 * The package's own source still imports no engine — this is a dependency
 * probe pinning the vocabulary `../src/types.ts` is designed against.
 */

import { describe, expect, it } from 'vitest'
import { isAuthorized } from '@cedar-policy/cedar-wasm/nodejs'
import type { AuthorizationCall } from '@cedar-policy/cedar-wasm/nodejs'

/** The one action every case asks about: a tool call against a workspace path. */
const CALL = {
  principal: { type: 'Dsh::Principal', id: 'user-1' },
  action: { type: 'Dsh::Action', id: 'tool:write' },
  resource: { type: 'Dsh::Resource', id: 'workspace/a.ts' },
  context: {},
  entities: [],
} satisfies Omit<AuthorizationCall, 'policies'>

/**
 * Ask Cedar, and fail loudly rather than silently reading a failure as a deny.
 *
 * `staticPolicies` takes either one source string or a map from policy id to
 * source. The map form is what a provider must use: submitted as a string,
 * Cedar assigns generated ids (`policy0`, `policy1`) and an `@id(...)`
 * annotation in the source does NOT become the id the explain reports — so an
 * audit trail built on the string form would name policies nobody wrote.
 */
function decide(policies: string | Record<string, string>): { decision: string; reason: string[] } {
  const answer = isAuthorized({ ...CALL, policies: { staticPolicies: policies } })
  if (answer.type !== 'success') {
    throw new Error(`cedar refused the call: ${answer.errors.map(error => error.message).join('; ')}`)
  }
  return { decision: answer.response.decision, reason: answer.response.diagnostics.reason }
}

describe('P2-05: the Cedar semantics this epic adopts an engine for (4.12.0, run not cited)', () => {
  it('DEFAULT DENY: an empty policy set denies, so nothing is permitted by omission', () => {
    // The property the harness needs first: a deployment that forgot to write
    // a policy must not thereby allow everything.
    expect(decide('').decision).toBe('deny')
  })

  it('permits when a policy permits, so default-deny is not "always deny"', () => {
    // The control for the case above. Without it, an engine that denied
    // unconditionally would satisfy every other case here.
    const { decision, reason } = decide('permit(principal, action, resource);')

    expect(decision).toBe('allow')
    expect(reason).toHaveLength(1)
  })

  it('FORBID OVERRIDES PERMIT, whatever order the two policies are written in', () => {
    // This is the property `dsh-permission-rules` does not have: its ordered
    // rules resolve by first match, so which of two plugins loaded first
    // decides the outcome. Cedar's overriding rule is a property of the engine.
    const permitFirst = decide('permit(principal, action, resource);\nforbid(principal, action, resource);')
    const forbidFirst = decide('forbid(principal, action, resource);\npermit(principal, action, resource);')

    expect(permitFirst.decision).toBe('deny')
    expect(forbidFirst.decision).toBe('deny')
  })

  it('EXPLAINS with the matched policy ids, which is what must[3] redacts', () => {
    // must[3] hides policy detail from the model and shows it to the audit. An
    // engine that could not say WHICH policy decided would leave nothing to
    // redact and nothing to record.
    const { decision, reason } = decide({
      'baseline-permit': 'permit(principal, action, resource);',
      'destructive-forbid': 'forbid(principal, action, resource);',
    })

    expect(decision).toBe('deny')
    expect(reason).toEqual(['destructive-forbid'])
  })

  it('reports a malformed policy set as a FAILURE rather than as a deny', () => {
    // The distinction acceptance[2] rests on: "the policy said no" and "the
    // policy set could not be read" are different states, and an engine that
    // collapsed them would make a broken deployment look like a strict one.
    expect(() => decide('this is not a policy')).toThrow(/cedar refused the call/)
  })
})
