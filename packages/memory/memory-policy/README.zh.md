---
description: "P6-03 memory 提案策略，供选用、配置或调试候选 memory 写入的去向：auto-accept 进入 active memory、送人工 review、或 reject，带按部署配置的 review 置信阈值。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-policy

[English](README.md) | 中文

## 概述

本包决定一次候选 memory 写入在能被召回之前的去向：auto-accept 进入 active memory、送人工 review、或 reject。敏感内容，以及无人评估过敏感度的内容，一律送 review；置信度低于按部署配置的阈值的弱推断（`derived`）声明送 review；正常、证据充分的写入则 auto-accept。它挂在挂 `memory` 的地方——base bundle 默认启用它，因此凡是打开 `memory` 的 profile 都会继承它。用 `reviewBelowConfidence` 调节这个存储该有多严。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件与 `memory` 一起挂载；`@deepseek-ai/dsh-memory` 的 `propose` 路径通过 `ctx.get('memoryProposalPolicy')` 找到它，并按它返回的 disposition 行动。常见路径是保留默认阈值，让正常写入 auto-accept，而敏感与未评估的写入等待 reviewer。

### 何时选用

base bundle 默认启用本插件，所以你几乎不用手动挂它——凡 profile 打开 `memory` 就会得到它。共享存储想把更多推断声明送 review，就调高 `reviewBelowConfidence`；个人存储则调低。挂着 `memory` 却禁用本插件并不是放宽策略的办法：那时 `propose` 会 fail closed，把每一次写入都扣为 review。

### 最小配置

本插件无需配置——review 置信阈值默认为 0.5。

```yaml
- id: memory-policy
  name: '@deepseek-ai/dsh-memory-policy'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `reviewBelowConfidence` | `0.5` | writer 置信度低于此值的 `derived` 声明送 review，而非进入 active memory |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-policy)是每个可接受字段及其 JSDoc 的详尽来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

可观察行为已在[使用本包](#use-this-package)中完整覆盖；本节讲设计并指向代码。

### 设计取向

决策是一个纯函数 `decideProposal`，与应用它的服务分开：函数只读提案自己陈述的事实与部署阈值，因此无需 Context 即可测试，也不可能依赖别的东西。服务是一个薄 provider，挂载 `ctx.memoryProposalPolicy`，用它经校验的 `Config` 应用该函数。对决策采取行动——存 `pending` 或 `active`、或拒绝——属于 `dsh-memory` 的 `propose`，不在此处；一条声明是否可追溯是 P6-02 的 `isTraceable`，在本决策之前应用。

### 天然 fail-closed

`decideProposal` 先判敏感度再判置信度，因为敏感声明无论 writer 多有把握都送 review；对未陈述的敏感度，它与 active memory 的索引一视同仁——不可收入。`dsh-memory` 的 `propose` 补全了 fail-closed 立场：没有挂载 `memoryProposalPolicy` 时它把每次写入扣为 `pending`，所以部署无法靠移除本插件来放宽策略。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/proposal.ts`](src/proposal.ts) | 纯函数 `decideProposal` 及其决策/阈值类型 |
| [`src/policy.ts`](src/policy.ts) | `MemoryProposalPolicyService`（挂载 `memoryProposalPolicy`）及其 `Config` |
| [`src/index.ts`](src/index.ts) | 包入口：服务默认导出、`decideProposal` 与决策类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时读这些。

- [`@deepseek-ai/dsh-memory`](../memory/README.zh.md)——其 `propose` 咨询本策略、并对决策采取行动的 seam。
- [memory/ 包索引](../README.zh.md)——该组及其包。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-memory-policy)——每个可接受配置字段及其含义。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册任何 prompt、schema、工具或 session 事件；它的判定只以一条被扣下的（`pending`）记录从 `@deepseek-ai/dsh-memory-context` 召回中缺席的形式抵达模型，而那由该包渲染。

#### KV Cache 影响

无。策略在写入时运行，判出一个 disposition，不向任何模型请求添加任何内容；一条 `pending` 记录只是在获批前被挡在后续召回之外，因此不会因它而改变任何请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **review 生命周期是下一片。** 列出待定提案并批准或拒绝它们，以及 merge/supersede/forget/export 传播（`must[3]`、`acceptance[1]`、`acceptance[2]`），都不在这第一片——它只覆盖提案判定及其 `pending`/`active` 路由。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是工作上下文，明确非权威。第二片加入 review 生命周期与传播规则；它落地时，`reviewBelowConfidence` 这个阈值可能需要配套阈值（例如共享存储与个人存储各有一条不同的阈值），这也是为什么这个单一字段是经校验的 `Config` 而非常量。

</details>
