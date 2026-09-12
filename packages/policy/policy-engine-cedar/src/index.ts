/**
 * The policy provider: one Cedar authorizer behind
 * `@deepseek-ai/dsh-policy-engine`'s decision vocabulary (Epic P2-05, the
 * Provider stage).
 *
 * Cedar owns the authorization semantics — forbid overrides permit, default
 * deny, and which policies matched. This module owns only what the harness
 * decides: how a `PolicyRequest` becomes a Cedar request, how Cedar's answer
 * becomes a {@link ClosedDecision}, and which failures are distinguishable
 * from a policy that said no.
 *
 * **Host only.** The wasm artifact is 13 MB and loads through the CommonJS
 * `nodejs` entry; a Client face must never mount this.
 * @module @deepseek-ai/dsh-policy-engine-cedar
 */

import { createHash } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { isAuthorized } from '@cedar-policy/cedar-wasm/nodejs'
import type { AuthorizationAnswer } from '@cedar-policy/cedar-wasm/nodejs'
import type { ActionTarget } from '@deepseek-ai/dsh-action-manifest'
import type {
  ClosedDecision,
  PolicyEvaluation,
  PolicyId,
  PolicyRequest,
  PolicySetDigest,
} from '@deepseek-ai/dsh-policy-engine'

/** Deployment configuration: the policies this deployment enforces. */
export interface Config {
  /**
   * The policy set, as a map from policy id to Cedar source.
   *
   * A MAP rather than one source string, and the difference is not stylistic:
   * submitted as a string, Cedar assigns generated ids (`policy0`, `policy1`)
   * and an `@id(...)` annotation in the source does NOT become the id the
   * explain reports — so an audit trail built on the string form would name
   * policies nobody wrote. must[3]'s audit is only as good as these ids.
   */
  readonly policies: Readonly<Record<string, string>>
}

/** Config schema. `policies` has no default: a deployment states its policy set. */
export const Config: z<Config> = z.object({
  policies: z.dict(z.string()).required(),
})

/**
 * How a `PolicyRequest` becomes the three Cedar entities.
 *
 * The mapping is this epic's, not Cedar's, and it is deliberately total: every
 * request produces a principal, an action and a resource, because a request
 * that could fail to map would be a policy question with no answer.
 * @param request - the harness's policy question.
 * @returns the Cedar entity uids and context.
 */
function toCedarRequest(request: PolicyRequest): {
  principal: { type: string; id: string }
  action: { type: string; id: string }
  resource: { type: string; id: string }
  context: Record<string, string | boolean | number>
} {
  return {
    principal: { type: 'Dsh::Principal', id: request.identity.id },
    // The capability the manifest names, not the tool name: two tools invoking
    // one capability are one authorization question.
    action: { type: 'Dsh::Action', id: request.manifest.capability },
    resource: { type: 'Dsh::Resource', id: targetId(request.manifest.target) },
    context: {
      sideEffectClass: request.manifest.sideEffectClass,
      // Declared vs defaulted, carried through because a policy that wants to
      // refuse unclassified actions cannot see the difference otherwise.
      classified: request.manifest.classified,
      workspaceTrust: request.facts.workspaceTrust,
      permissionPosture: request.facts.permissionPosture,
      // The action's own risk class, which the dispatch path computed before
      // asking. Without it the kernel hard-deny band was outside the domain of
      // every field Cedar received, so the base bundle could not state the one
      // rule it most wanted to (BLOCKED-187's residual, closed with
      // BLOCKED-201).
      riskClass: request.facts.riskClass,
      // The world's KIND, which is the discriminant a rule matches on:
      // `absent` when no registry is mounted or every provider refused the
      // requested confinement, `bound` when a world was minted for this
      // session. P3-01's Usage stage gave the type its second variant
      // (BLOCKED-178's producer half); this translation did not change, which
      // is what "a declared absence a policy can refuse on" was for.
      world: request.world.kind,
      tokenPresented: request.token !== undefined,
      // The token's CLAIMS, so a policy can decide by the authority actually
      // presented rather than only by whether one was. Never the token: an
      // engine holding it would hold an authority it could pass on.
      tokenCapability: request.token?.capability ?? '',
      tokenDelegationDepth: request.token?.delegationDepth ?? -1,
      tokenTenant: request.token?.tenant ?? '',
    },
  }
}

/**
 * The resource id one action target names.
 *
 * A discriminated union in, one string out: Cedar's resource is an entity id,
 * and the KIND has to survive into it or a filesystem path and a process
 * command with the same text would be one resource.
 * @param target - the manifest's action target.
 * @returns the Cedar resource id.
 */
function targetId(target: ActionTarget): string {
  switch (target.kind) {
    case 'filesystem': return `filesystem:${target.path}`
    case 'network': return `network:${target.host}`
    case 'process': return `process:${target.command}`
    case 'other': return `other:${target.ref}`
    /* v8 ignore next -- ActionTarget is a closed union owned by P2-03; a new
       variant fails here loudly rather than mapping to a wrong resource. */
    default: return assertNever(target)
  }
}

/**
 * Refuse an action target this build does not know.
 * @param value - the unhandled variant.
 * @returns never; always throws.
 */
function assertNever(value: never): never {
  throw new Error(`unhandled action target: ${JSON.stringify(value)}`)
}

/**
 * The digest of one policy set.
 *
 * Over the ids AND the sources, in sorted order: a set whose policies were
 * reordered is the same set, and a set where one policy's text changed is not.
 * Recorded on every decision so acceptance[1]'s replay can tell "the policy
 * changed" from "the decision changed".
 * @param policies - the id-to-source map.
 * @returns the digest.
 */
export function policySetDigest(policies: Readonly<Record<string, string>>): PolicySetDigest {
  const hash = createHash('sha256')
  for (const id of Object.keys(policies).sort()) {
    hash.update(`${id.length}:${id}${(policies[id] ?? '').length}:${policies[id] ?? ''}`)
  }
  return brandString<PolicySetDigest>(`sha256-${hash.digest('hex')}`)
}

/**
 * Read one Cedar answer as a closed decision plus its audit-only explain.
 *
 * Three outcomes are kept distinct, and keeping them distinct is the point: a
 * policy that said no (`forbidden-by-policy` / `no-matching-permit`), a policy
 * set that could not be read (`policy-set-invalid`), and an engine that is not
 * there at all (`policy-unavailable`, which the enforcement point answers
 * because this service is gone). Collapsing the middle one into an ordinary
 * deny would make a broken deployment look like a strict one, and a replay
 * could not tell them apart.
 *
 * Exported and pure because the `failure` branch is NOT reachable through
 * {@link CedarPolicyEngine.evaluate} on a loaded engine: the policy set is
 * validated at load, and the entity types are constants this module writes. It
 * is a fail-closed mapping for a state only a defect or a future Cedar could
 * produce, so it is proven here as a mapping rather than staged as a runtime
 * situation that cannot occur.
 * @param answer - what Cedar returned.
 * @param digest - the loaded policy set's digest, recorded on every decision.
 * @returns the closed decision and the audit-only explain.
 */
export function decisionFromAnswer(answer: AuthorizationAnswer, digest: PolicySetDigest): PolicyEvaluation {
  if (answer.type !== 'success') {
    return {
      decision: { effect: 'deny', reason: 'policy-set-invalid', policySet: digest },
      explain: { matched: [], diagnostics: answer.errors.map(error => error.message) },
    }
  }
  const matched = answer.response.diagnostics.reason.map(id => brandString<PolicyId>(id))
  const decision: ClosedDecision = answer.response.decision === 'allow'
    ? { effect: 'permit', policySet: digest }
    : {
      effect: 'deny',
      // Which refusal it was: a policy forbade it, or nothing permitted it.
      // Cedar reports the matched forbid in `reason`, so an empty list under a
      // deny is the default-deny case.
      reason: matched.length > 0 ? 'forbidden-by-policy' : 'no-matching-permit',
      policySet: digest,
    }
  return {
    decision,
    explain: {
      matched,
      diagnostics: answer.response.diagnostics.errors.map(error => `${error.policyId}: ${error.error.message}`),
    },
  }
}

/**
 * Mounts `ctx.policy`: a Cedar authorizer over the configured policy set.
 *
 * The set is validated AT LOAD, not at the first decision. A deployment whose
 * policies do not parse is a misconfiguration, and finding out at the first
 * tool call would mean the failure surfaces as a denied action rather than as
 * a refused boot.
 */
export default class CedarPolicyEngine extends Service {
  static readonly inject = []
  static readonly Config = Config

  /** The digest of the loaded set; every decision carries it. */
  readonly digest: PolicySetDigest

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'policy')
    this.digest = policySetDigest(config.policies)
    // Fails loud at load: a probe request against the configured set, whose
    // FAILURE answer means the set does not parse. Cedar has no separate
    // "validate this set" call that reports the same errors an authorization
    // would, so the check is an authorization whose decision is discarded.
    const probe = isAuthorized({
      principal: { type: 'Dsh::Principal', id: 'load-probe' },
      action: { type: 'Dsh::Action', id: 'load-probe' },
      resource: { type: 'Dsh::Resource', id: 'load-probe' },
      context: {},
      entities: [],
      policies: { staticPolicies: config.policies },
    })
    if (probe.type !== 'success') {
      throw new Error(
        `policy set does not parse, so no policy would be enforced: ${probe.errors.map(error => error.message).join('; ')}`,
      )
    }
  }

  /**
   * Answer one policy question.
   *
   * Three outcomes are kept distinct, and keeping them distinct is the point:
   * a policy that said no (`forbidden-by-policy` / `no-matching-permit`), a
   * policy set that could not be read (`policy-set-invalid`), and an engine
   * that is not there at all (`policy-unavailable`, which the enforcement
   * point answers because this service is gone). Collapsing the middle one
   * into a deny would make a broken deployment look like a strict one, and a
   * replay could not tell them apart.
   * @param request - the harness's policy question.
   * @returns the closed decision plus the audit-only explain.
   */
  evaluate(request: PolicyRequest): PolicyEvaluation {
    return decisionFromAnswer(
      isAuthorized({
        ...toCedarRequest(request),
        entities: [],
        policies: { staticPolicies: this.config.policies },
      }),
      this.digest,
    )
  }
}
