# P0-05: Shadow/Enforce Feature Gates

## Problem
The existing config is profile/bundle/patch composition. There is no unified capability rollout state or migration observation mode, so old and new semantics can coexist without anyone knowing which is active.

## Contract
- Gate states: off, shadow (observe only), enforce (active)
- Each gate records owner, introducedVersion, defaultByProfile, removalVersion
- Override chain: bundle -> profile -> home -> CLI (last wins)
- Enforce -> off/shadow downgrade requires kernel admin permission
- Shadow mode records comparison events with sensitive parameter redaction
- Expired gates (removalVersion <= current) fail the release gate

## Failure Semantics
- Unknown gate: throws
- Duplicate registration: throws
- Downgrade without kernel admin: throws GateDowngradeError
- Expired gate: throws ExpiredGateError

## Compatibility
- New package: @deepseek-ai/dsh-feature-gates under packages/migration/
- Built-in gates: trust-kernel, policy-enforcement, run-journal
- No existing packages modified

## Rejection
- Not introducing vertical business logic
- Not replacing existing config system
