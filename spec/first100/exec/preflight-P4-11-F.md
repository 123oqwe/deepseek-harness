# preFlight — P4-11 Fault stage (the retry boundary matrix)

Per lifecycle §1: written before any code. Measured at `527dc4dac8`.

## Two of the four proposed boundaries do not exist, measured

The delegate proposed four: budget-store corruption or unwritability, breaker state loss, concurrent `admit` atomicity, and first-chunk timeout versus endpoint refusal. Two of them name failures this design cannot have, and a matrix row asserting an impossible failure proves nothing.

| proposed boundary | measured | verdict |
| --- | --- | --- |
| the budget store is corrupt or unwritable | `usage.ts` has no `readFile`, no `writeFile`, no path: the store is a `Map` in memory, deliberately, because a budget bounds one run's LIVE attempts and a run that ended has nothing left to charge | **does not exist** |
| two layers `admit` concurrently and lose an update | `admit` is a SYNCHRONOUS method, and the contract exposes no read/write pair a caller could await between. JavaScript gives no interleaving inside one synchronous call, so a case here would assert what the language already guarantees | **does not exist — by the design that prevents it** |
| breaker state lost | real: state is per-process and a remount starts closed. Already frozen at P (`unloads and rolls back`), so a second case would re-prove it | **covered** |
| first-chunk timeout vs endpoint refusal | real, and worth a row: both fail the first chunk, and whether they count the same against endpoint health is a decision nobody has stated | **keep** |

The second row is worth stating plainly rather than dropping: the atomicity concern is real in general, and the reason it cannot arise here is `admit` deciding and storing in ONE call. That is a property of the contract, and the thing that would break it is a future refactor to `usageOf` + `record`. So the boundary belongs in the matrix as a CONTRACT assertion — the service exposes no way to read a usage and write its successor separately — rather than as a concurrency simulation.

## The boundary this stage found, and it is a real defect

`chargedRun` stops at the furthest ancestor this process can see, returning that ancestor's run (`root.ts:53`). The comment argues the widest resolvable total beats falling back to the leaf's own allowance, and for a parent in another process that is right.

But there is a case it reads the same way and should not: **a parent that has been disposed while its child is still working.** The lookup then fails for the parent, the walk stops at the child, and the child charges ITS OWN run — a fresh allowance, which is exactly the stacking must[1] exists to stop. A continuable child outliving its parent's turn is ordinary (P2-02's own measurement: cancelling a parent does not stop a continuable child), so this is not a hypothetical.

**Frozen intent:** a child whose parent agent is gone still charges the run it was charged to while the parent lived. **The mutation that must redden it:** the walk falls back to the child's own run when the parent cannot be resolved.

**What that needs, and it is not free:** the charged run has to be durable on the child rather than recomputed from live agents. The child's descriptor already persists `delegatingSession` (P4-09), so the honest options are to walk the SESSION log's `parentSession` rather than the live registry, or to record the charged run beside the delegating session. I will measure both before choosing, and the choice goes in the note.

## The matrix, as data with the count guarded

Following P4-08.F and P2-04.F: boundaries enumerated as data, each named once, with the count asserted so a silently dropped row fails.

1. a 4xx that is not 408/429 is permanent, and names `client-error`
2. 408 and 429 are retryable, so "4xx" is not read as "never"
3. a malformed request is `invalid-input`, distinct from a client error
4. a policy denial is `policy-denied`, distinct again
5. a side-effecting attempt with no ledger verdict is refused
6. `sent` is refused; `prepared` and `compensated` are admitted
7. a hedged attempt spends no budget; a retry does
8. `maxRetries: 0` forbids retrying rather than meaning unlimited
9. the delay budget refuses at the exact boundary, and the refused delay is not charged
10. a refusal stores no usage
11. two layers exhaust ONE total, however they divide it
12. the walk stops at the furthest visible ancestor
13. a circular chain terminates
14. **a child whose parent agent is gone keeps charging the parent's run** (the new one)
15. the breaker opens at the threshold and refuses without reaching the adapter
16. a permanent failure does not move the breaker
17. one destination opens without opening another under the same provider
18. a remount starts closed
19. **a first-chunk TIMEOUT counts as endpoint ill-health, and an endpoint REFUSAL does too, but a malformed request does not** — the row that distinguishes the three
20. the contract exposes no read/write pair, so a usage cannot be read and its successor written separately

## 4.4a at signing

Rows 1–13 and 20 are decisions already reached from production callers landed at U; rows 14–19 are the fault stage's own. The report will name call sites rather than counts.

## Status

**No code written.** Freeze recorded run-and-pasted per §12.68 once the cases exist.
