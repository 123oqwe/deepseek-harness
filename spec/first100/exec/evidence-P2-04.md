# P2-04 — Risk taxonomy and the dispatch risk gate

P2-04 is `ACCEPTED` with four GREEN cells. This page exists for one reason: another epic changed a function P2-04's cells rest on, and a reader should be able to check that from here rather than from that epic's commits.

## P2-05 changed `gateActionRisk`'s signature, and every frozen case still passes

`gateActionRisk` took a fifth parameter, an already-computed `ActionRiskClassification`, so the policy layer and the risk gate decide about one classification instead of each calling `classifyAction` for itself (BLOCKED-201). The gate still classifies for itself when the caller passes nothing, so a composition that only reaches the gate behaves exactly as before.

**Measured by case NAME across every live P2-04 frozen command, on the changed tree:**

| stage | command | frozen cases | not passing after |
| --- | --- | --- | --- |
| C | `vitest run packages/policy/risk-taxonomy` | 16 | 0 |
| P | `vitest run packages/policy/risk-taxonomy packages/interaction/permission-presets` | 7 | 0 |
| F | `vitest run packages/policy/risk-taxonomy` | 15 | 0 |
| P | `vitest run packages/mcp/mcp-client/tests/annotations.spec.ts` | 11 | 0 |
| U | `vitest run tests/architecture/risk-domain-tags.spec.ts packages/core/tools/tests/tools.spec.ts packages/interaction/permission-presets packages/policy/risk-taxonomy` | 11 | 0 |

All 60 live frozen case names still pass; the run was `230 passed, 0 failed`. Names rather than counts, because a count holds when one case is deleted and another added.

## What P2-04 does not gain from this

The classification is unchanged — the same rules, the same taxonomy, the same unknown default. What changed is where the verdict is computed and who else can see it: `riskClass` now reaches the policy request, so the kernel hard-deny band is stateable as a Cedar rule and the base bundle states it. That is P2-05's clause, not this epic's; P2-04 owns the classification that produces the value, not its delivery.
