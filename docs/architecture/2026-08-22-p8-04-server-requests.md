# Agent Note: P8-04 — Bidirectional Server→Client Requests
## Problem
No server→client request mechanism for persistent approval, clarification, human takeover.
## Contract
- HumanInteractionChannel: sendRequest, submitResponse, cancelRequest
- 4 types: approval, clarification, human-takeover, quorum
- Role-based authorization, quorum support
## State Machine
pending → (answered|expired|cancelled)
## Failure Semantics
- Expired: rejected
- Unauthorized role: rejected
- Answered: cannot cancel
## Rejection
- Duplicate request: rejected
- Unknown request: rejected
