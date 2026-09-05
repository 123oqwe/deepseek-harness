/**
 * Version rules for registered workflow definitions (Epic P4-09 must[0],
 * validation[1], validation[2]).
 *
 * Registration pins a version to a digest, and neither may drift afterwards.
 * The rules here are about what a registry may accept, not about what a
 * definition means: nothing in this module reads a definition's body beyond
 * hashing it, so registering can no more execute code than loading can.
 *
 * @module @deepseek-ai/dsh-workflow-registry/version
 */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { DefinitionDigest, DefinitionName, RegisteredDefinition } from './types.ts'

/**
 * Compute a definition's digest from its body.
 *
 * Over the body alone, deliberately: the name and version are registry
 * bookkeeping, not content. Including them would give the same source two
 * digests under two names, and a run recorded against one could not be
 * recognized as the same work as a run recorded against the other.
 * @param body - the definition source, treated as opaque bytes.
 * @returns the content digest.
 */
export function computeDefinitionDigest(body: string): DefinitionDigest {
  return brandString<DefinitionDigest>(`sha256-${createHash('sha256').update(body, 'utf8').digest('hex')}`)
}

/** Why a registration was refused. */
export type RegistrationRefusalReason =
  /** The digest does not match the body being registered. */
  | 'digest-mismatch'
  /** This exact digest is already registered under this name. */
  | 'already-registered'
  /** The proposed version does not follow the name's current one. */
  | 'non-monotonic-version'
  /** A different body claims a version this name has already issued. */
  | 'version-reused'

/** The outcome of proposing a registration. */
export type RegistrationOutcome =
  | { readonly registered: true; readonly definition: RegisteredDefinition }
  | { readonly registered: false; readonly reason: RegistrationRefusalReason; readonly detail: string }

/**
 * Decide whether a proposed definition may be registered.
 *
 * The digest is recomputed from the body rather than trusted. A caller-supplied
 * digest that nobody checks would let a registration claim one identity and
 * store another, and every later resolution would be exact about the wrong
 * thing.
 *
 * Versions are monotonic per NAME, and a version already issued may not be
 * reused by a different body — that is what makes "version 3 of this workflow"
 * mean one thing forever. Re-registering an identical body is refused rather
 * than silently accepted, so a caller learns its registration was a no-op
 * instead of assuming it created something.
 * @param proposed - the definition being registered.
 * @param existing - every definition already registered under this name.
 * @returns the registration, or why it is refused.
 */
export function admitRegistration(
  proposed: RegisteredDefinition,
  existing: readonly RegisteredDefinition[],
): RegistrationOutcome {
  const actual = computeDefinitionDigest(proposed.body)
  if (actual !== proposed.digest) {
    return { registered: false, reason: 'digest-mismatch', detail: `${proposed.digest} vs ${actual}` }
  }
  if (existing.some(entry => entry.digest === proposed.digest)) {
    return { registered: false, reason: 'already-registered', detail: proposed.digest }
  }
  const highest = existing.reduce((max, entry) => Math.max(max, entry.version), 0)
  if (existing.some(entry => entry.version === proposed.version)) {
    return { registered: false, reason: 'version-reused', detail: `version ${proposed.version}` }
  }
  if (proposed.version !== highest + 1) {
    return { registered: false, reason: 'non-monotonic-version', detail: `expected ${highest + 1}, got ${proposed.version}` }
  }
  return { registered: true, definition: proposed }
}

/**
 * Whether an old run may resume against the definition now registered under
 * its name (validation[1]).
 *
 * Answers by digest, never by version. A run pinned to digest A does not
 * become resumable because a newer version exists under the same name — that
 * is a different definition, and resuming against it would run code the run
 * never referenced. Upgrading is a deliberate migration, not something a
 * version comparison authorizes.
 * @param runDigest - the digest the run recorded.
 * @param current - the definition currently registered under that name.
 * @returns whether the run may resume against `current` unchanged.
 */
export function canResumeAgainst(runDigest: DefinitionDigest, current: RegisteredDefinition): boolean {
  return runDigest === current.digest
}

/**
 * Whether a definition body declares a nested call to `name` (validation[2]).
 *
 * A textual check, and deliberately conservative: it looks for the name as a
 * quoted argument to a nesting call rather than parsing the script. Parsing
 * would mean building an evaluator, and acceptance[0] is that this package
 * must not become one. Over-reporting is the safe direction — a false positive
 * refuses a registration that a human then inspects, while a false negative
 * admits a definition that recurses forever at run time.
 * @param body - the definition source.
 * @param name - the definition name to look for.
 * @returns whether the body appears to nest `name`.
 */
export function declaresNestedCall(body: string, name: DefinitionName): boolean {
  return new RegExp(`workflow\\s*\\(\\s*['"\`]${name}['"\`]`, 'u').test(body)
}

/**
 * Whether registering `proposed` would create a self-recursive definition
 * (validation[2]).
 *
 * Refused at registration rather than left for the depth limit to catch. A
 * depth limit stops a runaway eventually, but it reports the same failure for
 * a definition that calls itself and for one that is merely deeply composed,
 * and those need different responses from an operator.
 * @param proposed - the definition being registered.
 * @returns whether it nests its own name.
 */
export function isSelfRecursive(proposed: RegisteredDefinition): boolean {
  return declaresNestedCall(proposed.body, proposed.name)
}
