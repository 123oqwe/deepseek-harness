# Control protocol

English | [中文](control-protocol.zh.md)

The SDK control protocol is the JSON-RPC surface between an SDK client and the harness runtime. This page owns the negotiation rules; the message shapes themselves live with their types in `@deepseek-ai/dsh-sdk-protocol`.

## Two negotiations, answering different questions

The protocol negotiates twice, and conflating them is the mistake this page exists to prevent.

**Per-message schema negotiation** (`InitializeParams.schemaVersion`, resolved through `@deepseek-ai/dsh-schema-registry`) answers *can this build read this message*. It is scoped to one message shape and says nothing about the peer as a whole.

**Protocol version negotiation** (`InitializeParams.protocolVersions`) answers *can these two peers work together at all*. A client needs that answer **before** it sends a task, not after a field it depended on has silently gone missing.

## Version ranges

Each peer states an inclusive range it supports. Negotiation returns the **highest** mutually supported version, or refuses with a machine-readable reason carrying both ranges.

Highest rather than lowest is deliberate. A version is a compatibility generation, so choosing the lowest would hold both peers at the oldest shape either has ever supported — which is how a capability stops being used without anyone deciding to stop using it.

The rule is symmetric: swapping client and server never changes the agreed version. An asymmetric rule would give two peers different answers about the same pair, and each would be locally consistent while they disagreed.

A range whose `min` exceeds its `max` describes no version. It is refused rather than normalised, because repairing it would invent a claim the peer never made.

## Mandatory and optional capabilities

A peer declares capabilities, each marked mandatory or optional. `mandatory` is a property of the **declaration**, not of the capability: the same capability may be required by one peer and merely offered by another.

An unrecognised **mandatory** capability refuses the connection. An unrecognised **optional** one is ignored and recorded — that asymmetry is the entire purpose of the split, and it is what lets a newer peer offer something extra without breaking an older one.

Two refusal reasons are kept distinct because a peer can act on the difference:

| Reason | Meaning |
|---|---|
| `unknown-mandatory-capability` | this build has never heard of it — version skew |
| `unsupported-mandatory-capability` | this build knows it and does not implement it — a real gap |

Negotiation fails fast on the first mandatory failure. Any single one is fatal, so reporting a list would suggest they could be fixed independently.

## Schema fingerprints

A build's fingerprint covers its **wire-visible shape**: method and event names with each one's schema id and version, plus the addressable resource types. Nothing else.

Two requirements pull against each other here, and the boundary is drawn where they meet. The fingerprint must be stable for a given build, so declaration order — which no peer can observe — does not move it; a fingerprint that reported drift for a refactor would report false drift, and one that cries wolf stops being consulted. It must also move whenever protocol behaviour changes, so a version bump, an added method, a removed resource type, or the same name moving between the method and event kinds all change it.

Fields are length-prefixed before hashing. Without that, a method named `a:b` and a pair of methods `a` and `b` could produce the same digest.

## Absence is not agreement

Every negotiation field is optional on the wire, and its absence means *this peer predates negotiation* — never *this peer agreed to nothing*.

The distinction is load-bearing. A client that read a missing `negotiation` as an empty agreement would refuse every older server; one that read it as a successful agreement to nothing would proceed with capabilities neither side confirmed. Both are the silent field loss the protocol exists to prevent, in opposite directions.

For the same reason the client validates these fields rather than trusting them: at a wire boundary the static type states only what the peer claimed. A malformed range is dropped, taking the same path as an absent one, and a partially-formed negotiation is dropped whole — a half-read agreement is worse than none, because a caller would treat the fields that did arrive as authoritative.

## Provenance

The negotiated outcome — agreed version, agreed capabilities, ignored capabilities, and any adapter downgrades — is recorded on the run. *What did these peers agree to* is then answerable from the run record alone, without replaying a handshake that no longer exists.

A compatibility adapter may bridge a peer that lacks a capability, but each downgrade it performs must be recorded with its reason and the adapter responsible. An adapter that downgraded silently could not produce such a record, so a run's provenance either names the downgrade or none occurred.
