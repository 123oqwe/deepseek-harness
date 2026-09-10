---
description: "Epic P5-11 的任务协调:原子的单赢家认领 + 单调递增的尝试计数,以及在排程之前就拒绝环的图校验。"
kind: "package-reference"
---

# @deepseek-ai/dsh-taskboard

[English](README.md) | 中文

## 概述

任务板在竞争下反复回答同一个问题:*这个任务现在归谁?* `src/types.ts` 从调用方提供的状态里做出认领决策;`src/store.ts` 原子地执行它,使两个同时发问的 worker 不可能都被告知"是"。

## 目录

- [只有一个赢家,而计数在输掉时也要留下](#one-winner-and-a-count-that-survives-losing)
- [环在排程之前被拒绝,而不是在排程之中](#a-cycle-is-refused-before-scheduling-not-during)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 只有一个赢家,而计数在输掉时也要留下

`decideClaim` 在每一次认领上都递增尝试计数,无论赢输。一个只在成功时前进的计数,会把一个被十几个 worker 争抢的任务报告成廉价的,而读这个计数的重试预算永远不会触发。

原子性在 store 而不在决策:决策是纯的、可重复的,所以两个调用方可以做出相同的决策,而只有 store 能裁定谁真正持有该任务。

## 环在排程之前被拒绝,而不是在排程之中

`validateTaskGraph` 在图被提交时就拒绝依赖环。等到后面才发现——某个 worker 永远等待一个反过来等它的任务——产生的是挂起而不是错误,而挂起没有可供处置的消息。

## Model Experience

无,因为本包只导出认领与图判定、一个原子存储与类型,不注册任何 model 可见的东西。

#### KV Cache effect

这里没有任何东西进入模型请求,因此不影响 provider 的缓存复用。

## 已知限制与延后事项

- **目前还没有任何东西从板上排程。** 这里只有认领决策、原子 store 和图校验;消费它们的 worker 池属于后面的 epic。
- **没有任何东西清扫失效的认领。**用 `release` 主动交回认领的持有者会立刻释放该任务;凭空消失的持有者则会一直占着它,直到其租约到期,而且只有下一次认领尝试才会注意到。
- **回收基于时间且信任时钟。**过期的认领按调用方提供的截止时间回收;板本身不检测一个活着但卡死的 worker。
- 不发布 runtime invariant companion:本包只做决策,而一次认领所维持的关系归应用该决策的那个 store 所有——`@deepseek-ai/dsh-taskboard-sqlite` 在单个事务内强制它,在那里检查器只会把一个值和它自己相比。

### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

本开发备注是给维护者的工作上下文:未决问题与尚未定下的方向。它明确不具权威性——已交付的行为与边界写在上面各节和包代码里。

尝试计数按任务单调递增,而不是按 worker,所以它回答的是「这个任务被争抢得多厉害」而不是「这个 worker 试了几次」。想要后者的重试策略需要一个板目前不保存的按 worker 计数,而加上它会让认领决策对每个调用方有状态。

</details>
