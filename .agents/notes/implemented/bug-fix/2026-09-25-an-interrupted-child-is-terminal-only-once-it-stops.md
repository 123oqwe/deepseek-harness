# Agent Note: An interrupted child is terminal only once it stops, and refuses a prompt the interrupt overtook

Status: implemented

English | [中文](2026-09-25-an-interrupted-child-is-terminal-only-once-it-stops.zh.md)

## Problem

P5-10. `interruptByParent` recorded an interrupt as `cancelling` on the child's control router and nothing moved it on: no code reported the child's stop, so the barrier must[3] names never closed. A browser prompt decided before an interrupt but still on its way to the child's inbox was delivered anyway and woke the child (acceptance[0]); lane A's K1b showed it on the shipped headless profile (run 35985477815). Every browser prompt was decided as a `continue`, so a Steer-delivered prompt was admitted while the child waited on a human (must[0]). A second interrupt after convergence would have reopened the barrier.

## Decision

- **The child's stop closes the barrier.** `interruptByParent` looks the child's Agent up at the interrupt and reports the `child` participant stopped when its `whenIdle` settles, successfully or not; an absent Agent is reported stopped at once. The router then moves from `cancelling` to `terminal`. The Agent is looked up at the interrupt rather than at router construction, because a cold resume may have replaced it.
- **A terminal child stays terminal.** `observeCancelled` has no effect in `terminal`, so a second interrupt after convergence does not reopen the barrier.
- **One cancellation per child, aborted by the interrupt.** The runtime keeps an `AbortController` per child beside its routers and hands `AbortSignal.any([caller, child])` to the prompt's delivery. The inbox already checks its signal at its final synchronous cutoff (`continuation-activation.ts`, `submitAdmitted`), so an interrupt that lands between the decision and the inbox refuses the message. The prompt is refused as `subagent/not-resumable`, in the decision's own shape, with the reason the router gives at that moment.
- **A prompt is decided by its delivery.** A Steer-delivered prompt is decided as a `steer` and a Queue-delivered one as a `continue`, as they are dispatched.

## Alternatives considered

- **An `AbortController` on the router.** Not taken, as the verification's V6 advised: `continuation.ts` cannot see the router, and the router's contract stays unchanged.
- **Deciding again after delivery.** Too late: the message is already in the inbox.
- **Making the interrupt take the child's lock.** The message could still be enqueued after the interrupt, and the interrupt would lose its synchronous admission.

## Consequences

- The per-child cancellations are retained as long as the routers are, one controller per child the runtime has seen (the KNOWN GAP case in `control.spec.ts`).
- A child interrupted once refuses every later browser prompt. The model's `send_message` path passes its own signal and is unaffected.
- Verification: lane A's K1b on the shipped headless profile, and the runtime cases in `control.spec.ts`: R2b, R2c and R3 are red on the tree before this fix, and R2a, their control, is green on both.
