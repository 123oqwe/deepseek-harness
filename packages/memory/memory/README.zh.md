---
description: "provider 中立的持久 Memory 服务（ctx.memory）：在可互换的 provider 之上提供 propose/query/get/revise/forget/export，带 principal/purpose/scope/context-budget 读取限定与单一选择策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-memory

[English](README.md) | 中文

## 概述

`dsh-memory`（`ctx.memory`）是 provider 中立的持久 Memory capability seam（first100 registry P6-01）：提出一次候选写入，查询或获取已有记录，修订或遗忘某条记录，以及导出调用方可见的全部内容——整个过程不指名任何向量数据库、图数据库或其他检索机制。具体的 provider（local-reference、基于 embedding、基于图……）作为后端接入，服务为每次调用解析出一个可用的 provider，因此消费方从不绑定到特定厂商。每次读取都携带完整的 access context（`principal`、`purpose`、`scope`、`contextBudget`）；大小上限由 seam 自身强制执行。`propose()` 是唯一的写入入口——不存在 `write`/`set`/`put` 动词——因此持久记录不可能从它之外产生。

provider 注册表、选择逻辑与 `must[3]` access-context 强制执行都是真实的，与 `dsh-web` 的 `WebRuntime` 保持一致。随包提供三个 provider：`createLocalReferenceMemoryProvider()` 与 `createFakeMemoryProvider()` 是两份刻意独立实现的内存实现（数据结构、id 生成与检索算法各不相同），用于证明 provider 可替换；`createDurableFileMemoryProvider()` 则跨进程持久化。本 seam 有一个随包提供的 Consumer：[`@deepseek-ai/dsh-memory-context`](../../context/memory-context/README.zh.md)，它把记录召回进真实请求，并记录每一次读取。

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

需要持久 memory 的组合加载 `dsh-memory` 并挂载至少一个 provider；插件或工具作者随后直接调用 `ctx.memory.propose()`/`query()`/`get()`/`revise()`/`forget()`/`export()`。服务为每次调用解析 provider，因此除非调用方自己配置过，否则永远看不到 provider id。

### 何时选择它

当插件或工具必须读写持久的、跨会话的 memory 而又不想硬编码厂商时，选择本服务。读取当前或过去某次对话自身的转录不需要它——那是 [Session Query](../../session-query/README.zh.md) 的职责（参见[子系统边界](../../../docs/subsystems/memory.zh.md#memory-vs-session-query)）。本服务自身不提供任何存储：没有至少一个可用 provider 时，每次调用都会以结构化的 `MemoryError` 失败。

### 最小配置

加载服务并让唯一挂载的 provider 自动入选，或用 `providerId` 钉住某个 provider id。环境变量 `$DSH_MEMORY_PROVIDER` 供给的是同一个字段，并非独立的优先级链。

```yaml
- name: '@deepseek-ai/dsh-memory'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerId` | （未设置） | 钉住的 provider id；未设置时在恰好一个可用时自动入选 |
| `durableFileDirectory` | （未设置） | 自注册的 `durable-file` provider 的目录；未设置则不注册任何 provider |

本服务自身不注册任何 provider，因此挂载它却既不给 `durableFileDirectory`、也不调用 `registerProvider()` 的组合，会让每次调用都以 `MEMORY_PROVIDER_UNAVAILABLE` 失败。`durableFileDirectory` 是唯一仅凭 `cordis.yml` 就能生效的途径。

### 操作

```text
// Propose a candidate write — the only mutation entry point:
const { id } = await ctx.memory.propose({ principal, scope, content })

// Read, scoped by principal/purpose/scope/contextBudget:
const { records, truncated } = await ctx.memory.query({ accessContext, query: 'text' })
const record = await ctx.memory.get({ accessContext, id })

// Revise or forget an id a prior propose() actually returned:
await ctx.memory.revise({ principal, scope, id, content })
await ctx.memory.forget({ principal, scope, id })

// Bulk-read everything visible to an access context:
const { records } = await ctx.memory.export({ accessContext })
```

[Memory 子系统](../../../docs/subsystems/memory.zh.md)参考页是完整的词汇表，也是读取限定与「无旁路」的理由所在。

### provider 选择

每次调用在执行时解析自己的 provider，注册顺序或加载顺序从不影响结果。已配置的 provider id 在其已注册且可用时胜出；没有配置 id 时，服务运行唯一可用的 provider，否则明确失败：

| 情形 | 结果 |
|---|---|
| 已配置的 id 已注册且可用 | 运行该 provider |
| 已配置的 id 未注册 | `MEMORY_PROVIDER_CONFIGURED_MISSING` |
| 已配置的 id 已注册但不可用 | `MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册且可用的 provider | 运行它 |
| 无 id，没有可用 provider | `MEMORY_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用 provider | `MEMORY_PROVIDER_AMBIGUOUS` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 — 点击展开</summary>

本节解释服务背后的设计取舍；可观察的行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

- **provider 中立由构造保证。** `src/types.ts` 在请求/结果词汇表的任何位置都不出现向量或图特有的字段（`must[0]`）；`query()` 接受自由文本，把检索机制完全交给 provider。
- **唯一的写入入口。** `propose()` 是唯一能引入新持久记录的动词；不存在可以绕过它的 `write`/`set`/`put`（`acceptance[1]`）。
- **选择永不依赖顺序**，与 `dsh-web` 的 `WebRuntime` 一致：一项能力要么钉住某个 provider id，要么在恰好一个可用 provider 注册时自动入选。
- **读取大小上限归 seam 所有。** `contextBudget.maxRecords` 在 provider 返回之后强制执行，因此返回过量的 provider 也无法泄露超出调用方预算的记录。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`MemoryRuntime` 服务、provider 注册表、执行时选择，以及 `createLocalReferenceMemoryProvider`/`createFakeMemoryProvider` |
| [`src/types.ts`](src/types.ts) | 词汇表：请求/结果类型、`MemoryProvider`、`MemoryError` 分类，以及 `memory/access` 持久会话事件 |
| — | 不发布运行时 invariant 伴随模块；`memory/access` 是本包自己的事件，仅由 `MemoryRuntime` 的消费方产生，不存在可供交叉核对的独立第二来源——`dsh-web` 也是以省略伴随模块解决同一情形。`must[3]` 的读取限定属于 `query()`/`get()`/`export()` 自身，而非事后的日志检查。 |

### 数据模型

`MemoryRecordView` 是一个临时的、最小的投影，仅够满足 Contract 阶段的一致性验证——规范的 `MemoryRecord`（内容 artifact/ref、kind、subject、来源事件、置信度、TTL、敏感度、状态、supersedes/disputes）是 first100 registry P6-02 的工作。`principal`/`scope.tenantId` 复用 `@deepseek-ai/dsh-principal`（first100 registry P2-01）的 `Principal`/`TenantId`，而不是另建一套平行的身份词汇表。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Memory 子系统](../../../docs/subsystems/memory.zh.md) — 完整的请求/结果词汇表、读取限定与「无旁路」的理由，以及 Memory 与 Session Query 的边界。
- [`@deepseek-ai/dsh-memory-context`](../../context/memory-context/README.zh.md) — 随包提供的 Consumer，把召回的记录注入请求并记录每次读取。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@deepseek-ai/dsh-memory-context`——它把召回的记录作为持久的 user 角色消息追加到请求中；本 seam 自身不注册任何 prompt、schema 或工具。

#### KV Cache 影响

本包不直接导致失效；注入召回记录的 Consumer 拥有由此产生的请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本服务单独使用时的不完整之处。

- **两个内存 provider 在进程退出时丢失一切** — `createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()` 是真实且经过一致性验证的，但它们的存在是为了证明 provider 可替换，而不是为了保留记录。需要记录在进程之外存活时，使用 `createDurableFileMemoryProvider()`。
- **持久 provider 每个目录只保留一份 JSON 文档** — `createDurableFileMemoryProvider({ directory })` 在每次写入时整体重写 `memory.json`，在每个实例内串行成一条链，并以「先写临时文件再 rename」的方式提交，因此它适合单机规模的记录量，而不适合大规模或高并发的存储；跨进程的多写入方存储不在范围内。
- **seam 自身不产生任何事件** — `memory/access` 现在有了真实的产生者，但它属于 Consumer 而非本包：`@deepseek-ai/dsh-memory-context` 为它执行的每次读取记录一条事件。`ctx.memory` 的其他调用方除非自己追加该事件，否则不会记录任何内容，因此日志只对经由会写入该事件的 Consumer 所做的读取是完整的。
- **`must[3]` 的强制执行位于 seam，而不在 provider 内** — `MemoryRuntime.query()`/`get()`/`export()` 在触及任何 provider 之前，就以 `MEMORY_ACCESS_CONTEXT_REQUIRED` 拒绝不完整的 `MemoryAccessContext`，因此 provider 不可能被交给一次无 scope 的读取；而在 seam 之外注册的 provider 不会继承该检查。
- **没有面向模型的工具** — 模型不能调用 memory；它只能读到 `@deepseek-ai/dsh-memory-context` 为它召回的内容。让模型自行查询或提出写入的、形如 `dsh-tool-memory` 的包不在本 epic 范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 — 点击展开</summary>

本开发备注是面向维护者的工作上下文：开放的问题与尚未定案的方向。它明确不具权威性——已发布的行为、限制与理由位于上面各节。

#### 仍待完成的登记

- `packages/memory/README.md` 目前还没有组级 README；若 `scripts/verify-subsystem-pages.ts` 开始要求它，则需要补上该页面或一条有正当理由的豁免条目。

</details>
