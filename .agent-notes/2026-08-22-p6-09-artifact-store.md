## P6-09 Artifact Store Agent Note

## Status: IMPLEMENTED
## Date: 2026-08-22

## What was done
- Created packages/artifact/artifact/ with 3 source files + tests
- Created packages/artifact/artifact-local/ as local provider
- ArtifactStore: store, get, verify, list, getVersions
- LineageGraph: parent-child tracking, descendant checks
- Content-addressed by SHA-256
- 8 tests all passing

## Acceptance Criteria
- [x] Content digest is SHA-256
- [x] Same content creates new version
- [x] Lineage tracked for fork/snapshot
- [x] Tenant filtering enforced
- [x] Content verification

## Dependencies: P2-01, P6-08
