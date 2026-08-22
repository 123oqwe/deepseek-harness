# Agent Note: P6-09 — Artifact Store, Versioning, Content Addressing & Lineage

## Problem
No first-class artifact store with versioning, content addressing, and lineage tracking.

## Contract
- ArtifactStore: store, get, verify, list, getVersions
- LineageGraph: parent-child tracking, descendant checks
- Content-addressed by SHA-256

## State Machine
stored → versioned → (retrieved|verified|lineage-tracked)

## Failure Semantics
- Content digest mismatch: verification fails
- Unknown artifact: get returns undefined

## Rejection
- Tenant mismatch: filtered from list
- Tampered content: verification fails
