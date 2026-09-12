/**
 * P2-06 Contract: what an approval is bound to, and what invalidates it.
 *
 * Every case here holds a RECORDED value against a CHANGED one. That is the
 * discipline the clause needs rather than a style preference: a verifier that
 * re-read the live principal, or re-hashed whatever arguments it was handed,
 * would move with every substitution it exists to refuse and would pass any
 * case that compared a value against itself. So the binding is made once, the
 * present tuple is built separately, and the two are never derived from one
 * object.
 *
 * Canonicalization is NOT tested here. Key ordering, number spelling and
 * NFC/NFD are P2-03's frozen cases; re-asserting them would be proving another
 * epic's clause.
 */

import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PrincipalId } from '@deepseek-ai/dsh-principal/types'
import { bindApproval, verifyApprovalBinding } from '../src/index.ts'
import { approvalBindingDigest } from '../src/canonical.ts'
import type { ApprovalBindingInputs } from '../src/types.ts'

const ALICE = brandString<PrincipalId>('user-alice')
const BOB = brandString<PrincipalId>('user-bob')
const ASKED_AT = 1_700_000_000_000
const EXPIRES_AT = ASKED_AT + 60_000

/** The tuple a decider saw; each case varies exactly one field away from it. */
function decided(over: Partial<ApprovalBindingInputs> = {}): ApprovalBindingInputs {
  return {
    action: 'fs.write',
    args: { path: 'workspace/a.ts', contents: 'one' },
    principal: ALICE,
    preconditions: ['workspace is trusted'],
    capabilityToken: 'token-digest-1',
    policyVersion: 'policy-v1',
    ...over,
  }
}

describe('P2-06 must[1]: an approval is bound to the tuple the decider decided about', () => {
  it('admits the SAME tuple, which is the control every refusal below is measured against', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided(), ASKED_AT + 1)).toEqual({ valid: true })
  })

  it('digests the whole tuple, so a change in ANY bound field moves the digest', () => {
    const base = approvalBindingDigest(decided())
    expect(approvalBindingDigest(decided({ principal: BOB }))).not.toBe(base)
    expect(approvalBindingDigest(decided({ policyVersion: 'policy-v2' }))).not.toBe(base)
    expect(approvalBindingDigest(decided({ preconditions: [] }))).not.toBe(base)
    // And it is stable: the same tuple digests identically, or an approval
    // could never be verified against itself.
    expect(approvalBindingDigest(decided())).toBe(base)
  })
})

describe('P2-06 must[2]/acceptance[0]: any field change invalidates, and the refusal names WHICH', () => {
  it('refuses substituted arguments — the clause\'s first sentence', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    const substituted = decided({ args: { path: 'workspace/a.ts', contents: 'two' } })
    expect(verifyApprovalBinding(binding, substituted, ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'arguments' })
  })

  it('refuses a switched account, comparing the RECORDED principal and not the live one', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ principal: BOB }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'principal' })
  })

  it('refuses changed preconditions, which is how a file inode or object version reaches this check', () => {
    // acceptance[0]'s third substitution — the file's inode, the remote
    // object's version — is a PRECONDITION in the manifest's vocabulary, so it
    // is bound and compared like any other field rather than through a
    // filesystem call this layer must not make.
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ preconditions: ['workspace is trusted', 'inode 42'] }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'preconditions' })
  })

  it('refuses a different capability token and a different policy version separately', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ capabilityToken: 'token-digest-2' }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'capability-token' })
    expect(verifyApprovalBinding(binding, decided({ policyVersion: 'policy-v2' }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'policy-version' })
  })

  it('refuses a different action, so one approval cannot be spent on another capability', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ action: 'fs.delete' }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'action' })
  })

  it('names ONE field rather than a set, because an operator acts on one cause', () => {
    // Two fields moved; the answer is the first in the declared order, not
    // `['action', 'arguments', …]`. A refusal listing everything that differs
    // tells an operator to investigate four things when one of them happened.
    const binding = bindApproval(decided(), EXPIRES_AT)
    const verification = verifyApprovalBinding(
      binding,
      decided({ action: 'fs.delete', principal: BOB }),
      ASKED_AT + 1,
    )
    expect(verification).toEqual({ valid: false, reason: 'changed', field: 'action' })
  })
})

describe('P2-06 acceptance[0]: `unattached` is a value, not a wildcard', () => {
  it('binds an agent with no identity attached as an explicit value', () => {
    const binding = bindApproval(decided({ principal: 'unattached' }), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ principal: 'unattached' }), ASKED_AT + 1))
      .toEqual({ valid: true })
  })

  it('refuses an approval taken while UNATTACHED once a principal IS attached — the reverse control', () => {
    // The case that keeps `unattached` from being a wildcard. A decision made
    // when nobody was attached was made about nobody; spending it once an
    // actor exists is exactly the account substitution acceptance[0] forbids.
    const binding = bindApproval(decided({ principal: 'unattached' }), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ principal: ALICE }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'principal' })
  })

  it('refuses the other direction too, so detaching is not a way to spend an approval', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ principal: 'unattached' }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'principal' })
  })
})

describe('P2-06 must[0]: the validity period is compared against a clock the CALLER supplies', () => {
  it('admits before the expiry and refuses at it, naming both instants', () => {
    const binding = bindApproval(decided(), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided(), EXPIRES_AT - 1)).toEqual({ valid: true })
    expect(verifyApprovalBinding(binding, decided(), EXPIRES_AT))
      .toEqual({ valid: false, reason: 'expired', expiresAtMs: EXPIRES_AT, now: EXPIRES_AT })
  })

  it('reports a SUBSTITUTION rather than expiry when both are true, because that is the fact to act on', () => {
    // A stale approval whose arguments were also swapped is a substitution
    // attempt; reporting it as merely expired would let it read as a timing
    // accident and lose the finding.
    const binding = bindApproval(decided(), EXPIRES_AT)
    const substituted = decided({ args: { path: 'workspace/a.ts', contents: 'two' } })
    expect(verifyApprovalBinding(binding, substituted, EXPIRES_AT + 10_000))
      .toEqual({ valid: false, reason: 'changed', field: 'arguments' })
  })
})

describe('P2-06 acceptance[1]: display may be redacted; the digest covers the real value', () => {
  it('binds two arguments that would DISPLAY identically to two different digests', () => {
    // The pair that inverts if a view is digested instead of the value: both
    // render as `{ token: '***' }` to a decider, and they must not share an
    // approval.
    const left = approvalBindingDigest(decided({ args: { token: 'secret-alpha' } }))
    const right = approvalBindingDigest(decided({ args: { token: 'secret-beta' } }))
    expect(left).not.toBe(right)
  })

  it('refuses the second value against the first\'s binding, which is the same fact through the verifier', () => {
    const binding = bindApproval(decided({ args: { token: 'secret-alpha' } }), EXPIRES_AT)
    expect(verifyApprovalBinding(binding, decided({ args: { token: 'secret-beta' } }), ASKED_AT + 1))
      .toEqual({ valid: false, reason: 'changed', field: 'arguments' })
  })

  it('digests a redacted PLACEHOLDER differently from the value it stands for', () => {
    // Stated directly so a later reader cannot take "the view is redacted" to
    // mean the binding may be: if the placeholder were ever digested, every
    // secret would share one approval.
    expect(approvalBindingDigest(decided({ args: { token: '***' } })))
      .not.toBe(approvalBindingDigest(decided({ args: { token: 'secret-alpha' } })))
  })
})
