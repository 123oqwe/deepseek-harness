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

import { checkParsePolicySet, policyToJson } from '@cedar-policy/cedar-wasm/nodejs'
import { DSH_CONTEXT_KEYS } from './schema.ts'

/** Why a policy set was refused. */
export type PolicySetRefusal =
  /** At least one policy is not valid Cedar. */
  | 'unparsable'
  /** The set is empty, which forbids everything rather than saying nothing. */
  | 'empty'
  /** A policy reads a context key `toCedarRequest` never sends, so it can never match. */
  | 'unknown-context-key'

/** What reading a policy set produced. */
export type PolicySetParse =
  | { readonly ok: true; readonly policies: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: PolicySetRefusal; readonly errors: readonly string[] }

/**
 * Every context attribute one policy reads, from its JSON form.
 *
 * Cedar renders `context.foo` as `{".": {left: {Var: "context"}, attr: "foo"}}`,
 * so the walk looks for that one node anywhere in the tree — conditions,
 * nested operators, either side of a comparison. A recursive walk rather than a
 * fixed path because the expression grammar nests arbitrarily and a
 * path-matched reader would silently miss the deep cases, which is the same
 * quiet failure this check exists to remove.
 * @param node - any node of the policy's JSON form.
 * @param found - accumulator for the attribute names seen so far.
 * @returns the accumulator.
 */
function contextAttributes(node: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) contextAttributes(item, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  const record = node as Record<string, unknown>
  const access = record['.'] as { left?: unknown; attr?: unknown } | undefined
  if (access !== undefined) {
    const left = access.left as { Var?: unknown } | undefined
    if (left?.Var === 'context' && typeof access.attr === 'string') found.add(access.attr)
  }
  for (const value of Object.values(record)) contextAttributes(value, found)
  return found
}

/**
 * Read a deployment's policy set, refusing before anything is enforced.
 *
 * Syntax first, then vocabulary, and the order is load-bearing: a policy that
 * does not parse has no vocabulary to read, and reporting it as an unknown key
 * would send a deployment hunting a typo in a key that was never the problem.
 *
 * **The vocabulary check is dsh's own rather than Cedar's `validate`, and the
 * reason is measured.** The installed `@cedar-policy/cedar-wasm` 4.12.0 cannot
 * express dsh's namespaced entity types in a schema: its schema entry points
 * take a single unnamed namespace, so `{ json: <namespace body> }` parses
 * while `{ json: { Dsh: … } }` and an entity type spelled `Dsh::Principal`
 * are both refused, and the Cedar-schema-language wrappers are refused as
 * `invalid type: string`. dsh sends `Dsh::Principal`, `Dsh::Action` and
 * `Dsh::Resource`, and that translation is P2-05's frozen property, which this
 * epic does not re-verify and must not quietly change. So what is hand-written
 * here is one narrow thing — a membership test over context attribute names —
 * while every authorization semantic remains Cedar's.
 * @param policies - the deployment's policy set, keyed by policy id.
 * @returns the set when every policy parses, or the reason it was refused.
 */
/**
 * Ask Cedar one question, turning an escape into an answer.
 *
 * The engine reaches this repository through a wasm boundary, and two failures
 * there are not parse results: a fault inside wasm, and a serialization error
 * raised before wasm is entered (an unpaired UTF-16 surrogate in the source
 * does this — `unexpected end of hex escape`). Neither is a refusal, and
 * neither should reach a deployment as itself: what a deployment can act on is
 * "this policy is unusable", not a message about hex escapes.
 *
 * The depth guard above exists because one of those failures cannot be caught
 * usefully — a wasm fault leaves the instance dead for the rest of the process,
 * so it has to be prevented rather than handled. This catch is for the rest,
 * which leave the engine healthy: measured, a surrogate throw is followed by a
 * successful parse on the very next call.
 * @param ask - the Cedar call to make.
 * @param id - the policy the call is about, for the message.
 * @returns what Cedar answered, or the reason it could not be asked.
 */
function askCedar<T>(ask: () => T, id: string): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: ask() }
  } catch (error) {
    return { ok: false, error: `${id}: the policy engine failed on this policy: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Most levels of parenthesis nesting one policy's condition may carry.
 *
 * A guard against a MEASURED crash, not a style rule. `@cedar-policy/cedar-wasm`
 * 4.12.0 faults with `RuntimeError: memory access out of bounds` somewhere
 * between 130 and 135 levels — measured on this tree, each depth in its own
 * process because the fault leaves the wasm instance unusable for every later
 * call. There is no way back from it in-process: the instance stays dead, the
 * package exports no reset, and a cache-busted re-import returns the same dead
 * module, so the only defence is never to reach it.
 *
 * 64 sits far below the cliff, leaving room for the depth Cedar tolerates to
 * move between versions, and far above real use: the shipped base's two
 * policies nest 0 and 1 levels. **Re-measure when cedar-wasm is upgraded** — the
 * cliff is that dependency's, not this repository's.
 */
const MAX_CONDITION_DEPTH = 64

/**
 * The deepest parenthesis nesting in one policy's source.
 *
 * Counted over the raw text rather than a parse tree, because the point is to
 * decide BEFORE handing the text to a parser that cannot survive it. Quoted
 * strings are not excluded: a parenthesis inside a string literal cannot raise
 * the real nesting, so counting it can only refuse a policy slightly earlier
 * than necessary, and refusing early is the safe direction here.
 * @param source - one policy's Cedar source.
 * @returns the maximum nesting depth reached.
 */
function conditionDepth(source: string): number {
  let depth = 0
  let deepest = 0
  for (const character of source) {
    if (character === '(') {
      depth += 1
      if (depth > deepest) deepest = depth
    } else if (character === ')' && depth > 0) {
      depth -= 1
    }
  }
  return deepest
}

export function parsePolicySet(policies: Readonly<Record<string, string>>): PolicySetParse {
  const ids = Object.keys(policies)
  if (ids.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      errors: ['the policy set is empty, and an empty set forbids every action rather than permitting them'],
    }
  }
  // Depth BEFORE Cedar sees the text: past ~130 levels the engine faults and
  // takes its own wasm instance with it, so every later parse in this process
  // fails too. A policy that deep is refused here as unparsable rather than
  // given to a parser that cannot come back from it. Not a fourth refusal
  // reason: a deployment's action is the same one `unparsable` already asks
  // for -- simplify or fix this policy -- and the taxonomy sorts by where to go
  // and fix, not by how the engine failed.
  const tooDeep = ids.flatMap((id) => {
    const depth = conditionDepth(policies[id] as string)
    return depth > MAX_CONDITION_DEPTH
      ? [`${id}: nests ${String(depth)} levels deep, and this build refuses anything past ${String(MAX_CONDITION_DEPTH)}`]
      : []
  })
  if (tooDeep.length > 0) return { ok: false, reason: 'unparsable', errors: tooDeep }

  // Per policy rather than over the whole set, so a refusal names the policy a
  // deployment has to fix. Cedar's own errors carry source offsets into
  // whichever text it was given, which are useless across a concatenated set.
  const errors = ids.flatMap((id) => {
    const asked = askCedar(() => checkParsePolicySet({ staticPolicies: { [id]: policies[id] as string } }), id)
    if (!asked.ok) return [asked.error]
    return asked.value.type === 'success' ? [] : asked.value.errors.map(error => `${id}: ${error.message}`)
  })
  if (errors.length > 0) return { ok: false, reason: 'unparsable', errors }

  const declared = new Set<string>(DSH_CONTEXT_KEYS)
  // Every offending key in the set, not the first: a deployment fixing a
  // policy set wants one pass, not one round trip per typo.
  const unknown = ids.flatMap((id) => {
    const asked = askCedar(() => policyToJson(policies[id] as string), id)
    // A policy that parsed above but cannot be rendered here is still unusable;
    // it reaches the caller through the same taxonomy rather than as a throw.
    if (!asked.ok) return [asked.error]
    const parsed = asked.value
    if (parsed.type !== 'success') return []
    return [...contextAttributes(parsed.json, new Set())]
      .filter(attr => !declared.has(attr))
      .map(attr => `${id}: reads context.${attr}, which no policy request carries`)
  })
  return unknown.length === 0
    ? { ok: true, policies }
    : { ok: false, reason: 'unknown-context-key', errors: unknown }
}
