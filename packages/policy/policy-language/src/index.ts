/**
 * Epic P2-10's policy vocabulary, and the Provider stage that puts a policy set
 * where a deployment can state one.
 *
 * The vocabulary is the whole of must[0]'s "finite declarative language" under
 * the delegate's ruling (b) of 2026-09-12: dsh does not define a second syntax
 * compiling to Cedar, because a second language would be a second trust root
 * and would re-verify the authorization semantics P2-05 already froze. What is
 * finite is the vocabulary a policy may name, and `./schema.ts` declares it.
 *
 * **This module registers the policy set as a settings namespace, and holds no
 * policy set of its own.** `@deepseek-ai/dsh-settings` already refuses a
 * section its owner cannot act on at registration and keeps a namespace's last
 * good value when a reload fails, which is both halves of validation[2]. A
 * second holder here would disagree with the namespace the first time a reload
 * failed, and from then on every recorded `policySet` digest would name a set
 * no operator could point at.
 * @module @deepseek-ai/dsh-policy-language
 */

import { getCedarVersion } from '@cedar-policy/cedar-wasm/nodejs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { compilePolicySet, type CompiledPolicySet } from './compiler.ts'
import { type PolicySetParse } from './parser.ts'
import { DSH_CONTEXT_KEYS } from './schema.ts'

export * from './schema.ts'
export * from './parser.ts'
export * from './compiler.ts'

/** The settings namespace a deployment states its policy set in. */
export const POLICY_SET_NAMESPACE = 'policy-set'

/** One deployment's stored policy section: Cedar sources keyed by policy id. */
export interface PolicySetSection {
  /** Policy id to Cedar source. The id is what an explain names, so it is the deployment's to choose. */
  readonly policies: Readonly<Record<string, string>>
}

/**
 * What the namespace resolves to: the stored policies, and the pin they were
 * accepted under.
 *
 * The pin is on the RESOLVED value rather than returned from a call, and that
 * is what makes a reload's effect observable: a document change that altered
 * the set shows as a changed pin on the namespace, where a caller comparing two
 * returns of `acceptPolicySet` would be comparing two things it computed itself.
 *
 * `pin` is absent exactly when the set was refused — and a refused set never
 * reaches a reader, because the registration's `validate` throws on it. Its
 * absence is therefore a resolve-time intermediate, never a state a consumer
 * observes.
 */
export interface PolicySetValue extends PolicySetSection {
  /** The digest this set was accepted under; see {@link acceptPolicySet}. */
  readonly pin?: string
}

/**
 * The namespace schema for one deployment's bounds.
 *
 * Built per registration rather than exported as a constant because the pin
 * binds the bounds' verdict: the schema cannot compute a pin without knowing
 * what this deployment admits.
 * @param bounds - the size this deployment admits.
 * @returns the schema resolving a stored section to its pinned value.
 */
export function policySetSchema(bounds: PolicySetBounds): z<PolicySetSection, PolicySetValue> {
  const stored: z<PolicySetSection> = z.object({ policies: z.dict(z.string()).default({}) })
  return z.transform(
    stored,
    (section: PolicySetSection): PolicySetValue => {
      const accepted = acceptPolicySet(section, bounds)
      return accepted.ok ? { policies: section.policies, pin: accepted.pin } : { policies: section.policies }
    },
    // `preserve` transforms the resolved value ONLY. Measured on the pinned
    // schemastery: without it, `Schema.resolve` also returns an ADAPTED value
    // carrying the pin, which is a second, storage-shaped copy of a derived
    // field. `@deepseek-ai/dsh-settings` persists the user section rather than
    // the adapted value, so today neither form would write a pin into a
    // deployment's document — the flag is set because a transform that produces
    // one output should produce one, not because a leak was observed.
    true,
  )
}

/** Why a policy set was refused for its size rather than its content. */
export type PolicySetBoundRefusal =
  /** More policies than this deployment admits. */
  | 'too-many-policies'
  /** More total Cedar source than this deployment admits. */
  | 'policy-set-too-large'

/**
 * What accepting a deployment's policy set produced.
 *
 * The bound refusals are declared HERE and not added to `PolicySetRefusal`,
 * deliberately: the Contract stage froze three refusals over a set's content,
 * and a set can be perfectly well-formed and still be too big. Growing the
 * frozen union after its freeze would also change what every existing observation
 * of it meant.
 */
export type PolicySetAcceptance =
  | CompiledPolicySet
  | Extract<PolicySetParse, { ok: false }>
  | { readonly ok: false; readonly reason: PolicySetBoundRefusal; readonly errors: readonly string[] }

/** The size a deployment admits for its policy set. */
export interface PolicySetBounds {
  /** Most policies one set may carry. */
  readonly maxPolicies: number
  /** Most total bytes of Cedar source one set may carry, summed over every policy. */
  readonly maxSourceBytes: number
}

/** Deployment configuration: what this deployment admits as a policy set. */
export interface Config extends PolicySetBounds {}

/**
 * Config schema.
 *
 * Both bounds are deployment-varying rather than protocol constants — a laptop
 * profile and a fleet control plane do not admit the same policy set — so they
 * are stated in cordis.yml and not as constants here. The defaults are the
 * smallest values that no observed deployment exceeds: the shipped base carries
 * two policies totalling under a kilobyte (`packages/bundle/base/cordis.patch.yml`).
 */
export const Config: z<Config> = z.object({
  maxPolicies: z.natural().default(256),
  maxSourceBytes: z.natural().default(1_048_576),
})

/** This plugin's name, as the Loader reports it. */
export const name = 'policy-language'

/**
 * Requires a settings provider rather than deferring to one.
 *
 * A harness that mounted this plugin without `settings` would register no
 * namespace, state no policy set, and enforce nothing — silently. Misconfiguration
 * fails loud at load, so the dependency is declared rather than probed.
 */
export const inject = ['settings']

/**
 * Accept a deployment's policy set: bound it, read it, and pin it.
 *
 * The order is bound, then parse, then compile, and it is the order a caller
 * would otherwise have to know. Bounding first because parsing a set is work
 * proportional to its size, and a set too large to admit should be refused
 * before that work is done rather than after.
 *
 * The engine version the pin binds is read from the engine (`getCedarVersion()`),
 * not configured: a configured version can disagree with the Cedar that will
 * actually evaluate these policies, and a pin that binds a version nothing used
 * is worse than no pin, because a replay would trust it.
 * @param section - the stored policy section.
 * @param bounds - the size this deployment admits.
 * @returns the compiled, pinned set, or the reason it was refused.
 */
export function acceptPolicySet(section: PolicySetSection, bounds: PolicySetBounds): PolicySetAcceptance {
  const ids = Object.keys(section.policies)
  if (ids.length > bounds.maxPolicies) {
    return {
      ok: false,
      reason: 'too-many-policies',
      errors: [`the policy set carries ${String(ids.length)} policies, and this deployment admits ${String(bounds.maxPolicies)}`],
    }
  }
  // Bytes rather than characters: the limit exists to bound what is held and
  // hashed, and a multibyte policy costs what its encoding costs.
  const bytes = ids.reduce((total, id) => total + Buffer.byteLength(section.policies[id] as string, 'utf8'), 0)
  if (bytes > bounds.maxSourceBytes) {
    return {
      ok: false,
      reason: 'policy-set-too-large',
      errors: [`the policy set carries ${String(bytes)} bytes of Cedar source, and this deployment admits ${String(bounds.maxSourceBytes)}`],
    }
  }
  return compilePolicySet(section.policies, {
    contextKeys: DSH_CONTEXT_KEYS,
    engineVersion: getCedarVersion(),
  })
}

/**
 * Register the policy set as a settings namespace.
 *
 * `validate` throws what `acceptPolicySet` refused, which is what makes the
 * refusal reach a deployment at the earliest point it can: a stored section
 * that is already unacceptable fails the registration itself, and one that
 * becomes unacceptable on a later reload leaves the previously accepted set in
 * force while every other namespace still commits. Neither behaviour is written
 * here — both are `@deepseek-ai/dsh-settings`', and this plugin's only
 * contribution to them is the function that says no.
 * @param ctx - the mounting context.
 * @param config - the size this deployment admits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.settings.register(POLICY_SET_NAMESPACE, policySetSchema(config), {
    validate: (value) => {
      if (value.pin !== undefined) return
      // The schema already ran `acceptPolicySet` and produced no pin, which is
      // the whole of "this set was refused". Re-running it here is the failure
      // path only, and it is what turns that fact back into the reason and the
      // offending ids a deployment has to act on.
      const accepted = acceptPolicySet(value, config)
      if (!accepted.ok) {
        throw new Error(`policy set refused (${accepted.reason}): ${accepted.errors.join('; ')}`)
      }
    },
  })
}
