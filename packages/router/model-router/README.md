# @deepseek-ai/dsh-model-router
Model router with success rate, cost, latency, privacy, and tool support.
## Overview
- scoreCandidate: 0-100 score with disqualification
- routeModel: select best candidate with fallback
- Privacy hierarchy: restricted > confidential > public
## Key Invariants
- Insufficient privacy: disqualified
- Missing tool support: disqualified
- Small context window: disqualified
- Unavailable: filtered
