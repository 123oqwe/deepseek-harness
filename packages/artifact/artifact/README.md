# @deepseek-ai/dsh-artifact
First-class Artifact Store with versioning, content addressing, and lineage.
## Overview
- ArtifactStore: store, get, verify, list, getVersions
- LineageGraph: parent-child tracking, descendant checks
- Content-addressed by SHA-256
## Key Invariants
- Content digest is SHA-256
- Same content creates new version
- Lineage tracked for fork/snapshot
- Tenant filtering enforced
