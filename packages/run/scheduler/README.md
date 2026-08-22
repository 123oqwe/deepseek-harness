# @deepseek-ai/dsh-scheduler
Workflow budget, scheduler, backpressure, fairness, and resource locks.
## Overview
- TaskQueue: priority-based queue with FIFO for same priority
- ResourceLockManager: exclusive and shared locks with per-task release
- FairnessScheduler: tenant fairness with priority aging
- Scheduler: combines queue, locks, fairness, budget, backpressure
## Key Invariants
- 50 concurrent agents: no deadlock, no budget exceed, no cross-tenant starvation
- Same-resource writes serialized or conflict detected
- Cancel releases all locks and permits
