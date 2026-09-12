/**
 * The Cedar schema dsh's own policy requests are shaped by (Epic P2-10
 * must[0]).
 *
 * **This declares what `toCedarRequest` already sends, and nothing else.** The
 * entity vocabulary was fixed in code by `@deepseek-ai/dsh-policy-engine-cedar`
 * long before it was written down; ruling (b) of 2026-09-12 is that dsh's
 * "finite declarative language" IS that vocabulary plus its conventions, not a
 * second syntax compiling to Cedar. A second syntax would be a second trust
 * root, and would re-verify the authorization semantics P2-05 already froze.
 *
 * **A schema wider than the request builder is the failure this file exists to
 * prevent**, and it is worth naming because it is quiet. Measured against
 * Cedar 4.12.0: a policy referencing a context key dsh never sends parses
 * clean, passes the provider's load probe, and then denies with no matched
 * reason on every decision — reporting itself only through
 * `PolicyExplain.diagnostics`, once per decision, after actions have already
 * been refused against a rule that was never going to match. Declaring a key
 * here that no request carries manufactures exactly that.
 * @module @deepseek-ai/dsh-policy-language/schema
 */

/** The principal entity type every dsh policy request names. */
export const DSH_PRINCIPAL_TYPE = 'Dsh::Principal'

/** The action entity type; its id is the manifest's capability, never a tool name. */
export const DSH_ACTION_TYPE = 'Dsh::Action'

/** The resource entity type; its id is a kind-qualified action target. */
export const DSH_RESOURCE_TYPE = 'Dsh::Resource'

/**
 * Every context key a dsh policy may read, in the order the request builder
 * writes them.
 *
 * Each one is justified by a line in `toCedarRequest`; the Contract stage's
 * drift case compares this list against a request that mapper actually built,
 * so the two cannot move apart in either direction.
 */
export const DSH_CONTEXT_KEYS = [
  /** The manifest's declared side-effect class. */
  'sideEffectClass',
  /** Whether that class was declared by the capability or reached by default. */
  'classified',
  /** The workspace's trust state. */
  'workspaceTrust',
  /** The session's permission posture. */
  'permissionPosture',
  /** The class the deployment's risk policy put this action in. */
  'riskClass',
  /** The execution world's KIND — `absent` or `bound` — never the world. */
  'world',
  /** Whether an authority was presented at all. */
  'tokenPresented',
  /** The presented token's capability claim, or `''` when none was presented. */
  'tokenCapability',
  /** The presented token's delegation depth, or `-1` when none was presented. */
  'tokenDelegationDepth',
  /** The presented token's tenant claim, or `''` when none was presented. */
  'tokenTenant',
] as const

/** One context key a dsh policy may read. */
export type DshContextKey = typeof DSH_CONTEXT_KEYS[number]
