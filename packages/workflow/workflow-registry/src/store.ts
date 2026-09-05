/**
 * The definition registry: register, resolve, and answer what is current
 * (Epic P4-09 must[0], must[1]).
 *
 * `./version.ts` decides whether one registration is admissible. This is the
 * thing that holds them — the store a run resolves its digest against, and the
 * only place a definition's version history lives.
 *
 * It stores; it does not execute. A definition's body reaches this module as a
 * string and leaves as a string, so registering cannot run code any more than
 * loading can (acceptance[0]).
 *
 * @module @deepseek-ai/dsh-workflow-registry/store
 */

import { admitRegistration, isSelfRecursive } from './version.ts'
import { resolveDefinition } from './types.ts'
import type { RegistrationOutcome } from './version.ts'
import type {
  DefinitionDigest,
  DefinitionName,
  RegisteredDefinition,
  ResolveOutcome,
  RunDefinitionRef,
} from './types.ts'

/** Why the store refused a registration that `admitRegistration` would allow. */
export type StoreRefusalReason = 'self-recursive-definition'

/** The outcome of registering into a store. */
export type StoreOutcome =
  | RegistrationOutcome
  | { readonly registered: false; readonly reason: StoreRefusalReason; readonly detail: string }

/**
 * An in-memory registry of workflow definitions.
 *
 * Versions are tracked per NAME and definitions are addressed by DIGEST, which
 * are two different indexes over the same values rather than two stores. A
 * single index keyed by name could not answer a run's digest lookup, and one
 * keyed by digest could not enforce version monotonicity.
 */
export class DefinitionRegistry {
  private readonly byDigest = new Map<DefinitionDigest, RegisteredDefinition>()
  private readonly byName = new Map<DefinitionName, RegisteredDefinition[]>()

  /**
   * Register a definition, refusing anything `admitRegistration` refuses and
   * anything self-recursive (validation[2]).
   *
   * Recursion is refused HERE rather than left to `admitNestedRun`, so a
   * definition that calls itself never enters the registry at all. Catching it
   * at run time would mean the definition had already been stored, shipped,
   * and started before anyone learned it cannot terminate.
   * @param proposed - the definition to register.
   * @returns the registration, or the reason it was refused.
   */
  register(proposed: RegisteredDefinition): StoreOutcome {
    if (isSelfRecursive(proposed)) {
      return { registered: false, reason: 'self-recursive-definition', detail: proposed.name }
    }
    const outcome = admitRegistration(proposed, this.byName.get(proposed.name) ?? [])
    if (!outcome.registered) return outcome
    this.byDigest.set(proposed.digest, proposed)
    this.byName.set(proposed.name, [...(this.byName.get(proposed.name) ?? []), proposed])
    return outcome
  }

  /**
   * Resolve the definition a run refers to (must[1]).
   * @param ref - the run's recorded reference.
   * @returns the definition, or why it could not be resolved.
   */
  resolve(ref: RunDefinitionRef): ResolveOutcome {
    return resolveDefinition(ref, this.byDigest)
  }

  /**
   * The definition currently registered under a name, if any.
   *
   * "Current" means highest version, which is why versions must be monotonic:
   * without that guarantee this method would have no defensible answer, and a
   * caller asking for the latest workflow would get whichever was registered
   * most recently by wall clock.
   * @param name - the definition name.
   * @returns the highest-versioned definition under that name.
   */
  current(name: DefinitionName): RegisteredDefinition | undefined {
    const versions = this.byName.get(name)
    if (versions === undefined || versions.length === 0) return undefined
    return versions.reduce((highest, entry) => (entry.version > highest.version ? entry : highest))
  }

  /**
   * Every version registered under a name, oldest first.
   *
   * Returned as a copy: a caller holding the store's own array could reorder
   * or truncate the version history, and `current()` would then answer from a
   * mutated list.
   * @param name - the definition name.
   * @returns the version history, oldest first.
   */
  history(name: DefinitionName): readonly RegisteredDefinition[] {
    return [...(this.byName.get(name) ?? [])]
  }
}
