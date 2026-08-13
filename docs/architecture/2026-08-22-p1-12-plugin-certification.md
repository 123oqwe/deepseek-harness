# Agent Note: P1-12 — Official Plugin Verifier & Market Trust Levels
## Problem
GitHub topics, awesome lists, and dsh-market improve discovery but are not security roots.
## Contract
- 6 trust levels: L0-L5
- evaluateTrustLevel: checks → level
- createReport: digest + checks → binding report
- isReportValidForLevel: check if report meets required level
## State Machine
checks → evaluate → level → (valid|insufficient)
## Failure Semantics
- Market metadata cannot boost trust
- Report binding tied to plugin digest
- Upgraded plugin invalidates old report
## Rejection
- Report with wrong digest: rejected
- Insufficient trust level for production: rejected
