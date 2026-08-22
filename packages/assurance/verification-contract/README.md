# @deepseek-ai/dsh-verification-contract
VerificationContract: freeze verifiable success criteria before execution.
## Overview
- freezeContract: canonicalize + sign
- evaluateContract: match actual results against criteria
- validateContract: structural validation
- checkInvariants: status, evaluation, expiry checks
- isSatisfied: all criteria passed
## Key Invariants
- Contract frozen before evaluation
- All criteria must be evaluated
- Contract has expiry
- Schema version pinned
