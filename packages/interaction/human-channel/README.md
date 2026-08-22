# @deepseek-ai/dsh-human-channel
Bidirectional server→client requests.
## Overview
- HumanInteractionChannel: sendRequest, submitResponse, cancelRequest, getPendingRequests
- 4 request types: approval, clarification, human-takeover, quorum
- Role-based authorization
- Quorum support
## Key Invariants
- Expired requests rejected
- Answered requests cannot be cancelled
- Unauthorized roles rejected
