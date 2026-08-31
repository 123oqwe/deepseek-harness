# Agent Note: First-100 R0 gate — real acyclicity, typed evidence, fail-closed items

Status: implemented

English | [中文](2026-08-25-first100-r0-gate-real-dag-typed-evidence.zh.md)

## Problem

The `--r0-gate` in `scripts/first100/generate-specs.ts` was an incomplete gate.
It checked only four items (same-wave conflicts, unassigned owners, pending
layer adjudication, unapproved thresholds) and read the threshold count from the
base registry instead of composing the adjudication overlay, so even a future
threshold approval could never clear it. The rendered dependency graph
hardcoded `acyclic: true` with no real topological sort, and every evidence
schema key was emitted as `type: string` — a presence-only schema that could not
reject forged observations. A fixed-SHA reviewer audit rejected the candidate
for these reasons.

## Decision

`scripts/first100/generate-specs.ts` now computes, rather than assumes, all
three things:

- **Real DAG analysis (`computeDag`).** Kahn's topological sort with a
  lexicographic frontier plus a DFS back-edge search returns `acyclic`, a
  concrete `cycle`, `missingPredecessors`, and `sameWavePredecessors`. The
  dependency-graph artifact's `acyclic` field is that computed result. Negative
  spec tests inject a cycle, a missing predecessor, and a same-wave predecessor
  into a mutated registry and assert each is detected.
- **Typed evidence schema (`evidenceProperty`).** Each key is constrained to its
  real shape: `id` is `P[0-8]-\d{2}`, `lane` is a closed 4-value enum,
  `baselineSha` is `const`-pinned to the frozen baseline with a hex40 pattern,
  `command` is non-empty, `exitCode` is an integer coupled to `exitSemantics` by
  a top-level `allOf` (ACCEPTED → 0, FAIL → ≥ 1, NOT_RUN/BLOCKED → null),
  `rawLogPath` is confined to `.artifacts/first100/observations/` without
  traversal, `rawLogSha256` and `signature` are hex digests (64 and 64+),
  `testCounts` is an object with `total > 0`, `worldStateBefore/After` reject
  `"unobserved"`, `skipReason` must be empty, and `exitSemantics` is a closed
  enum. A spec test asserts each constraint is encoded in the rendered schema.
- **Fail-closed `--r0-gate`.** `R0GateSummary` adds `layerSourceGap`,
  `agentBUncertainties`, `unsignedEnvelope`, and `missingCommandEpics` (91
  MISSING_UNTIL_WAVE today). Thresholds compose the overlay
  (`adj.thresholds.status === 'APPROVED'` → 0). The gate exits 1 until every
  item is resolved AND the v1.1 envelope is SIGNED. Signing is the maintainer's
  attestation that the external-evidence slices — R0.3A clean-branch CI/pack,
  R0.3B packaging migration ledger, R0.4 runner dry-validation — are complete;
  the generator cannot verify them from committed state alone, so the signed
  envelope is the required seam. `remainingPending` in the manifest composes
  thresholds the same way.
- **Per-row manifest test.** The manifest test parses the YAML with js-yaml and
  compares each epic row `id → layerStatus → canonicalOwner → humanAssignee`
  against the composed base+adjudication state, instead of asserting each value
  merely occurs somewhere in the file.

## Alternatives considered

**Keep the hardcoded `acyclic: true`.** Rejected: the test that asserted it was
self-fulfilling. A real topological sort is the only honest source for the flag.

**Validate the rendered schema with ajv in the generator test.** Rejected:
`ajv` is not a dependency, and adding one for a test ripples the lockfile and
CI. The structural test proves the constraints are encoded; R0-4's runner will
validate observations against the schema with a real validator.

**Have the generator verify R0.3A/R0.3B/R0.4 directly.** Rejected: the
generator reads only the committed registry and overlay; those external
processes cannot be verified from that state. Requiring a SIGNED envelope makes
the maintainer's attestation of them a hard gate.

**Treat the 91 MISSING_UNTIL_WAVE commands as non-blocking.** Rejected: the R0
exit gate's "no missing commands" item must stay red until the maintainer
explicitly resolves the command policy in R0-7. The gate reports and fails.

## Consequences

`--r0-gate` cannot self-pass while any R0 item is unresolved; the evidence
schema is enforceable against forged observations. The committed
dependency-graph, manifest, and thresholds artifacts are byte-identical
(`acyclic` is still `true`, thresholds still 17); only the evidence schema and
generated digests changed. R0-4's runner must emit observations satisfying the
typed schema and accept ACCEPTED only on exit code 0 with a verified detached
attestation.
