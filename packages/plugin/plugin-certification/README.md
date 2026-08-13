# @deepseek-ai/dsh-plugin-certification
Official plugin verifier and market trust levels.
## Overview
- 6 trust levels: L0-unknown → L1-inspected → L2-signed → L3-verified → L4-production → L5-kernel-trusted
- evaluateTrustLevel: checks → trust level
- createReport: plugin digest + checks → binding report
- isReportValidForLevel: check if report meets required level
## Key Invariants
- Market metadata cannot boost trust level
- Report binding digest tied to plugin digest
- Upgraded plugin invalidates old report
