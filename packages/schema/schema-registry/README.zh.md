---
description: "面向持久化与线协议叶对象的统一 schema registry：schemaId 身份、major/minor 版本化、兼容规则强制执行与读取期协商。"
kind: "package-reference"
---

# @deepseek-ai/dsh-schema-registry

[English](README.md) | 中文

## 概述

`dsh-schema-registry` 为每个持久化/线协议**叶对象**（session-event payload 形状、SDK 协议 wire 类型，以及未来的叶对象如 settings 形状）提供 `schemaId`、major/minor 版本，以及一条真实的兼容规则：新增字段只需提升 `minor`；删除、重命名或语义改变则要求提升 `major` 并提供迁移函数。本包与 `SESSION_FORMAT_VERSION`（`@deepseek-ai/dsh-session`）正交——后者继续且仅管辖 session log 自身的容器格式，本包从不引用、包装或代理它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 注册一个 schema 的首个版本

```ts
import { brandString } from '@deepseek-ai/dsh-brand'
import { identityMigration, registerSchema, type SchemaId } from '@deepseek-ai/dsh-schema-registry'

registerSchema(brandString<SchemaId>('my-package:MyPayload'), { major: 1, minor: 0 }, identityMigration)
```

一个 schema 的首个版本没有真正的前驱 payload，因此其迁移函数是恒等函数。`registerSchema` 会拒绝同一 `schemaId` 的第二次注册——它绝不会静默替换已有条目。

### 演进一个 schema

`evolveSchema` 会根据声明的 `FieldChange` 列表强制执行版本提升规则：若变更集合全部是 `'additive'`，只能提升 `minor`；若变更集合中含有任何 `'breaking'` 变更，则必须将 `major` 恰好提升 1 并将 `minor` 重置为 `0`。不匹配的版本提升会在提交前被拒绝，且旧版本会保留在该 schema 的 `history` 中。

```ts
evolveSchema(
  id,
  [{ field: 'newField', kind: 'additive', reason: 'optional, ignorable-safe' }],
  { major: 1, minor: 1 },
  identityMigration,
)
```

### 协商兼容性

`negotiateSchema(schemaId, encounteredVersion)` 是消费方（session replay、SDK initialize、plugin load）在信任一个可能写自不同版本的 payload 之前使用的读取期检查。只要 `major` 相同即视为兼容，无论 `minor` 是否不同；`major` 不同或 `schemaId` 未注册都会返回结构化的 `SchemaCompatibilityError`——绝非裸字符串，且该函数从不检查或剥离 payload 的字段，因此它本身不可能造成字段静默丢失。

```ts
const result = negotiateSchema(id, encounteredVersion)
if (!result.compatible) {
  // result.error is a SchemaCompatibilityError: { code, schemaId, encounteredVersion, registeredVersion }
}
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `registerSchema`/`evolveSchema`/`negotiateSchema`/`getSchema`/`listSchemas`，以及注册所有已知 session-event 与 SDK-protocol schema 的启动引导 |
| [`src/types.ts`](src/types.ts) | `SchemaId`、`SchemaVersion`、`FieldChange`、`RegisteredSchema` 及错误码类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件（无运行时不变式；详见文件） |

### 启动引导注册

导入本包会以版本 1.0 与恒等迁移，注册：`KNOWN_SESSION_EVENT_TYPES`（`@deepseek-ai/dsh-session`）中的每个类型名，注册为 `session-event:<type>`；以及 `@deepseek-ai/dsh-sdk-protocol` 的 `src/types.ts` 所记录的每个具名 wire 类型（通过每个接口自身的 schemaId 文档注释），注册为 `sdk-protocol:<TypeName>`。协议列表在 `src/index.ts` 中手工镜像——协议包自身的导出不携带可供运行时使用的值——当那里新增或移除某个 wire 类型时，必须手工保持同步。

### 延后事项：真实迁移函数体

本 C-stage slice 中注册的每个迁移函数都是恒等函数，因为当前每个注册都是该 schema 自身的首个版本，没有需要转换的前驱 payload。某个 schema 第二个及以后版本的真实、非恒等迁移函数体，是后续 P-stage（`migrate.ts`）关注的事项。

### 延后事项：接入读取路径

`negotiateSchema` 是一个完整、真实且已测试的函数，但目前尚无 session replay、SDK `initialize` 或 plugin load 的调用点真正调用它——那部分接入是后续 U-stage 关注的事项。

</details>

-----

<a id="model-experience"></a>
## Model Experience

无；这是一个内部版本化与协商库，没有工具面或模型可见输出。

#### KV Cache effect

无直接影响；本包不会将任何内容放入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **真实迁移函数体被延后** — 当前每个已注册的 schema 都处于其自身的首个版本，因此这里的每个迁移函数都是恒等函数；某个 schema 第二个版本的真实转换函数体，随后续 P-stage 的 `migrate.ts` slice 落地。
- **尚未接入读取路径** — `negotiateSchema` 是真实且已测试的，但目前没有 session replay、SDK initialize 或 plugin load 的调用点调用它；该接入属于后续 U-stage slice。
- **SDK-protocol 的 schemaId 列表是手工镜像的** — `src/index.ts` 中的 `PROTOCOL_WIRE_SCHEMA_IDS` 必须与 `@deepseek-ai/dsh-sdk-protocol` 的 `src/types.ts` 中各接口的 schemaId 文档注释手工保持同步；目前没有任何机制自动交叉核对二者。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
