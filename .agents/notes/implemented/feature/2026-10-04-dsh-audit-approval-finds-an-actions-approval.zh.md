# Agent Note: `dsh audit approval` 查动作由哪一次审批决定

Status: implemented

[English](2026-10-04-dsh-audit-approval-finds-an-actions-approval.md) | 中文

## Problem

P2-06 validation[2] 要求审计查询能从动作反查唯一的审批。会话日志里已有查询所需的东西：每个带绑定的询问，其 `approval/bound` 以 `actionId` 指名它决定的那次派发，其 `id` 把它与 `approval/asked`、`approval/decided` 配成一对。但没有面向操作者的命令来执行这个查询（BLOCKED-280）。

## Decision

- `dsh audit approval --profile <name> <session-id> <action-id>` 是与 `dsh memory` 并列的启动器动词，以宿主用户身份运行。它启动 profile，经 `ctx.sessionQuery.readSession` 读已存会话的日志，打印一行 JSON：`{ sessionId, actionId, approvals }`。
- `approvals` 按日志顺序列出 `approval/bound` 指名该动作 id 的每一次审批。每一项带绑定的字段（`approvalId`、`action`、`digest`、`principal`、`preconditions`，有则带 `capabilityToken` 与 `policyVersion`，以及 `expiresAtMs`）、绑定事件的 `boundSeq`，以及连上的 `asked`（`seq`、`toolName`）与 `decided`（`seq`、`outcome`），日志里没有的为 `null`。
- 退出码：恰好匹配一次为 0，没有匹配为 3，匹配多于一次为 4，查询格式不对为 2，日志读不了为 1。
- 查询只报告日志记下的内容。它不采用派发路径在多条记录之间的取舍，所以 `verifyRecordedApproval` 不动。
- 为了 `SessionId` 品牌，`@deepseek-ai/dsh-session` 从 CLI 的 devDependencies 挪到 dependencies。

## Alternatives considered

- **SDK 或 RPC 方法。** 要改协议，两个 SDK 的预期输出都要跟着动，而这只是操作者在本机运行的一次查询。
- **只导出一个函数。** 操作者没法运行它。
- **共用派发路径的记录选择。** 会为了一份报告改动已验收的派发代码，还会把同一动作被绑定两次的日志藏起来，而这本身就是一条审计发现。

## Consequences

- 动词只能读所选 profile 的持久化看得到的会话。`readSession` 会重放校验日志，所以较新构建写的日志会以退出 1 失败，而不是被读一部分。
- 没有绑定的派发（没有元组的询问，或根本没有询问）没有记录可查，动词退出 3。
