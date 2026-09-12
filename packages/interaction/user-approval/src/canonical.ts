/**
 * The binding digest: one stable value over everything an approval is bound to
 * (Epic P2-06 must[1], acceptance[0]).
 *
 * **This module canonicalizes nothing.** P2-03 owns the canonical form — RFC
 * 8785, with its frozen differential conformance and its NFC/NFD distinction —
 * and a second implementation here would be the second copy of a truth nothing
 * keeps honest. What this module adds is the SUBJECT: an approval is not bound
 * to its arguments alone but to the tuple a decider actually decided about, so
 * the digest is taken over that tuple's canonical form rather than over the
 * arguments'.
 *
 * The file exists because the registry's C-stage file list names it. Ruling 2
 * on this epic's preFlight changed what it IS — binding and digest, not
 * canonicalization — and the name would otherwise invite exactly the
 * re-implementation the ruling forbids.
 * @module @deepseek-ai/dsh-user-approval/canonical
 */

import { createHash } from 'node:crypto'
import { canonicalizeArguments } from '@deepseek-ai/dsh-action-manifest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalBindingDigest, ApprovalBindingInputs } from './types.ts'

/**
 * Project the bound tuple into the JSON value P2-03's canonical form accepts.
 *
 * Field order here does not matter — RFC 8785 sorts keys — but field PRESENCE
 * does: a field absent from this projection is a field an approval is not bound
 * to, so adding one to {@link ApprovalBindingInputs} without adding it here
 * silently widens what a stale approval still authorizes.
 * @param inputs - everything the approval is bound to.
 * @returns the projection to canonicalize.
 */
function boundTuple(inputs: ApprovalBindingInputs): JsonValue {
  return {
    action: inputs.action,
    arguments: inputs.args,
    principal: inputs.principal,
    preconditions: [...inputs.preconditions],
    capabilityToken: inputs.capabilityToken ?? null,
    policyVersion: inputs.policyVersion ?? null,
  }
}

/**
 * Digest everything one approval is bound to.
 *
 * Taken over the canonical form of the whole tuple rather than over each field
 * separately, so a change anywhere moves the digest and re-verification has one
 * value to compare. The per-field refusal reasons live in the verifier, which
 * compares the RECORDED fields; this digest is what an audit record carries so
 * a reader can tell two approvals apart without holding their inputs.
 * @param inputs - everything the approval is bound to.
 * @returns the binding digest.
 */
export function approvalBindingDigest(inputs: ApprovalBindingInputs): ApprovalBindingDigest {
  const canonical = canonicalizeArguments(boundTuple(inputs))
  return brandString<ApprovalBindingDigest>(createHash('sha256').update(canonical, 'utf8').digest('hex'))
}
