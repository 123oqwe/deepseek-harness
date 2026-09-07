---
description: "Epic P4-12 的外部副作用幂等账本：授权一次外部发送的预留判断、epoch 围栏，以及同键不同参数的拒绝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-ledger

[English](README.md) | 中文

## 概述

`decideReservation` 只回答一个问题：此刻这个调用方可以发送这次外部副作用吗？它是请求与账本当前条目的纯函数，因此崩溃演练可以直接驱动它。`openLedgerStore` 让这个回答变得持久：每个 `(scope, key)` 一行 SQLite 记录，在请求离开之前写入。

## 目录

- [为什么 tool result 不是证据](#why-a-tool-result-is-not-evidence)
- [五个状态是权限，不是标签](#the-five-states-are-permissions-not-labels)
- [检查顺序](#check-order)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

## 为什么 tool result 不是证据

tool result 记录的是 harness 观察到的东西，它记录不了外部世界是否已提交，因为「请求发出」与「结果持久化」之间的窗口是真实存在的：在窗口内崩溃，日志就说不出那封邮件到底发没发。账本是让重试变成可判定而不是猜测的持久记录。

## 五个状态是权限，不是标签

`prepared` 表示没有任何东西离开过 harness，所以重试可以发送。`sent` 表示请求已经发出而收据没有回来，所以重试**不可以**发送。`confirmed` 与 `compensated` 都已落定——后者是因为补偿已经执行而落定，它并不释放这个键。`ambiguous` 是重试解决不了的状态，它进入对账，而不是再试一次。

## 键是按客户端划分的

一个幂等键只在客户端内部唯一，而不是全局唯一。`draft-ietf-httpapi-idempotency-key-header-07` 就是这么定义的，其安全考虑一节给出了理由：服务端若不按客户端身份划分键的作用域，一个客户端就能探知另一个客户端的键状态。因此账本的身份是 `(scope, key)`，其中 scope 是 manifest 的 `actor` principal，并且它是表主键的一半，而不是旁边多出的一列。两个 agent 从参数 hash 派生键很容易相撞；它们会得到两条各自独立的预留，谁也不会知道对方存在。

## 检查顺序

参数先于状态比较，epoch 先于两个结果检查比较。两个顺序都承重，而不是风格问题。对一个参数不同的请求回答 `duplicate`，等于告诉调用方它那条**新的、不同的**请求已经被执行过；而把结果告诉一个已被围栏挡下的代，等于把另一代现在拥有的工作的信息交出去。

## Model Experience

None, as this package exports a reservation decision and types only and registers nothing model-facing.

#### KV Cache effect

此处没有任何东西进入模型请求，因此不影响 provider 的缓存复用。

## 已知限制与延后事项

- **没有传输，也还没有生产调用者。** 存储是持久的，判断也已对着一个 fake 外部服务证明过，但 harness 里还没有任何东西调用本包：把 `Idempotency-Key` 传给真实 provider、在真实工具调用前预留，属于 Usage 阶段，卡在 BLOCKED-143——生产路径上没有任何地方构造 ActionManifest，而 manifest 事件既不带 `idempotencyKey` 也不带 `actor`，恰恰是本账本用来做键的那两个字段。
- **`ambiguous` 没有生产者。** 没有任何东西去判定一个结果是「不可知」而不仅仅是「尚未观测」；这个判断属于查询目标状态的那一方，在它出现之前，这个状态只能由调用方直接写入才可达。
- 不发布 runtime invariant companion（No runtime invariant companion is published）：本包不持有状态、也不观测任何东西，因此不存在两个观测者可能产生分歧的自有关系。

### 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

本开发备注是给维护者的工作上下文：未决问题与尚未定下的方向。它明确不具权威性——已交付的行为与边界写在上面各节和包代码里。

账本本身该不该拥有对账循环，还是只记录「欠一次对账」，尚未决定。崩溃演练是直接写入 `ambiguous` 来驱动的，这足以证明那条拒绝成立，但对「谁来解决它」什么也没说。

</details>
