# Agent Note: P4-13 — Reconciliation Engine & Saga Compensation
## Contract
- ReconciliationEngine: register CompensatableAction, reconcile, compensate, compensateAll
- SagaCoordinator: addStep, execute with rollback and compensation retry
- Irreversible actions marked for manual intervention
## Dependencies: P4-12, P7-02
