# Agent Note: The memory proposal policy fails closed and ships enabled by default

Status: implemented

[English](2026-09-26-memory-proposal-policy-fails-closed.md) | 中文

## Problem

P6-03 `must[1]` 要求对每一次候选 memory 写入做出判定——auto-accept、送人工 review、或 reject；`must[2]` 要求敏感内容，以及无人评估过敏感度的内容，绝不自动收入 active（可召回）memory。`@deepseek-ai/dsh-memory` 出厂即 opt-in 且默认禁用；判定本身尚不存在，它该落在哪里、以及一个*没挂*策略的 `memory` 该如何表现，都还悬而未决。

陷阱在默认方向。若“没有策略”意味着 auto-accept，那么一个打开了 `memory` 却忘了策略的 profile 会悄悄收入每一次写入——正是 `must[2]` 要禁止的 fail-open 方向。本包的第一片恰恰取了这个错误默认，不得不更正。

## Decision

新包 `@deepseek-ai/dsh-memory-policy`，分三部分：

- **一个纯判定 `decideProposal`，** 与应用它的服务分开。它只读提案自己陈述的事实（`sensitivity`、`origin`）与部署阈值，因此无需 Context 即可测试，也不可能依赖别的东西。次序是有意的：先判敏感度再判置信度，因为敏感声明无论 writer 多有把握都送 review；未陈述的敏感度按 active memory 的索引对待它的方式对待——不可收入。
- **一个薄服务，** 挂载 `ctx.memoryProposalPolicy`，用它经校验的 `Config`（`reviewBelowConfidence`，一条按部署的阈值，而非常量——共享存储要比个人存储更严）应用该函数。
- **`dsh-memory` 的 `propose` fail closed：** 它通过 `ctx.get('memoryProposalPolicy')` 找到策略，没挂载时把每一次写入扣为 `pending` 而不收入。只有显式 `auto-accept` 才存 `active`；`reject` 则拒绝。因此一个没挂策略的 `memory` 不可能悄悄 auto-accept。

`memory-policy` 在 base bundle 里**默认启用**（`disabled: false`），与 `memory` 本身不同。它没有 provider 依赖、没有 injection，因此 `memory` 禁用时它只注册服务、处于惰性。一旦 profile 打开 `memory`，写入路径就继承已挂载的策略。那条唯一的 fail-closed 路径，留给*显式*在 `memory` 开着时禁用 `memory-policy` 的运维者。

## Alternatives considered

- **没挂策略时 fail open**——那种情况下 auto-accept 一条写入。否决：一个开了 `memory` 却没开策略的 profile 会因此悄悄收入每一次写入，正是 `must[2]` 要禁止的 fail-open 方向。这就是第一片的 bug，已在此更正。
- **要求开 `memory` 的 profile 必须同时开 `memory-policy`，否则加载失败。** 考虑过，但把策略默认启用更简单，并让先红仪器只挂 `memory`——策略经 base 层免费得到——而不必逼每个这类 profile 和每个测试 fixture 都写第二行。
- **把判定折进 `dsh-memory` 的 `propose`，不设独立包。** 否决：一个与 seam 分开的纯判定无需 Context 即可测试，并保持为可替换、可按部署配置的一层，而非硬编码进 seam 的逻辑。

## Consequences

- 先红仪器（lane B 的 B-651）在出厂 profile 上只挂 `memory`——这正是用户实际会做的事——并经 base 层免费得到策略，于是正常写入 auto-accept、control 用例转绿。仪器不必迁就实现。
- 该判定无需 Context 即可单测（`tests/proposal.spec.ts`）；服务通过挂在一个裸 Context 上来测试（`tests/policy.spec.ts`）。
- review 生命周期（list/approve/reject）与 merge/supersede/forget/export 传播（`must[3]`、`acceptance[1]`、`acceptance[2]`）是下一片；本片只覆盖提案判定及其 `pending`/`active` 路由。
