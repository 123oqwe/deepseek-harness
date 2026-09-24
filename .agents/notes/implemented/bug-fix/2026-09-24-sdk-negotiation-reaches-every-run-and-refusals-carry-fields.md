# Agent Note: the SDK negotiation reaches every Run, no peer field is dropped, and a refusal carries its fields

Status: implemented

English | [中文](2026-09-24-sdk-negotiation-reaches-every-run-and-refusals-carry-fields.zh.md)

## Problem

P8-01's acceptance was withdrawn (BLOCKED-314), and P0-06 acceptance[1] was open, over gaps on the shipped SDK path:

- The clients lost fields. The Python client's `InitializeResponse` had no `protocolVersions` or `schemaFingerprint`, its `NegotiationProvenance` had no `downgrades`, and its models dropped every field they did not declare. The TS client handed its caller a constant `downgrades: []` and rebuilt the `initialize` result from the fields it knew.
- `SERVER_PROTOCOL_SURFACE`, the list the schema fingerprint hashes, was written by hand and had drifted from the server: it named `session.prompt` for the dispatched `session/prompt`, and omitted `shutdown`, `subagent.started`, `subagent.finished` and `human/question`.
- The server returned the agreed negotiation to the client, and nothing recorded it, so no Run carried a provenance (acceptance[4]).
- A refusal was only words in a message. The transport answered a handler failure with `-32603` and the error's message alone, so the server's version, capability and schema refusals lost their fields on the wire, and `initializeNegotiated` named the capabilities the server did not agree only in its message (acceptance[1]).

## Decision

- **Both clients keep what the peer sends.** The TS client reads `downgrades` from the wire and validates each entry; a missing list reads as `[]`, and a malformed one drops the negotiation whole, the same as the Python client. The result, `serverInfo`, `protocolVersions`, the negotiation with each downgrade, and `hostControl` with its stop record keep the keys the client does not model. In Python, `InitializeResponse` gains `protocolVersions` and `schemaFingerprint`, `NegotiationProvenance` gains `downgrades` as `CapabilityDowngrade` models, and every model of the reply allows extra fields.
- **The surface literal is corrected in place.** `SERVER_PROTOCOL_SURFACE` names `session/prompt` and `shutdown`, and its events are every message the server originates, including `human/question`, the one request it sends its peer. `shutdown` has no params type, so its schema id is the unregistered name `sdk-protocol:ShutdownRequest` (the delegate's ruling on A5). A case holds the list equal, both ways, to the methods `handleRequest` dispatches and the names the server sends. `spec/control-protocol.schema.json` is regenerated, and its fingerprint moves.
- **Refusals carry fields.** The transport's `-32603` answer carries the thrown value's own `data` property when it has one. The server's refusals set it: `reason`, `client` and `server` for a version refusal; `reason` and `capability` for a capability refusal; `code`, `schemaId`, `encounteredVersion` and `registeredVersion` for a schema refusal. `initializeNegotiated` rejects with an `SdkProtocolError` whose `data` is `{ reason: 'mandatory-capability-not-agreed', capabilities }`.
- **The Run records its provenance.** `RunService.recordProvenance` writes `Run.provenance` durably, once; a Run that already carries one keeps it (V4d). The SDK server keeps the handshake's negotiation for the connection and awaits `recordProvenance` for each session it creates. It reaches the Run Service by name (`runs`) through a local structural type, as it reaches the host user factory, so the server package takes no dependency on the run package. `RunPlugin.open` gives a subagent session's Run the provenance of the Run its parent agent is in, the one non-terminal Run its parent session opened. A finished Run of that session, which another connection may have opened, gives it none (blind review B1).

## Alternatives considered

- **Register a `ShutdownParams` wire schema for the surface entry (B6).** Not chosen: nothing requires a surface schema id to be registered, and each registration adds an identity migration that P0-06's registry-completeness order would have to cover (V11).
- **Derive the surface from the dispatcher.** Not chosen: the delegate ruled an in-place fix of the literal plus a case that compares both directions (V1).
- **Record provenance for ACP connections.** Not done: ACP's `initialize` ignores its params and negotiates nothing, so recording an outcome there would be a new provenance variant. The scope question went to the user as question 17.
- **Overwrite the provenance of a continued Run.** Not chosen: a Run keeps the negotiation it was opened under.

## Consequences

- Runs opened outside an SDK connection, over ACP or on the headless profile, carry no provenance. A composition that mounts no Run Service records none, and its handshakes still succeed.
- The shipped server produces no non-empty `downgrades`, because no compatibility adapter exists (must[3]). The client half is shown with a peer-sent list; the server half is proven with must[3] (BLOCKED-314 closing condition 1).
- A subagent's Run takes its parent's provenance in a write tracked after the Run opens, not before its first step.
- A version or capability refusal now shows an unauthenticated peer the server's own range or the refused capability as fields; the message already carried both.
