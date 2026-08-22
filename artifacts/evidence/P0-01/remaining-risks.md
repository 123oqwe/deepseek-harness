# P0-01 Remaining Risks

- The git_sha in baseline.json will be one commit behind HEAD after amend due to the commit-includes-SHA paradox. This is informational; schema/manifest/bundle verification is the real check.
- Cross-platform (Linux) verification not yet performed; the fingerprint is deterministic by design but needs CI matrix confirmation.
- The first100 gate runner reports NOT_RUN for unimplemented phases (security, recovery, providers, protocol, capability, scale) — expected at Wave 1.
