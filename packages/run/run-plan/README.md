# @deepseek-ai/dsh-run-plan
RunPlan freeze, amendment protocol, and executable plan.
## Overview
- freezePlan: canonicalize + sign plan
- verifyFrozenPlan: verify signature and digest integrity
- AmendmentProtocol: propose, apply, track amendments with approval requirements
- Budget expansion and approval changes require external approval
## Key Invariants
- Any byte change to plan JSON invalidates signature
- Agent cannot self-escalate budget, network, or approval mode
- All amendments tracked in revision history
