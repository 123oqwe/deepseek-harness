# Agent Note: P7-02 — EvidenceCollector
## Problem
No content-addressed, traceable, tamper-evident evidence layer.
## Contract
- EvidenceCollector: collect, verify, bundle
- EvidenceStore: store, get, getByRun
- checkInvariants, isTamperEvident
## State Machine
collect → verify → bundle → store → (verified|tampered)
## Failure Semantics
- Content digest mismatch: verification fails
- Bundle digest mismatch: tamper detected
- Duplicate evidence: invariant violation
## Rejection
- Tampered bundle: rejected
- Invalid digest: rejected
