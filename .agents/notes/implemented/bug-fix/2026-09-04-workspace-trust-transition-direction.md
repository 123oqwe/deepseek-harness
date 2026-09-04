# Agent Note: Each workspace trust transition performs only its own direction

Status: implemented

English | [中文](2026-09-04-workspace-trust-transition-direction.zh.md)

## Problem

`@deepseek-ai/dsh-workspace-trust` splits the two trust transitions registry epic P1-07 names into two functions: `requestTrustUpgrade` raises a workspace's `TrustState` under must[2]'s host-user gate and produces the audit record must[2] requires, and `downgradeTrust` lowers it and computes exactly which `ProjectContentKind`s the lowering revokes (acceptance[2]). Neither function checked which direction it was being asked to perform, and the two omissions composed into a way to reach `'trusted-execute'` without must[2]'s authorization at all.

`downgradeTrust` wrote `target` verbatim. Handed a raising `target` it returned a record at `'trusted-execute'` with no `Principal`, no `isHostUserPrincipal` check and no `TrustUpgradeAuditRecord` — must[2]'s authorization bypassed through acceptance[2]'s own entry point — and reported `revokedKinds: []` while doing so, which is true and reads as benign.

`requestTrustUpgrade` had the mirror-image gap and it is the half that made the first one usable. It gated on the requester being a host user and then wrote `target` verbatim too, so a lowering `target` produced `upgraded: true`, an audit record describing a demotion, and — the load-bearing part — `grantedBy` stamped onto an `'untrusted'` record, which `types.ts` states carries no grantor. That record is exactly the input the raising `downgradeTrust` call then lifted to `'trusted-execute'` carrying a stale grantor, so the resulting state looked authorized by a real host user who had authorized something else.

Reachability, stated so neither reading is invited. `downgradeTrust` had no production caller when the defect was found, so no live exploit existed; the fix closes a shipped export, not an observed incident. `requestTrustUpgrade`'s lowering path was and is reachable: `WorkspaceEntity.upgradeTrust` (`packages/workspace/workspace/src/entity.ts`) passes `target` through untouched, so `upgradeTrust(ws, 'untrusted', hostUser)` really did mint the untrusted-with-grantor record. A state-machine transition that raises trust with no principal, no host-user check and no audit record is a defect in a shipped export whatever calls it today, and the composition is why neither half is the finding on its own.

## Decision

One internal `TRUST_STATE_RANK` (`'untrusted'` 0, `'trusted-read'` 1, `'trusted-execute'` 2) orders the states so a transition can be told apart from its reverse. `requestTrustUpgrade` refuses a `target` that does not raise `current.state` with a new `TrustUpgradeDenialReason` member, `'not-an-upgrade'`. `downgradeTrust` throws when `target` is above `current.state`. A same-state `downgradeTrust` call is still admitted: it grants no capability and revokes nothing. The host-user check stays first, so a non-`'user'` principal is still refused with `'non-host-principal'` whichever direction it asked for.

Neither function is a second entry point for the other's transition. Raising a workspace's trust is `requestTrustUpgrade`'s transition alone, and it cannot happen without must[2]'s host-user check and audit record.

### Why the refusal shapes differ

`downgradeTrust` throws while `requestTrustUpgrade` returns a refusal, and this repository's own rule against unexplained asymmetry between parallel values means the reason has to be readable at both sites rather than only here — both functions' JSDoc carries it.

The asymmetry is a consequence of an already-frozen surface, not a design preference. `TrustUpgradeResult` is already a discriminated union whose refusal member gains only a new reason, so refusing through the result costs nothing. `TrustDowngradeResult` is a plain record whose callers read `record` and `revokedKinds` directly; giving it a refusal member means widening it into a discriminated union, which changes the type every existing caller destructures. That is a Contract change with its own re-freeze, and it is not what a fault-stage bug fix may take unannounced. Resolving the asymmetry the other way remains available, at that price.

## Testing

`packages/workspace/workspace-trust/tests/trust.spec.ts` covers both directions: two cases that a raising `downgradeTrust` target is refused — one of them presenting the untrusted-with-grantor record the other half used to manufacture, so the composition itself is pinned — and one that a lowering `requestTrustUpgrade` target is refused rather than reported as an upgrade.

The load-bearing case is the fourth: every refusal returns neither a `record` nor an `audit`, asserted across every `TrustUpgradeDenialReason` rather than only the one this fix added. The other three cases are each satisfiable by a single-point implementation that fixes exactly the transition it names; this one is what keeps a reason added later from reintroducing the record that made the composition work.

Both directions are proven by mutation. Deleting the direction check from `downgradeTrust` reddens exactly its two cases and leaves the upgrade cases green; deleting it from `requestTrustUpgrade` reddens exactly the lowering case and the every-reason case and leaves the downgrade cases green. Every case is pure over hand-built `WorkspaceIdentity` values — no `fs.stat`, no `realpath`, no temp directory — so none can pass on APFS and fail on ext4, a divergence this epic was bitten by once already.

## Alternatives considered

**Widening `TrustDowngradeResult` into a refusal union, so both functions refuse the same way.** The symmetric shape is the better one on its own terms, and it is what a reader meeting the throw will reach for. It loses on cost and on honesty about scope: the frozen Contract-stage cases read `result.record.state` and `result.revokedKinds` directly, so the widening breaks them, and a fault-stage fix that silently rewrote them would have turned a bug fix into an unannounced Contract change. Recorded here and at both call sites so the next reader does not make it symmetric without paying for the re-freeze.

**A named error class for the raising-downgrade throw, matching `WorkspaceMoveInvalidError`'s precedent in the sibling package.** Rejected as surface with no consumer. The throw carries no data a caller could branch on beyond its message, and there is no legitimate catch-and-handle path: asking `downgradeTrust` to raise trust is a caller bug, not a policy outcome a caller recovers from. A named class would invite the selective catch that a should-never-happen invariant break is the wrong signal for.

**Clamping instead of refusing — silently treating a raising downgrade as a no-op.** Rejected outright. It would leave the caller believing a transition happened and, worse, make the security-relevant failure invisible at the very site whose purpose is to revoke. This repository requires misconfiguration to fail loud, and nowhere more than here.

**Refusing on the direction before the host-user check.** Rejected in favor of the existing order. A non-`'user'` principal asking for any transition is refused for who it is, which is the fact that stays true whatever `target` it retries with; telling it the direction was wrong first would invite a retry that is refused again for the reason that was true all along.

## Consequences

`requestTrustUpgrade`'s callers must handle one more `TrustUpgradeDenialReason`. The union is exhaustively switched nowhere outside its own tests today, and the member is additive, so no existing caller changes.

`downgradeTrust` can now throw, which its callers could previously assume it never did. It has no production caller, so nothing changes today, and the JSDoc carries `@throws`. A future caller that computes `target` from a state machine it does not control must decide the direction before calling rather than after — which is the point.

The package README carried this exact defect as a Known Limitation (*"`requestTrustUpgrade` does not check that `target` raises trust… a host user may pass any `TrustState`"*), and it is replaced with the enforced rule in the same change. A README asserting the opposite of the code is the failure mode this repository's docs-accompany-code rule exists for, and it would have been describing a security property.

must[2]'s remaining halves are untouched and not covered by this fix: there is still no host-user *interaction* seam, and the `TrustUpgradeAuditRecord` is still plain data that nothing appends, pending the vendored Cordis `Fiber` structural fix ([trust-kernel boundary](../../../../docs/architecture/trust-kernel-boundary.md)). This fix makes the authorization check unbypassable; it does not make the authorization real.
