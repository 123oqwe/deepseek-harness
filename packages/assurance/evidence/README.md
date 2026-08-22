# @deepseek-ai/dsh-evidence
EvidenceCollector: content-addressed, traceable, tamper-evident evidence layer.
## Overview
- EvidenceCollector: collect, verify, bundle
- EvidenceStore: store, get, getByRun
- checkInvariants: duplicate detection, digest validation
- isTamperEvident: digest length check
## Key Invariants
- Content-addressed by SHA-256
- Bundle digest = sorted item digests
- Tamper detection via digest comparison
