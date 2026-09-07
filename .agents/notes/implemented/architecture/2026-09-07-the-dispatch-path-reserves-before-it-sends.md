# Agent Note: The tool dispatch reserves against the idempotency ledger before it runs

Status: implemented

## Problem

Epic P4-12's ledger had no caller. The SQLite store, the CAS reservation, the five states and a 10,000-crash campaign all shipped through the Contract and Provider stages, and a repository-wide scan found **zero production callers** of any of it: `decideReservation`, `openLedgerStore` and every state transition were reachable only from the package's own tests. must[4] — "CAS reserve before execution, record the external receipt digest after" — therefore held over a ledger nothing ever reserved against.

Its declared Usage consumer, `packages/core/agent-loop/src/tool-calls.ts`, is the same file that builds the manifest, and the manifest already carries the key the ledger reserves on. The two halves were one line apart and never joined.

## Decision

- **`ActionLedgerPlugin` publishes the store as `ctx.actionLedger`**, opened in `Service.init` rather than the constructor. `dsh-lease-sqlite` records why: a constructor that throws during service construction unwinds the tree into a message naming neither the path nor the database.
- **The dispatch reserves, marks sent, then runs.** `sent` is written BEFORE the tool executes, because the tool call *is* the send: a crash between that write and the tool's own commit must read as "we may have sent it", which is what stops a retry from sending again. Marking after the fact would leave open exactly the window this ledger exists to close.
- **A refusal is a settled outcome, not an error.** Each of the four refusals produces its own model-visible text, because each demands a different next move — a duplicate says the effect already happened, an argument mismatch is a caller defect, a stale epoch means another generation owns the work, and an ambiguous entry needs a reconciler (acceptance[1]). Collapsing them would make a caller defect look like something to wait on.
- **An errored result records `ambiguous`, not a release.** A tool that threw may or may not have committed its effect; clearing the reservation would let a retry perform it twice. The cost is stated in the package's Known Limitations: a failed action's key is permanently refused until a reconciler exists, and that is the fail-closed direction.
- **The epoch is the run's lease epoch.** must[5] refuses a stale epoch, and the generation that owns an action is the generation that owns its run — available only since §12.19-3 put a store-issued epoch on `Agent.lifecycle`.
- **An absent ledger is not an approval.** A composition with none mounted proceeds as the harness did before the ledger existed. What must never happen is a mounted ledger's refusal being ignored, which is what the cases pin.

## Evidence

`packages/core/agent-loop/tests/ledger-reservation.spec.ts`, four cases on the real agent loop, asserting what the TOOL observed rather than what the ledger recorded:

- An ordinary call runs once and confirms — the positive control, without which a ledger that refused everything would satisfy every refusal case.
- A second call presenting the same key does **not** run, and the model is told it was already performed. **Mutation: ignoring the refusal reddens exactly this case.**
- Two calls with different arguments both run, so the key identifies the action and not the tool — without it the refusal case would also pass against a ledger keyed on the tool name.
- With no ledger mounted the tool runs: the documented fall-through, asserted so it cannot become accidental.

## Consequences

- `openLedgerStore` creates its directory. It did not, and the base bundle's derived path does not exist on a first run; every ACP and SDK snapshot scenario failed at plugin load with "unable to open database file" surfaced only as the whole tree failing. The same defect BLOCKED-148 spent a detour on, in a second store — which is why the mkdir now carries a comment naming it.
- `dsh-agent-loop` depends on `@deepseek-ai/dsh-action-ledger` (orchestration-runtime → capability-definitions, downward). `check-layer-deps` findings unchanged at 120.
- The base bundle mounts the ledger under the same storage root as the lease store, for the same reason: two hosts that must not both perform one effect have to be pointed at one ledger.
- must[2]'s native `Idempotency-Key` pass-through and must[3]'s target-state query remain unbuilt, and the receipt digest is over the tool's own content rather than a provider receipt. All three are now stated in the package's Known Limitations rather than implied by the ledger's existence.
