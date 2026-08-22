# Final Batch — P5-07/P5-08/P5-09/P4-14

## P5-07 Codex Adapter
- mapEvents: thread/turn/items to standard child events
- createContinuation: resume token
- buildProviderResult: answer, events, usage, artifacts

## P5-08 Claude Code Adapter
- Same contract as P5-07

## P5-09 ACP Provider
- Same contract as P5-07

## P4-14 Partial-Turn Resume
- TurnCheckpointManager: checkpoint at model_request/tool_call/tool_result/assistant_commit
- TriggerService: durable schedule/goal triggers with catch-up and DST handling
