---
description: "Epic P2-07 的持久审批队列：审批的六种状态与其间的转移、存储保存的记录、比较并交换的存储操作、每个 provider 都执行的纯转移判定，以及 SQLite provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-approval-store

[English](README.md) | 中文

## 概述

`dsh-approval-store` 是 Epic P2-07 持久审批队列的契约：在一个回合或进程里提出的审批，可以在另一个回合或进程里被判定、至多消费一次，或者过期。`src/types.ts` 持有词汇表——审批的 id、它的范围（一个回合里的一次工具调用，或一个等待它的持久 Run）、六种状态、存储保存的记录（请求摘要、策略版本、actor、截止时间、租户），以及每个 provider 以 `ctx.approvalStore` 实现的存储操作。`src/transitions.ts` 持有每个 provider 都执行的判定：转移表、截止时间、租户隔离与比较并交换的写入。`src/sqlite.ts` 是 SQLite provider，以 `./sqlite` 导出，由它的插件发布为 `ctx.approvalStore`；目前还没有任何东西挂载它，它的消费方随后到来。

## 目录

- [状态与转移](#states-and-moves)
- [一次写入，一个修订号](#one-write-one-revision)
- [SQLite provider](#the-sqlite-provider)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="states-and-moves"></a>
## 状态与转移

审批从 `requested` 开始，由此转为 `approved`、`denied`、`revoked` 或 `expired`；`approved` 的审批转为 `consumed`、`revoked` 或 `expired`；`denied`、`expired`、`revoked` 与 `consumed` 是终态（`APPROVAL_TRANSITIONS`）。从截止时间起，`requested` 或 `approved` 的审批读作 `expired`（`effectiveApprovalState`），且只能转为 `expired`，所以过期的审批永远不会被批准或执行。审批属于一个租户：别的租户既读不到也判不了它，也不会得知它存在。

<a id="one-write-one-revision"></a>
## 一次写入，一个修订号

每条记录带一个修订号，从 0 开始，每次转移加一。每次写入都写明写入者读到的修订号（`applyApprovalTransition`）：基于更早读取的写入以 `stale-revision` 被拒，并给出当前记录。所以两个客户端判定同一个审批，只会留下一个终态，一个审批至多被消费一次——它批准的动作只在消费成功时运行。检查按固定次序进行：租户、修订号、截止时间，然后是转移表，所以冲突指出的是第一处不对的地方。判定成功时记录由谁判定、何时判定；消费时记录何时消费。

<a id="the-sqlite-provider"></a>
## SQLite provider

`openApprovalStore(directory, options)` 把每个审批存进一个文件 `approvals.sqlite`，其 `schema_version` 为 1；别的版本的文件一律拒绝，不做迁移。每次转移是一个 `BEGIN IMMEDIATE` 事务：读出这一行，由 `applyApprovalTransition` 判定，再在修订号仍是读到的那个时写入转移后的行，所以写锁覆盖读与写，两个进程判定同一个审批会被串行化。读操作按租户过滤，把过期的审批报告为 `expired`，不写库。`ApprovalStoreSqlitePlugin` 接受 `directory`（必填，由 profile 行给出）与 `busyTimeoutMs`（默认 5000），挂载时打开文件，拆卸时关闭。仅供测试的 `fault` 选项在每次写入的语句之后、COMMIT 之前被调用：测试在其中抛错以观察回滚，或杀掉自己的进程以观察重启后看到什么。

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、提示文本或会话事件，它拥有的东西都不进入模型请求。

#### KV Cache 影响

这里没有任何东西进入请求，故 provider 的缓存复用不受影响。模型读到的关于某个审批的内容，是提出审批的消费方写进其会话的内容，那属于消费方。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Run 还不能在 `waiting_for_approval` 里等待，SDK 的 list 与 decide 请求也还不在线上；它们随 Use 阶段后续的提交到来。
- 不发布运行时不变式伴随包：在 Use 阶段把会话日志写在它旁边之前，存储是审批状态的唯一记录，所以还没有两个可能各执一词的观察；届时再考虑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>
