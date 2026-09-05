/**
 * Protocol version negotiation for the SDK control protocol (Epic P8-01).
 *
 * The existing `initialize` handshake carries a per-message `schemaVersion`
 * negotiated through `@deepseek-ai/dsh-schema-registry`. That answers "can
 * this build read this message"; it does not answer "can these two peers work
 * together at all", which is what must[0] asks for and what a client needs
 * before it sends a task rather than after a field silently vanishes.
 *
 * This module adds that second question. A peer states the protocol version
 * RANGE it supports, and negotiation either yields one agreed version or a
 * machine-readable refusal (acceptance[1]) — never a partial agreement that
 * lets an unsupported field through as `undefined`.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/version
 */

/**
 * A protocol version. Integer-valued and monotonic: a version is a
 * compatibility generation, not a semantic-version triple, so "newer" is
 * decidable by comparison rather than by parsing.
 */
export type ProtocolVersion = number

/**
 * The inclusive range of protocol versions a peer supports.
 *
 * A range rather than a single version because acceptance[0] requires a
 * deterministic result in BOTH directions — a new client against an old
 * server and an old client against a new one — and only overlapping ranges
 * make that decidable without either side knowing the other's release order.
 */
export interface ProtocolVersionRange {
  readonly min: ProtocolVersion
  readonly max: ProtocolVersion
}

/** Why version negotiation failed, as a machine-readable code (acceptance[1]). */
export type VersionNegotiationDenialReason =
  /** The two ranges do not overlap at any version. */
  | 'no-overlapping-version'
  /** A range was inverted (`min` greater than `max`), so it describes no version at all. */
  | 'malformed-range'

/** The outcome of negotiating two peers' ranges. */
export type VersionNegotiationResult =
  | { readonly agreed: true; readonly version: ProtocolVersion }
  | {
      readonly agreed: false
      readonly reason: VersionNegotiationDenialReason
      /** Both ranges, so a refusal is diagnosable without re-running the handshake. */
      readonly client: ProtocolVersionRange
      readonly server: ProtocolVersionRange
    }

/**
 * Negotiate one protocol version from two supported ranges.
 *
 * Chooses the **highest** mutually supported version. Highest rather than
 * lowest because a version is a compatibility generation: picking the lowest
 * would silently hold both peers at the oldest shape either has ever
 * supported, which is how a capability quietly stops being used without
 * anyone deciding to stop using it.
 *
 * A malformed range is refused rather than normalised. An inverted range
 * describes no version, and repairing it would invent a claim the peer never
 * made.
 * @param client - the client's supported range.
 * @param server - the server's supported range.
 * @returns the agreed version, or a refusal naming both ranges.
 */
export function negotiateProtocolVersion(
  client: ProtocolVersionRange,
  server: ProtocolVersionRange,
): VersionNegotiationResult {
  if (client.min > client.max || server.min > server.max) {
    return { agreed: false, reason: 'malformed-range', client, server }
  }
  const version = Math.min(client.max, server.max)
  if (version < Math.max(client.min, server.min)) {
    return { agreed: false, reason: 'no-overlapping-version', client, server }
  }
  return { agreed: true, version }
}

/**
 * Whether a range describes at least one version.
 * @param range - the range to test.
 * @returns true when `min` is not greater than `max`.
 */
export function isWellFormedRange(range: ProtocolVersionRange): boolean {
  return range.min <= range.max
}
