/**
 * The pinned policy-set artifact (Epic P2-10 must[1]'s version pin,
 * acceptance[1]).
 *
 * A pin answers "same input and version, same output", and it takes THREE
 * inputs because the same policy text can mean different things:
 *
 * - the canonical policy text, so reformatting is not a revision;
 * - the vocabulary the policies are read against, because a set whose context
 *   keys changed is a different evaluator wearing the same policies;
 * - the engine version, because `formatPolicies` is what produces the
 *   canonical form, and a cedar release that changed it would otherwise drift
 *   every pin SILENTLY. Binding the version makes an upgrade an intentional,
 *   visible re-pin. **Upgrading `@cedar-policy/cedar-wasm` re-pins every
 *   policy set**, which is the point rather than a cost.
 *
 * Measured on the pinned 4.12.0: `formatPolicies` canonicalises within a
 * version — one policy written compactly and written loosely format to
 * byte-identical text. Whether it is stable ACROSS cedar patch versions is not
 * measured and is not assumed; the version input is what makes the question
 * safe to leave open.
 * @module @deepseek-ai/dsh-policy-language/compiler
 */

import { createHash } from 'node:crypto'
import { formatPolicies } from '@cedar-policy/cedar-wasm/nodejs'
import { canonicalizeArguments } from '@deepseek-ai/dsh-action-manifest/canonicalize'
import { parsePolicySet, type PolicySetParse } from './parser.ts'

/** The three inputs a pin is taken over, beyond the policies themselves. */
export interface PolicyPinInputs {
  /** The context keys these policies are read against. */
  readonly contextKeys: readonly string[]
  /** The evaluating engine's version, so an upgrade re-pins visibly. */
  readonly engineVersion: string
}

/** One compiled, pinned policy set. */
export interface CompiledPolicySet {
  readonly ok: true
  /** The policies as supplied, unchanged. */
  readonly policies: Readonly<Record<string, string>>
  /** The canonical text each policy formats to, keyed by policy id. */
  readonly canonical: Readonly<Record<string, string>>
  /** The digest a replay keys on. */
  readonly pin: string
}

/** What compiling a policy set produced. */
export type PolicySetCompile = CompiledPolicySet | Extract<PolicySetParse, { ok: false }>

/**
 * Compile a deployment's policy set into its pinned artifact.
 *
 * Parsing comes first and its refusals pass through unchanged: a set that
 * cannot be read has no canonical form to pin, and inventing one would give a
 * broken deployment a pin that a replay could compare against.
 * @param policies - the deployment's policy set, keyed by policy id.
 * @param inputs - the vocabulary and engine version this pin is taken over.
 * @returns the compiled set, or the reason the set was refused.
 */
export function compilePolicySet(
  policies: Readonly<Record<string, string>>,
  inputs: PolicyPinInputs,
): PolicySetCompile {
  const parsed = parsePolicySet(policies)
  if (!parsed.ok) return parsed

  const canonical: Record<string, string> = {}
  for (const id of Object.keys(policies).sort()) {
    const formatted = formatPolicies({ policyText: policies[id] as string, lineWidth: 100, indentWidth: 2 })
    // A set that parsed cannot fail to format; if cedar ever disagrees, the
    // raw text is pinned rather than a silently dropped policy.
    canonical[id] = formatted.type === 'success' ? formatted.formatted_policy : (policies[id] as string)
  }

  // The repository's canonical JSON form (P2-03's JCS), not a second one: two
  // canonicalisers would let one artifact carry two pins depending on which
  // module hashed it.
  const digestInput = canonicalizeArguments({
    engineVersion: inputs.engineVersion,
    contextKeys: [...inputs.contextKeys].sort(),
    canonical,
  })
  return {
    ok: true,
    policies,
    canonical,
    pin: createHash('sha256').update(digestInput).digest('hex'),
  }
}
