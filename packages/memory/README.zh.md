---
description: "memory 分组导览：provider 中立的持久 Memory seam、它与会话日志的分界，以及真正为模型执行回忆的 Consumer 位于何处，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/memory

[English](README.md) | 中文

## 概述

memory 分组只持有一件事：**被有意留存**的记录所对应的能力 seam——用户陈述过的事实、团队做出的决定——跨越每一次会话而持久，按租户与 principal 编键，而不是按对话编键。它刻意对"provider 如何找到一条记录"保持沉默：`query()` 接受自由文本，至于是嵌入索引、图，还是子串扫描给出答案，那是 provider 自己的事，从不进入本 seam 的词汇。该分组可选且仅在宿主侧；当某件事必须在学到它的那次会话结束之后仍被记住时挂载它，否则整组省略。

本分组只有一个包，因为这个 seam 只是一份契约。真正让它**有用**的那部分——把记录回忆进模型上下文——是一个 Consumer，而 Consumer 与它所关心的问题同处一地，而不是与它所消费的能力同处一地。

## 目录

- [包](#packages)
- [memory 不是什么](#what-memory-is-not)
- [尚未抵达的部分](#what-is-not-arrived-yet)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory`](memory/README.zh.md) | provider 中立的 Memory 服务：propose/query/get/revise/forget/export、按调用选择 provider、由 seam 自己强制的 `principal`/`purpose`/`scope`/`contextBudget` 读取定界，以及内存版与持久文件版 provider | `ctx.memory` |

`propose()` 是这个 seam 唯一的变更动词——没有 `write`、`set` 或 `put`——因此一条持久记录不可能从别处产生。读取在 seam 处定界，而不是在 provider 中：`query()`、`get()` 与 `export()` 会在任何 provider 被触及之前，以 `MEMORY_ACCESS_CONTEXT_REQUIRED` 拒绝不完整的访问上下文，这正是 provider 永远不会被递来一次无定界读取的原因。

**执行回忆的 Consumer 不在本分组。** [`@deepseek-ai/dsh-memory-context`](../context/memory-context/README.zh.md)——把记录回忆进模型请求、并为每次读取写入一条 `memory/access` 事件的插件——位于 `packages/context/`，与其他请求上下文插件在一起。这个位置是能力 seam 的角色划分，不是偶然：本分组拥有"一条 memory **是什么**"，而 Consumer 拥有"模型**何时**该看到一条"。

-----

<a id="what-memory-is-not"></a>
## memory 不是什么

关于本分组最常被问到的分界，是 Memory 与 [Session Query](../../docs/subsystems/session-query.zh.md) 的区别，而两者从不可互换。Memory 只持有调用方显式 propose 过的内容，跨越每一次会话，并且可被修订或遗忘。Session Query 读取的是普通会话活动本就产生的对话语料，作用域限于一次会话，且是只读的——因为会话日志仅可追加。两者互不充当对方的后端：Memory 从不读会话日志来回答一次查询，Session Query 也从不读一条 memory 记录。

"我们在这次对话里早些时候说了什么"是 Session Query 的问题。"这位用户跨越每一次对话、持久地告诉过我们什么"是 Memory 的问题。

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

记在这里，是因为本分组的各 README 所描述的契约只被生产代码部分触及；把散文与运行中的系统对照的读者应当知道哪些是哪些。

- **模型不能调用 memory。** 不存在面向模型的工具：模型只能读到回忆 Consumer 摆在它面前的内容，无法自行查询或 propose。改变这一点的工具包不在所属 epic 的范围内。
- **只有经由该 Consumer 的读取才被完整记录。** `memory/access` 有真实的发射方，但它属于 `memory-context`。`ctx.memory` 的其他调用方除非自己追加该事件，否则什么也不记录。
- **持久 provider 是单宿主的。** `createDurableFileMemoryProvider` 每次变更都整份重写一个 JSON 文档，在按实例的链上串行化，并以"先写临时文件再 rename"提交。这适合单个宿主的记录量；跨进程的多写入方存储不在范围内，而那两个内存版 provider 的存在是为了证明 provider 可替换，不是为了留存任何东西。
- **格式变更会拒绝旧存储，而不是迁移它。** 本构建只写入并只接受文档版本 3，更旧的存储会在首次读取时按名失败。这是有意贯彻的预发布立场：为一条写入时尚无这些字段的记录填入 `createdAt`、`validFrom`、`validUntil`、`status` 与 `relations`，等于把本构建的假设当作写入方陈述过的事实呈现出来。

-----

<a id="related-documentation"></a>
## 相关文档

- [Memory 子系统](../../docs/subsystems/memory.zh.md) —— `ctx.memory` 的权威契约、provider 中立的词汇，以及本页所概述的 Memory 与 Session Query 对照表。
- [Session Query 子系统](../../docs/subsystems/session-query.zh.md) —— 最常与 Memory 混淆的那个 seam。
- [持久化目录](../../docs/persistence-catalog.zh.md) —— 相关的持久会话事件，`memory/access` 即在其中。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：开放问题与尚未定下的方向。它明确不具权威性——已发布的行为与边界位于上面各节以及该包自己的 README 中。

分组层面的开放问题是**一个只有一个包的分组是否应该存在**。替代方案是把这个 seam 放进某个已有分组，让 `packages/memory/` 消失。保留它的理由是：分组是一个部署整体省略的单位，而 memory 恰恰是一种组合会整体谢绝的能力；反对的理由是：一个唯一 Consumer 在别处的分组，不过是个只住了一位居民的目录。尚未决定，而且值得在第二个 memory 包被写出来**之前**决定，而不是之后。

第二个问题是**既非内存版、也非单宿主文件版的 provider 该放在哪里**。嵌入式或图式 provider 正是这个 seam 之所以做成 provider 中立的那个用例，而至今没有任何东西被写出来，用真实后端检验这个主张。这样一个包是加入本分组、还是在仓库之外发布，尚待决定，而这个答案将决定本分组的形状能否推广。

</details>
