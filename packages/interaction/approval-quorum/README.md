# @deepseek-ai/dsh-approval-quorum
Multi-person approval and separation of duties.
## Overview
- QuorumSpec: required roles, min approvals, mutual exclusion, ordered, timeout
- ApprovalQuorum: initiate, submitVote, checkExpiry
- Initiator cannot approve (separation of duties)
- Action manifest digest binding prevents parameter substitution
## Key Invariants
- Any deny vote denies the entire request
- Mutual exclusion prevents same approver from multiple roles
- Ordered approval enforces role sequence
- Expired requests cannot be satisfied
