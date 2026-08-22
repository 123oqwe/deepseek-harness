# Remaining Risks — P2-01

1. Identity context is not yet attached to SessionEvent envelope, ToolExecutionContext, SubagentRequest, or SDK requests. The types are defined but not yet integrated into the existing session/agent protocol types.

2. The static scan for tool providers creating admin principals is not yet implemented. This would be part of the architecture checker (P0-03).

3. Token replay detection is in-memory only. A production deployment needs durable token storage.

4. The anonymous-dev principal has no explicit capability restrictions beyond the type system. Runtime enforcement of reduced capabilities for anonymous-dev requires integration with the Policy Decision Service (P2-05).
