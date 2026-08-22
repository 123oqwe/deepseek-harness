# P4-13 Remaining Risks
1. Compensation retry is simple (single retry); production may need exponential backoff.
2. Saga coordination is in-memory; durable saga state not yet wired to WorkflowJournal.
3. observeState/compensate are interface stubs; real provider integration pending.
