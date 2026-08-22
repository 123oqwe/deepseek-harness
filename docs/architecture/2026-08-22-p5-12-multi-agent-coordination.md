# Agent Note: P5-12 — Multi-Agent Coordination, Worktree Isolation & Router Regret
## Problem
Multi-agent coordination without deadlock detection, worktree isolation, or router regret evaluation.
## Contract
- CoordinationGuard: lock acquire/release, deadlock detection
- WorktreeProvider: isolated worktree creation
- RouterRegretEvaluator: routing decision regret scoring
## State Machine
lock → acquire → (release|deadlock)
## Failure Semantics
- Deadlock: detected via cycle
- Path conflict: detected
- Router regret: measured
## Rejection
- Resource locked by another: rejected
- Path conflict: detected
