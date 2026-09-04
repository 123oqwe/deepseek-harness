---
description: "可选的持久 memory 召回上下文：provider 中立 Memory seam（ctx.memory）的 Consumer，把召回的记录作为持久的模型可见上下文注入，并记录每次读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory-context

[English](README.md) | 中文

## 概述

`dsh-memory-context` 是 provider 中立的 Memory capability seam 的 Consumer 角色（first100 registry P6-01，Usage 阶段）。在每个符合条件的步骤上，它取出当前开放轮次中用户自己写下的文本，向 `ctx.memory` 询问该文本召回的持久记录，把结果作为一条带来源的 user 角色消息追加到请求中，并为这次读取记录一条 `memory/access` 事件。它只通过 Service Definition 访问 memory，从不 import provider 或 `MemoryRuntime` 类（`must[2]`）。注入与事件由同一次读取结果在同一条代码路径上产生，因此模型看到的 memory 记录，总是仅凭会话日志就能重建。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh-base` bundle 以 `disabled: true` 的行携带本插件与 `dsh-memory`。profile 通过同时启用这两行并指定一个 provider 目录来主动启用；`dsh-memory` 自身不注册任何 provider，因此只启用本 Consumer 而不提供 provider，会让每次读取都以 `MEMORY_PROVIDER_UNAVAILABLE` 失败。

```yaml
- id: memory
  disabled: false
  config:
    durableFileDirectory: './.memory'

- id: memory-context
  disabled: false
  config:
    tenantId: 'acme'
    principalId: 'operator'
    purpose: 'recall'
    maxRecords: 5
```

| 字段 | 必填 | 含义 |
|---|---|---|
| `tenantId` | 是 | 本 Consumer 读取所处的租户；成为 `MemoryScope.tenantId` |
| `principalId` | 是 | agent 未附加 `IdentityContext` 时使用的 principal id |
| `purpose` | 是 | 本 Consumer 读取的原因；记录在每条 `memory/access` 事件上 |
| `maxRecords` | 是 | 召回记录数的上限；成为 `MemoryContextBudget.maxRecords` |

每个字段都是必填的。`must[3]` 要求每次读取都带有 `principal`、`purpose`、`scope` 与 `contextBudget`，因此缺少任何一项的组合都是配置错误，会在加载时明确失败，而不是悄悄进行无 scope 的读取。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

### 设计理念

- **模型可见与被记录是同一个动作。** 注入的 `user/message` 与其 `memory/access` 事件来自同一次读取结果、同一条代码路径，因此本仓库的「模型可见 ⟺ 被记录」规则由构造保证，而非依赖额外的审计步骤。
- **Consumer 不持有任何 provider 引用。** 它注入 `memory` 服务并调用之；更换挂载的 provider 会改变它召回的内容，而本包无需改动（`must[1]`、`must[2]`）。
- **身份是解析出来的，不是默认出来的。** 当此前的运行已向会话持久附加 `IdentityContext` 时，principal 就是 agent 自己的；否则使用由声明的 `principalId` 与 `tenantId` 构造的 `anonymous-dev` principal。目前没有任何已发布 profile 会附加 `IdentityContext`，因此一个单纯要求它存在的 Consumer 将永远无法读取。
- **召回只针对用户自己写的文本。** pre-step 时的请求历史还包含其他上下文插件注入的快照（runtime context、sandbox 与审批策略文本、以及本插件自己上一次的召回）。把它们并入查询，会让 memory 召回什么取决于无关的策略文本，也会让一次召回的输出成为下一次召回的输入。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件本体：配置校验、access context 解析、召回文本渲染，以及前置的 `agent/pre-step` 监听器 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-memory`](../../memory/memory/README.zh.md) — 本包消费的 Service Definition、它的 provider 注册表与选择规则。
- [Memory 子系统](../../../docs/subsystems/memory.zh.md) — 请求/结果词汇表，以及 Memory 与 Session Query 的边界。

-----

<a id="model-experience"></a>
## 模型体验

### 召回的持久 memory

#### 模型看到什么

每个至少召回到一条记录的步骤注入一条 user 角色消息。没有召回到任何记录的步骤不注入任何内容，但该次读取仍会被记录。

##### 召回在记录预算之内

```markdown
Recalled <count> durable memory record(s):
- (<updated-at>) <json-serialized-content>
- (<updated-at>) <json-serialized-content>
```

##### 召回被裁剪到记录预算

```markdown
Recalled <count> durable memory record(s):
- (<updated-at>) <json-serialized-content>
This recall was truncated to the configured record budget; more records may exist.
```

#### Token 影响

每次召回增加一条消息，并持续累积直到压缩将其遮蔽；单步上限由 `maxRecords` 与每条记录自身的内容大小共同决定。查询未召回到任何记录的步骤不产生 token 开销。

#### KV Cache 影响

在单个步骤内是追加式的，因此召回内容位于可复用的请求前缀之后。由于召回集每步都会重新读取，某一轮的召回结果与上一轮不同时，会从召回文本发生变化之处起使请求后缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **除 provider 自身的匹配外，召回既不排序也不过滤** — Consumer 把开放轮次中用户自己写的文本原样交给 `ctx.memory.query()`，并注入返回的内容，仅以 `maxRecords` 封顶。相关性排序与整合策略是后续 first100 阶段的工作。
- **读取边界是配置的 `tenantId`，而非 agent 的** — 当 agent 附带的身份属于另一个租户时，该次读取被拒绝，而不是悄悄放宽边界。按 agent 的租户映射不在本包范围内。
- **没有写入路径** — 本包只读。这里没有任何代码会 propose、revise 或 forget 记录，因此它不可能成为模型写入持久 memory 的通路（`acceptance[1]`）。

-----

### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

召回查询只由用户撰写的消息文本构成,不取整个进行中回合。早期版本会把所有
user 角色消息一并折入,其中包含其它 context 插件注入的快照,于是召回的输入
夹带了无关的沙箱策略文本,且一次召回的输出可能成为下一次召回的输入。放宽这
个过滤条件会重新引入该反馈环。

</details>
