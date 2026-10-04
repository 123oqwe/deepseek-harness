# Agent Note：审批队列的契约

Status: implemented

[English](2026-10-04-the-approval-queue-contract.md) | 中文

## 问题

Epic P2-07 要一个跨回合、跨进程存活的审批队列：六种状态，持久化请求摘要、策略版本、actor 与截止时间，用比较并交换来消费，过期或撤销的审批永不执行。今天 `@deepseek-ai/dsh-user-approval` 在回合内等待每个判定，会话日志之外没有任何东西持久化审批，崩溃只会把被打断回合里未答复的询问补记为 `cancelled`。

## 决定

- **先有契约包 `@deepseek-ai/dsh-approval-store`。** 它把 `ctx.approvalStore` 声明为 `ApprovalStoreContract`，让每个 provider 指的是同一个服务，做法同 `@deepseek-ai/dsh-lease-contract` 之于租约。
- **六种状态与一张表。** `requested` → `approved` | `denied` | `expired` | `revoked`；`approved` → `consumed` | `expired` | `revoked`；其余四种是终态。从截止时间起，待定的审批读作 `expired`，只能被标记为过期。
- **每次转移一个修订号。** 每次写入都写明它读到的修订号；纯函数 `applyApprovalTransition` 依次检查租户、修订号、截止时间与转移表，所以竞争的客户端只留下一个终态，消费至多发生一次。各 provider 执行这个函数，而不是各自重新判定。
- **两种范围。** `turn` 审批属于一次工具调用，崩溃结束其回合时被撤销；`run` 审批属于一个持久 Run，Run 跨进程等待它（delegate 对建造方案的裁定，2026-10-04）。
- **id 是所有者的品牌，重新声明。** `ApprovalRequestId`、`SessionId`、`RunId`、`TenantId` 与 `PrincipalId` 与各自包声明的品牌相同，所以契约不依赖其中任何一个包。

## 考虑过的替代方案

- **把存储放进 `@deepseek-ai/dsh-user-approval`。** 等待的 Run、SDK 的 list 与 decide 请求以及审批服务都要用它；独立的契约让它们不依赖提出审批的那条路径。
- **只在 SQLite provider 里放一个版本计数器。** 那样竞争与至多一次的规则就只活在一个 provider 的 SQL 里，第二个 provider 可能判得不同。

## 后果

- 契约与其判定已就位；尚未挂载任何 provider，也还没有东西写穿到它。SQLite provider、Run 的 `waiting_for_approval` 及其唤醒路径、user-approval 的写穿与 SDK 请求在后续各片到来。
