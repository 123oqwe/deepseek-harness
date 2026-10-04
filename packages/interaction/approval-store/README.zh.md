---
description: "Epic P2-07 持久审批队列的契约：审批的六种状态与其间的转移、存储保存的记录、比较并交换的存储操作，以及每个 provider 都执行的纯转移判定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-approval-store

[English](README.md) | 中文

## 概述

`dsh-approval-store` 是 Epic P2-07 持久审批队列的契约：在一个回合或进程里提出的审批，可以在另一个回合或进程里被判定、至多消费一次，或者过期。`src/types.ts` 持有词汇表——审批的 id、它的范围（一个回合里的一次工具调用，或一个等待它的持久 Run）、六种状态、存储保存的记录（请求摘要、策略版本、actor、截止时间、租户），以及每个 provider 以 `ctx.approvalStore` 实现的存储操作。`src/transitions.ts` 持有每个 provider 都执行的判定：转移表、截止时间、租户隔离与比较并交换的写入。本片是 Service Definition；它的 SQLite provider 与消费方随后到来。

## 目录

- [状态与转移](#states-and-moves)
- [一次写入，一个修订号](#one-write-one-revision)
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

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册工具、提示文本或会话事件，它拥有的东西都不进入模型请求。

#### KV Cache 影响

这里没有任何东西进入请求，故 provider 的缓存复用不受影响。模型读到的关于某个审批的内容，是提出审批的消费方写进其会话的内容，那属于消费方。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 本片只是契约。没有挂载任何 provider，所以每个 profile 里都没有 `ctx.approvalStore`；SQLite provider（一个文件，每次转移一个 `BEGIN IMMEDIATE` 事务和一次修订号比较并交换，以及崩溃注入点）是下一片。
- 还没有任何东西写穿到存储：`@deepseek-ai/dsh-user-approval` 仍在回合内等待每个判定，Run 还不能在 `waiting_for_approval` 里等待，SDK 的 list 与 decide 请求也还不在线上。它们随 Use 阶段到来。
- 不发布运行时不变式伴随包：契约不持有状态，也不拥有两个观察者可能各执一词的关系，故检查器无从对账；持久 provider 落地时再考虑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

无。

</details>
