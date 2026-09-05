/**
 * Registered workflow definitions and nested-run limits (Epic P4-09).
 *
 * A workflow definition is registered as a versioned artifact and a run refers
 * to it by digest, never by name. That indirection is the point: a name can be
 * repointed at different code, so a run recorded against a name cannot be
 * reproduced, while a run recorded against a digest either resolves to the
 * exact definition it used or resolves to nothing.
 *
 * **Loading a definition never executes it (acceptance[0]).** Everything here
 * treats a definition's body as opaque data. Nothing in this module parses,
 * evaluates, or instantiates it, so the question "could loading run
 * unverified code" has the same answer for every input.
 *
 * @module @deepseek-ai/dsh-workflow-registry/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
// `WorkflowRunId` is the WORKFLOW package's concept -- a run of a workflow --
// and is imported rather than redeclared here. An identically-branded copy
// would be structurally assignable, so `tsc` would never object; the only
// thing that noticed the duplicate was the Cordis catalog dropping the type,
// and regenerating the catalog would have silenced the one report of it.
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow'

/** A registered definition's content digest; the only stable way to name one. */
export type DefinitionDigest = Branded<'DefinitionDigest'>

/** A human-facing definition name, which may be repointed over time. */
export type DefinitionName = Branded<'DefinitionName'>

/** Who signed a registered definition; recorded, never verified here. */
export type SignerIdentity = Branded<'SignerIdentity'>

/**
 * A registered workflow definition.
 *
 * `body` is `string` rather than a parsed form because this package must never
 * be the thing that turns a definition into code. A parsed field would invite
 * a loader to evaluate it, and acceptance[0] is precisely that loading must
 * not.
 */
export interface RegisteredDefinition {
  readonly digest: DefinitionDigest
  readonly name: DefinitionName
  /** Monotonic per name; a new registration under one name increments it. */
  readonly version: number
  /** The definition's source, treated as opaque data. */
  readonly body: string
  /** The signer this registration claims; recorded for provenance, unverified. */
  readonly signer: SignerIdentity
}

/**
 * What a run records about the definition it used (must[1]).
 *
 * Carries the digest AND the name. The digest is what makes the run
 * reproducible; the name is what makes a report readable. Recording only the
 * name would lose reproducibility, and recording only the digest would make
 * every operator resolve a hash to understand a run.
 */
export interface RunDefinitionRef {
  readonly runId: WorkflowRunId
  readonly digest: DefinitionDigest
  readonly name: DefinitionName
  readonly version: number
}

/** Why a definition could not be resolved for a run. */
export type ResolveFailureReason =
  /** No definition with that digest is registered. */
  | 'unknown-digest'
  /** The digest resolves, but to a definition registered under another name. */
  | 'name-digest-mismatch'

/** The outcome of resolving a run's definition reference. */
export type ResolveOutcome =
  | { readonly resolved: true; readonly definition: RegisteredDefinition }
  | { readonly resolved: false; readonly reason: ResolveFailureReason }

/**
 * Resolve the definition a run refers to.
 *
 * The name is checked as well as the digest. A digest that resolves to a
 * definition registered under a different name means the run's own record is
 * internally inconsistent, and proceeding would execute something the run does
 * not claim to be running — reported as a distinct reason so an operator is
 * not sent looking for a missing artifact.
 * @param ref - the run's recorded reference.
 * @param registered - definitions available, keyed by digest.
 * @returns the definition, or why it could not be resolved.
 */
export function resolveDefinition(
  ref: RunDefinitionRef,
  registered: ReadonlyMap<DefinitionDigest, RegisteredDefinition>,
): ResolveOutcome {
  const definition = registered.get(ref.digest)
  if (definition === undefined) return { resolved: false, reason: 'unknown-digest' }
  if (definition.name !== ref.name) return { resolved: false, reason: 'name-digest-mismatch' }
  return { resolved: true, definition }
}

/** The resources a run may consume, inherited and decayed by nested runs. */
export interface RunBudget {
  /** How deep this run sits; the root is 0. */
  readonly depth: number
  /** Remaining agent calls across this run and everything it spawns. */
  readonly agentsRemaining: number
  /** Remaining token budget, shared with descendants. */
  readonly tokensRemaining: number
}

/** Static limits a nested run must stay inside (acceptance[3]). */
export interface NestingLimits {
  readonly maxDepth: number
  readonly maxTotalAgents: number
  readonly maxTotalTokens: number
}

/** Why a nested run was refused. */
export type NestingDenialReason =
  | 'max-depth-exceeded'
  | 'agent-budget-exhausted'
  | 'token-budget-exhausted'
  /** The definition being nested is already on the ancestor chain. */
  | 'recursive-definition'

/** The outcome of admitting a nested run. */
export type NestingDecision =
  | { readonly admitted: true; readonly childBudget: RunBudget }
  | { readonly admitted: false; readonly reason: NestingDenialReason }

/**
 * Decide whether a parent may start a nested run, and with what budget
 * (must[3], acceptance[3]).
 *
 * Recursion is detected structurally, by looking for the child's digest on the
 * ancestor chain, rather than by waiting for a depth limit to stop it. A depth
 * limit does eventually halt a recursive definition, but it halts every deep
 * composition the same way — an operator would see "too deep" for a workflow
 * that is merely large and for one that calls itself forever, and those need
 * different responses.
 *
 * The child's budget DECAYS: it receives what remains, minus the call that
 * started it. Passing the parent's budget through unchanged would let a tree
 * of nested runs each believe it holds the full allowance, and the total would
 * be bounded by nothing.
 * @param parent - the parent run's remaining budget.
 * @param childDigest - the definition the parent wants to nest.
 * @param ancestors - digests already on the chain, root first.
 * @param limits - the deployment's static ceilings.
 * @returns the child's budget, or why nesting is refused.
 */
export function admitNestedRun(
  parent: RunBudget,
  childDigest: DefinitionDigest,
  ancestors: readonly DefinitionDigest[],
  limits: NestingLimits,
): NestingDecision {
  if (ancestors.includes(childDigest)) return { admitted: false, reason: 'recursive-definition' }
  if (parent.depth + 1 > limits.maxDepth) return { admitted: false, reason: 'max-depth-exceeded' }
  if (parent.agentsRemaining <= 0) return { admitted: false, reason: 'agent-budget-exhausted' }
  if (parent.tokensRemaining <= 0) return { admitted: false, reason: 'token-budget-exhausted' }
  return {
    admitted: true,
    childBudget: {
      depth: parent.depth + 1,
      agentsRemaining: Math.min(parent.agentsRemaining - 1, limits.maxTotalAgents),
      tokensRemaining: Math.min(parent.tokensRemaining, limits.maxTotalTokens),
    },
  }
}
