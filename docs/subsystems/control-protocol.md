# Control Protocol

The SDK runtime protocol uses newline-delimited JSON-RPC over stdio.

## Version Negotiation

At initialization, the client and server negotiate a protocol version. The server advertises its supported versions, and the client selects the highest compatible one.

## Capability Discovery

After version negotiation, the server advertises its capabilities. Each capability has a name, version, and whether it is optional.

## Schema Fingerprint

The protocol types are fingerprinted with SHA-256. Changes to the types produce a different fingerprint, enabling drift detection.
