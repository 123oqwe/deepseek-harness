# Agent Note: P1-05 — Plugin Static/Dynamic Security Scanner
## Problem
Curated lists only check repo age and metadata; cannot prove runtime behavior matches permission manifest.
## Contract
- staticScan: files + package.json → findings (child_process, eval, native, dynamic require, fs, net, postinstall)
- dynamicScan: observed behavior vs manifest declarations → undeclared findings
- 14 rules with blocking/review/informational severity, versioned
## State Machine
scan → findings → classify severity → pass/fail
## Failure Semantics
- Timeout: passed=false, timedOut=true (cannot be interpreted as pass)
- Crash: passed=false, crashed=true
- Benign code: no blocking findings
## Rejection
- Undeclared network/fs/process: blocking
- postinstall script: blocking
- Native addon: blocking
