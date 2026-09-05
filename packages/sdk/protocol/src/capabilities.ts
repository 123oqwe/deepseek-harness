/**
 * Capability discovery and the mandatory/optional split (Epic P8-01).
 *
 * must[1] divides capabilities into mandatory and optional, and must[2]
 * requires an **unknown mandatory** capability to refuse the connection.
 * The direction matters and is easy to get backwards: the refusal is driven
 * by what the RECEIVER does not recognise, not by what the sender failed to
 * offer. A peer that demands a capability this build has never heard of is
 * asking for behaviour this build cannot provide, and proceeding would mean
 * agreeing to something neither side can name.
 *
 * An unknown OPTIONAL capability is ignored, which is what makes the split
 * worth having: it is the only thing that lets a newer peer offer something
 * extra without breaking an older one.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/capabilities
 */

/** A capability identifier, exchanged verbatim during the handshake. */
export type CapabilityId = string

/**
 * One capability a peer declares.
 *
 * `mandatory` is a property of the DECLARATION rather than of the capability
 * itself, because the same capability can be required by one peer and merely
 * offered by another — a client that cannot function without streaming
 * declares it mandatory, while a server that supports it declares it
 * optionally available.
 */
export interface CapabilityDeclaration {
  readonly id: CapabilityId
  readonly mandatory: boolean
}

/** Why capability negotiation refused the connection (must[2], acceptance[1]). */
export type CapabilityDenialReason =
  /** The peer requires a capability this build does not recognise at all. */
  | 'unknown-mandatory-capability'
  /** The peer requires a capability this build recognises but does not support. */
  | 'unsupported-mandatory-capability'

/** The outcome of matching a peer's declarations against local support. */
export type CapabilityNegotiationResult =
  | {
      readonly accepted: true
      /** Capabilities both sides support and will use. */
      readonly agreed: readonly CapabilityId[]
      /** Optional capabilities the peer offered that this build ignores, recorded rather than dropped. */
      readonly ignored: readonly CapabilityId[]
    }
  | {
      readonly accepted: false
      readonly reason: CapabilityDenialReason
      /** Exactly which capability caused the refusal, so the message is actionable. */
      readonly capability: CapabilityId
    }

/**
 * Match a peer's declared capabilities against what this build knows and
 * supports.
 *
 * Refuses on the FIRST mandatory failure rather than collecting all of them:
 * must[1]'s rule is fail-fast, and a connection refused for one reason is
 * refused. Reporting a list would suggest the peer could fix them
 * independently, when any single one is fatal.
 *
 * `known` and `supported` are separate inputs because must[2] distinguishes
 * them: a capability this build has never heard of is a different failure
 * from one it recognises and has deliberately not implemented, and a peer
 * can act on that difference — the first means version skew, the second
 * means a real gap.
 * @param declared - the peer's declarations.
 * @param known - every capability id this build recognises.
 * @param supported - the subset this build actually implements.
 * @returns the agreed set, or the first mandatory failure.
 */
export function negotiateCapabilities(
  declared: readonly CapabilityDeclaration[],
  known: ReadonlySet<CapabilityId>,
  supported: ReadonlySet<CapabilityId>,
): CapabilityNegotiationResult {
  const agreed: CapabilityId[] = []
  const ignored: CapabilityId[] = []
  for (const declaration of declared) {
    if (declaration.mandatory) {
      if (!known.has(declaration.id)) {
        return { accepted: false, reason: 'unknown-mandatory-capability', capability: declaration.id }
      }
      if (!supported.has(declaration.id)) {
        return { accepted: false, reason: 'unsupported-mandatory-capability', capability: declaration.id }
      }
      agreed.push(declaration.id)
      continue
    }
    // Optional: usable when supported, ignored otherwise. An unknown optional
    // capability is NOT an error — that is the whole point of the split.
    if (supported.has(declaration.id)) agreed.push(declaration.id)
    else ignored.push(declaration.id)
  }
  return { accepted: true, agreed, ignored }
}

/**
 * One capability a compatibility adapter downgrades (must[3]).
 *
 * An adapter may bridge a peer that lacks a capability, but must[3] requires
 * the downgrade to be recorded explicitly and enter the trace. This type is
 * how it becomes recordable: an adapter that downgrades silently cannot
 * produce one of these, so a run's provenance either names the downgrade or
 * no downgrade happened.
 */
export interface CapabilityDowngrade {
  readonly capability: CapabilityId
  /** Why the adapter downgraded it, for the trace. */
  readonly reason: string
  /** The adapter responsible, so a trace entry names an owner. */
  readonly adapter: string
}

/**
 * The negotiation outcome recorded on a run's provenance (acceptance[4]).
 *
 * Carries the agreed version, the agreed capabilities, and every downgrade,
 * so "what did these peers agree to" is answerable from the run record alone
 * rather than by replaying a handshake that no longer exists.
 */
export interface NegotiationProvenance {
  readonly protocolVersion: number
  readonly agreedCapabilities: readonly CapabilityId[]
  readonly ignoredCapabilities: readonly CapabilityId[]
  readonly downgrades: readonly CapabilityDowngrade[]
}
