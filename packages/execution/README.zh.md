---
description: "execution 分组导览：ExecutionWorld 能力 seam —— 一个动作将在何处运行、在什么约束之下 —— 与"这个动作是什么"严格分开。"
kind: "package-group"
---

# packages/execution

[English](README.md) | 中文

## 概述

`execution/` 分组只回答一个问题——**这个动作将在何处运行、在什么约束之下**——刻意不回答别的。它持有描述一个 world 的词汇、指称一个存活 world 的不可伪造 handle、world 所走的生命周期，以及"无人能满足的请求应被拒绝而非削弱"这条规则。**动作本身是什么，仍归动作所有**：`ActionManifest` 从不指名 world——因为一份指名了 world 的 manifest，会让同一个动作在两处运行得到两个不同的摘要。

今天只有一个包，因为这个 seam 首先是一份契约。本仓库中不存在任何 provider，所以契约声明的每个操作今天都不可达；现在约束命令的是 `sandbox/`，且仅限同一 world 内。

## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`execution-world`](execution-world/README.zh.md) | ExecutionWorld Service Definition 的词汇：九个约束维度、带牌记的 handle、改编自 OCI 的生命周期状态、每次停止都归一的 typed outcome，以及朝拒绝方向失败的 provider 选择。不持有 provider、不挂载服务 | ——（类型与纯决策） |

## 子系统归属

本分组拥有 [ExecutionWorld 子系统](../../docs/subsystems/execution-world.zh.md)——关于"一个 world 是什么、一个 handle 证明了什么、以及为什么选择是拒绝而非降级"的权威契约。

## 尚未抵达的部分

- **没有 provider。** 适配 `sandbox/` 的本地 provider 属同一 epic 的后续阶段；container 或 microVM provider 属更后面的 epic。在任何一个出现之前，本分组不改变任何命令的约束方式。
- **策略还无法就 world 作判断。** `@deepseek-ai/dsh-policy-engine` 在生产方落地前保持 `ExecutionWorldFact = { kind: 'absent' }`，所以本分组存在的理由——那个维度——对每条策略仍然不可见。

## 相关文档

- [ExecutionWorld 子系统](../../docs/subsystems/execution-world.zh.md) —— 本分组拥有的契约。
- [sandbox 分组](../sandbox/README.zh.md) —— 今天约束命令的东西，以及它为何仅限同一 world。
- [Policy 子系统](../../docs/subsystems/policy.zh.md) —— 一旦有 world 被报告，就会据其作判断的消费方。
