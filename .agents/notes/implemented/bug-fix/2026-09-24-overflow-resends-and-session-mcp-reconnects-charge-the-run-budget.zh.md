# Agent Note: 上下文溢出重发与会话 MCP 重连计入 run 的重试预算

Status: implemented

[English](2026-09-24-overflow-resends-and-session-mcp-reconnects-charge-the-run-budget.md) | 中文

## 问题

Epic P4-11 must[1] 要求替一个 run 重做工作的每一层都从同一份 run 预算中支取。这份预算由 `ctx.runRetryUsage`（`@deepseek-ai/dsh-retry`）持有，但只有 `llm-retry` 向它记账。`compaction-basic` 在提供方确认上下文溢出后，按自己的 `maxOverflowRetries` 重发请求；`mcp-client` 按自己的 `reconnect` 尝试预算重连断开的服务器。两者都不问 run 预算，所以一个 run 可以经由其中任一条路径花过自己的上限（BLOCKED-317）。

## 决策

- **`compaction-basic` 为每次溢出重发记账。** 它的 `agent/request-error` 监听器在压缩之前先请 `ctx.runRetryUsage` 准入这次重发，计入委派根的 run。被拒绝时把错误交给下游，所以已无余额的 run 不会为一份用不上的摘要付费。准入即记账，所以随后压缩没能缩小上下文的溢出，仍然花掉一次重试。
- **`mcp-client` 为挂在单个会话上的服务器的每次重连记账。** 服务器配置可以带一个仅在运行时使用的 `chargeSession`，`dsh-acp` 为它挂载的每个服务器都设为该 ACP 会话。每次重连前，监督器先请 run 预算准入，计入该会话委派根的 run。被拒绝时，工具被注销、重连停止，与尝试预算耗尽时相同。
- **会话持有 run 之前，重连不记账。** `chargedRunFor` 对一个会话只保留第一次的答案，若在 agent 持有 run 之前解析，这个会话以后的每次重试都会被豁免，包括 `llm-retry` 的。所以监督器只在该会话的 agent 有了 `runId` 之后才记账。
- **每个记账层自带委派查找。** `dsh-retry` 不依赖 agent 包，所以 `llm-retry` 传给 `chargedRun` 的查找函数在两个新层里各重复一份，并为重复代码门禁做了标记。

## 考虑过的替代方案

- **为挂在整个宿主上的 MCP 服务器的重连记账。** 未采用：这样的服务器服务于用到它的每个 run，却不属于其中任何一个，没有可以记账的 run。
- **只在压缩成功之后才为溢出重发记账。** 未采用：已无余额的 run 仍会为一次用不上的摘要请求付费。
- **把委派查找移进 `dsh-retry`。** 未采用：`dsh-retry` 按设计不依赖 agent 包与 session 包（`root.ts`），所以读 agent 注册表的查找属于持有 agent 的各层。

## 后果

- 各插件的上限仍然相加，run 预算封住它们的总和：挂载了 `ctx.runRetryUsage` 时，`llm-retry` 的重试、压缩的溢出重发与会话服务器的重连，一起在 run 的上限处停止。
- run 已用完预算的会话 MCP 服务器会失去它的工具，直到插件重载，与用完自身尝试次数的服务器相同。
- 压缩随后没能缩小上下文的溢出重发，仍然已经花掉一次重试。
- 挂在整个宿主上的 MCP 服务器只受它自己的 `reconnect` 预算约束。
