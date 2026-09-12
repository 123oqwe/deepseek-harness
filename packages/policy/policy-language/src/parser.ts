/**
 * Reading a deployment's policy set, and keeping its failures apart (Epic
 * P2-10 must[0], validation[2]).
 *
 * Three outcomes, and the separation is the contract. A set that does not
 * PARSE is a broken configuration. A set that parses but names vocabulary dsh
 * never sends is a set whose rules cannot match — measured against Cedar
 * 4.12.0, such a set loads clean today and reports itself only through a
 * per-decision diagnostic, once per decision, after actions have already been
 * refused. An EMPTY set is neither: Cedar denies when no permit matches, so an
 * empty set forbids everything, which a deployment almost never means.
 * Collapsing any two of these makes a broken deployment look like a strict one.
 * @module @deepseek-ai/dsh-policy-language/parser
 */

import { checkParsePolicySet } from '@cedar-policy/cedar-wasm/nodejs'

/** Why a policy set was refused. */
export type PolicySetRefusal =
  /** At least one policy is not valid Cedar. */
  | 'unparsable'
  /** The set is empty, which forbids everything rather than saying nothing. */
  | 'empty'

/** What reading a policy set produced. */
export type PolicySetParse =
  | { readonly ok: true; readonly policies: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: PolicySetRefusal; readonly errors: readonly string[] }

/**
 * Read a deployment's policy set, refusing before anything is enforced.
 *
 * Syntax only, deliberately, and the gap is named rather than hidden: the
 * VOCABULARY half — refusing a policy that reads a context key
 * `toCedarRequest` never sends — is not here, because the installed
 * `@cedar-policy/cedar-wasm` 4.12.0 cannot express dsh's namespaced entity
 * types in a schema. Its schema entry points accept a single unnamed
 * namespace: `{ json: <namespace body> }` parses, while `{ json: { Dsh: … } }`
 * and an entity type spelled `Dsh::Principal` are both refused. dsh sends
 * `Dsh::Principal`, `Dsh::Action` and `Dsh::Resource`, and that translation is
 * P2-05's frozen property, which this epic does not re-verify and must not
 * quietly change. Which way that closes is the delegate's ruling; this
 * function's outcome type already has the shape the answer plugs into.
 * @param policies - the deployment's policy set, keyed by policy id.
 * @returns the set when every policy parses, or the reason it was refused.
 */
export function parsePolicySet(policies: Readonly<Record<string, string>>): PolicySetParse {
  const ids = Object.keys(policies)
  if (ids.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      errors: ['the policy set is empty, and an empty set forbids every action rather than permitting them'],
    }
  }
  // Per policy rather than over the whole set, so a refusal names the policy a
  // deployment has to fix. Cedar's own errors carry source offsets into
  // whichever text it was given, which are useless across a concatenated set.
  const errors = ids.flatMap((id) => {
    const parsed = checkParsePolicySet({ staticPolicies: { [id]: policies[id] as string } })
    return parsed.type === 'success' ? [] : parsed.errors.map(error => `${id}: ${error.message}`)
  })
  return errors.length === 0 ? { ok: true, policies } : { ok: false, reason: 'unparsable', errors }
}
