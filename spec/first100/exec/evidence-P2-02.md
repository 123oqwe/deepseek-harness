# P2-02.U evidence

## acceptance[1]: the orphan hole is REAL, measured before it was closed

The delegate's ruling (§12.76) was: measure first, and let the measurement decide whether `revokeSession` gets wired at the cancel path or is directed to P2-12. Wiring it against a harness that already stops children would have reached nothing — another mechanism without a subject, which is what this epic was withdrawn for.

**The measurement**, `packages/subagent/subagent/tests/capability-token-spawn.spec.ts`, run BEFORE any revocation was wired: start a continuable child through the spawn provider, cancel the parent with `parent.cancel({ kind: 'user' })`, then have the child present its own derived token for a tool call.

```
[ACC1] stillAdmitted=true isError=false content=[{"type":"text","text":"ok"}]
      Tests  5 passed (5)
```

**What it shows:** a cancelled parent leaves its child holding a live derived token, and the child's next tool call is ADMITTED — it ran `read_file` and got `ok`.

**And the conclusion is NOT that this is a leak** (§12.77). A token carries the authority a SESSION delegated, while `Agent.cancel` is turn-scoped: `agent-loop/src/agent.ts:171-177` clears the inbox and aborts the current phase, leaving the agent usable for its next turn. P5-10's own semantics are that cancelling is not disconnecting, and a continuable child outlives the turn by definition. So the child's authority outliving one cancelled turn is the correct lifetime of a delegation, not a hole in it.

Wiring `revokeSession(parent)` at that point — the shape first proposed — would have been worse than the gap: it would revoke the PARENT's own session root, so every tool call in the parent's next turn would be refused after a user cancelled a single turn. A fail-open that is actually correct traded for a fail-closed that is not.

**What does withdraw delegated authority:** expiry, bounded by `min(parent token expiry, child TTL)`, and explicit revocation. The production owner of explicit revocation is **P2-12's emergency stop** — `cancel run` / `kill execution world` revoking the run's session roots, which cascade to descendants through the recorded lineage. That is where acceptance[1] gets a launched-profile subject; it is that clause's home rather than a deferral.

acceptance[1] is therefore signed on DECISION-level evidence under §12.46-B: the provider spec's `kills a child derived from an EARLIER root when the session is revoked`, and the real-spawn cases showing a derived child carries `parentDigest` so the lineage walk can reach it. The producer half is recorded against P2-12.U.

### One method note that this measurement forced

The observation was invisible twice before it was readable. `console.log` inside the case produced nothing under the default reporter, and nothing under `--silent=false` either; only appending to a file outside the repository surfaced it. This is the third time in this epic's work that a harness swallowed the observation channel and the silence read as "the thing did not happen" — the same shape as the web lane's `watchConsole` tripwire and the lib-mode stale build. **An empty observation is a statement about the channel until the channel is proven to carry.**
