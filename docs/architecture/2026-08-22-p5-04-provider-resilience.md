# Agent Note: P5-04 — Provider Fallback, Hedging, Rate Limit
## Contract
- HedgingManager: canHedge, completeHedge, cancelHedge
- RateLimiter: check, updateFromHeaders, getState
## State Machine
request → (primary|hedge) → winner → complete
## Failure Semantics
- Max hedges: blocked
- Rate exhausted: blocked
- Window reset: allowed
## Dependencies: P4-11, P5-02, P4-12
