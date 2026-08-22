# P0-07: Release Evidence Package

## Problem
The repo has strict unit/coverage testing, but no unified release evidence manifest to prove which tests were run, on which commit, with what config and dependencies.

## Contract
- collect-evidence.mjs runs a command, captures exit code, stdout/stderr digests, timestamps
- verify-evidence.mjs checks package digest, gate results, artifact digests, baseline fingerprint
- Any skipped blocking gate or missing artifact prevents accepted=true
- Package digest is SHA-256 of the sorted-key JSON

## Failure Semantics
- Missing package: "evidence package not found"
- Tampered digest: "package digest mismatch"
- Failed gate: "blocking gate '<name>' failed"
- Missing artifact: "build artifact missing"

## Compatibility
- New package: @deepseek-ai/dsh-evidence-format
- New scripts: collect-evidence.mjs, verify-evidence.mjs
- New npm scripts: evidence:collect, evidence:verify
- No existing packages modified
