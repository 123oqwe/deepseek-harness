# @deepseek-ai/dsh-extension-proposal
Extension proposal pipeline replacing dynamic Cordis self-modification.
## Overview
- 7-stage pipeline: draft → scan → test → sign → canary → approve → publish
- Self-approval prevention
- Rollback support
## Key Invariants
- Each stage must complete before next
- Scan failure → rejected
- Test failure → rejected
- Submitter cannot approve
