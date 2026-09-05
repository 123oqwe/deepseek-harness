---
description: "Epic P5-11 的任务协调:原子的单赢家认领 + 单调递增的尝试计数,以及在排程之前就拒绝环的图校验。"
kind: "package-reference"
---

# @deepseek-ai/dsh-taskboard

[English](README.md) | 中文

## 摘要

任务板在竞争下反复回答同一个问题:*这个任务现在归谁?* `src/types.ts` 从调用方提供的状态里做出认领决策;`src/store.ts` 原子地执行它,使两个同时发问的 worker 不可能都被告知"是"。

## 只有一个赢家,而计数在输掉时也要留下

`decideClaim` 在每一次认领上都递增尝试计数,无论赢输。一个只在成功时前进的计数,会把一个被十几个 worker 争抢的任务报告成廉价的,而读这个计数的重试预算永远不会触发。

原子性在 store 而不在决策:决策是纯的、可重复的,所以两个调用方可以做出相同的决策,而只有 store 能裁定谁真正持有该任务。

## 环在排程之前被拒绝,而不是在排程之中

`validateTaskGraph` 在图被提交时就拒绝依赖环。等到后面才发现——某个 worker 永远等待一个反过来等它的任务——产生的是挂起而不是错误,而挂起没有可供处置的消息。

## Model Experience

None, as this package exports claim and graph decisions, an atomic store, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## 已知限制与延后事项

- **目前还没有任何东西从板上排程。** 这里只有认领决策、原子 store 和图校验;消费它们的 worker 池属于后面的 epic。
- **回收基于时间且信任时钟。** 过期的认领按调用方提供的截止时间回收;板本身不检测一个活着但卡死的 worker。
