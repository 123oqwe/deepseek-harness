# Agent Note: P2-11 — Permission Preset → Complete Policy Profile
## Problem
Current preset only combines filesystem sandbox + approval policy; doesn't cover network, process, secrets, external writes, plugin trust, budget, or retention.
## Contract
- PolicyProfile: execution world, fs/network/process/secrets, risk thresholds, approval rules, plugin trust, budget, retention
- 4 predefined: observe-only, workspace-safe, team-standard, production-controlled
- kernelHardDenyDisabled must be false
## State Machine
selected → validated → active → (downgrade|upgrade)
## Failure Semantics
- kernelHardDeny disabled: rejected
- L0/L1 plugin trust for production: rejected
- Invalid budget: rejected
## Rejection
- Profile that disables kernel hard deny: rejected
- Profile with L0-unknown plugin trust: rejected
