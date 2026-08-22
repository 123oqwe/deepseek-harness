# Capability Scenario Suite

15 general-purpose capability scenarios that verify the Harness supports
multi-domain use cases without embedding vertical business logic in core.

## Lanes
- **deterministic**: scripted-model lane, must achieve >=99% success
- **real-model**: statistical lane, reports success rate/CI/cost/latency

## Worlds
1. code-world: code changes, diff, test
2. research-world: evidence research, citation
3. external-write-world: external side effects, idempotency
4. high-risk-world: high-risk financial simulation
5. long-run-world: 24h virtual long task
6. multi-agent-world: 50-agent coordination
7. malicious-plugin-world: plugin attack resilience
8. multi-tenant-world: tenant isolation
9. sdk-reconnect-world: SDK reconnection
10. provider-failover-world: model/provider failover
11. self-extension-world: self-extension governance
12. malicious-attachment-world: attachment security
13. crash-recovery-world: crash recovery
14. schedule-world: durable schedule/goal
15. human-approval-world: approval workflow
