# Agent Note：forget 留下墓碑并清掉召回投影；supersede、merge 与 erase 传播到索引

Status: implemented

[English](2026-09-26-memory-third-slice-lifecycle.md) | 中文

## Problem

P6-03 第三片欠 `must[3]`（支持 merge、supersede、forget、export、right-to-erasure，并传播到索引）、`acceptance[1]`（forget 之后主存、索引、cache、projection 在 SLA 内清除并留下合规墓碑）与 `acceptance[2]`（导出带记录的来源与冲突状态）。此片之前，`forget` 物理删除记录、不留任何痕迹，`export` 既无来源也无状态，seam 上也没有 `supersede`、`merge`、`erase`。`decideCrossScopeMerge` 与 `recordConflict` 两个决策函数存在，却无人调用。

投影那条最微妙。`@deepseek-ai/dsh-memory-context` 把召回的记录以一条持久的 `snapshot`-form 用户消息注入某步请求。一旦被召回过的记录被 forget，存储、默认检索、第二个读者都不再返回它——但早先那条召回快照仍留在会话历史里，随每次后续请求进入模型，于是被遗忘的内容照样到达模型。清掉存储不等于清掉投影。

## Decision

`ctx.memory` 在 seam 与三个 provider 上新增动词：

- **`supersede({ principal, scope, id, supersedes })`**——较新记录获得指向较旧记录的 `supersedes` 关系，较旧记录标 `superseded`；默认检索只返回较新的，`export` 两条都留（must[1]——冲突绝不覆盖）。
- **`merge({ principal, from, into, authorization? })`**——`into` 获得指向 `from` 的关系，`from` 被标记，故只有幸存者被检索。跨 scope 且无同时点名两个 scope 的 `authorization` 时，在改动任何记录之前经既有的 `decideCrossScopeMerge` 以 `MEMORY_MERGE_NOT_AUTHORIZED` 拒绝。
- **`forget`** 现在移除记录内容、留下一条 `{ id, forgottenAt, forgottenBy }` 墓碑、不含任何内容；`export` 列出访问上下文可见的墓碑。
- **`erase({ principal, tenantId, subject })`**——right-to-erasure——抹除该租户内关于该主体的每条记录，无论其会话或工作区；别的主体、别的租户不受影响。
- **`export`** 的记录现在带 `provenance`、`status`、`relations`；`query`/`get` 保持裸视图。

**投影清除做在 `@deepseek-ai/dsh-memory-context`**，不在环里。一次召回是该消费者自己的 `snapshot`-form 用户消息，但 `Session.deriveMessages` 折叠每一个追加的 surface 节点、不做 producer 合并，所以 `@deepseek-ai/dsh-llm` 的 `ContextForm` 'snapshot' 本身并不会把早先那条召回从请求里去掉——而 agent-loop 不变式（`invariant.ts`）断言请求的消息等于 `deriveMessages`，故一条陈旧召回会一直留到它的 surface 节点被移除。因此消费者自己实现这个快照语义，方式与 `RuntimeContextProjection` 实现系统提示相同：当某步的召回与 surface 上仍在的那条不同时，用一条空的 `system/message` 遮掉早先召回的节点——这是一个 derive 出空消息的 `replace`，故该节点被移除、而非留下一条空用户轮——再把新召回追加在尾部；某步召回为空但有早先召回时，只遮掉、不追加。是否有未清召回及其 seq，按模型可见的 **surface** 判断（`outstandingRecall`），而非按 plugin 实例内存或日志里的 cleared 标记，故已被遮掉的召回不会被再找到、resume 后按日志重建的 surface 与在线会话一致、且召回未变的一步什么事件都不发。从未召回过的会话不发任何东西。

持久文档新增一个 additive 顶层 `tombstones` 列表、**不升版本**：它不是逐记录字段，故一份早于它的 version-3 文档是完整的——它没遗忘任何东西——读回时没有墓碑，而非一个臆造的值。

## Alternatives considered

- **只靠 producer-snapshot 取代——追加一条更新的（或 cleared）快照，指望 `ContextForm` 'snapshot' 去掉早先那条。** 先试了（v1/v2）后否决：`deriveMessages` 折叠每一个追加的节点，故新旧两条快照都进请求；这个取代是 surface 节点的契约、只有 `replace` 才能实现，不是装配时的合并。本片把那次追加改为一条遮掉早先召回节点的 `replace`。
- **在装配之后过滤被遗忘的召回——在 `buildRequest` 里、或在 `llm/stream` 上。** 否决：`invariant.ts` 断言请求的消息等于 `session.deriveMessages()`，故任何装配后的过滤都会让请求与日志重建的持久推导脱节；且把记忆专用的过滤放进通用的环是错误的层。唯一不破不变式的点是 surface，而 `deriveMessages` 折叠它——所以修复是一次 surface `replace`，不是请求改写。这是 B 类第 23 题的选项 (a)，用户选的。
- **改写会话日志以去掉被遗忘的召回（第 23 题选项 (c)）。** 用户取 (a) 而弃它：日志是只追加的历史，改写它会抹掉「模型在 forget 之前确实见过该召回」这条记录。遮蔽是一条追加的 `replace` 事件；早先那条召回事件仍留在日志里。
- **收窄条款，使已发出的召回无需清除（第 23 题选项 (b)）。** 不归本 lane 定：收窄一条冻结的条款是用户的决定。
- **用空的 `user/message` 或 `assistant/message`、而非 `system/message` 来遮蔽。** 不可行：`user/message` 恒 derive，故一条空的仍会作为空用户轮进请求；`assistant/message` 的 `SurfaceIntent` 禁止 `sourceEventSeqs`，而 `replace` 必须带它。`system/message` 空是唯一能被 `replace` 带上 provenance 的 derive-空 surface 类型，且 `RuntimeContextProjection` 忽略空 system 节点，故它不扰动系统提示。
- **为 `tombstones` 升持久格式版本。** 否决：升版本是为守护旧记录缺、且不臆造就读不了的逐记录字段；一个新的顶层列表是「缺即无」，且 `durable-provider.spec` 断言写出的版本是 3。
- **为 supersede/merge 复用 `record.ts` 的 `recordConflict`。** 直接复用不行：它是按 P6-02 的规范 `MemoryRecord` 定型的，而 provider 存的是暂定的 `ScopedMemoryRecord`；一个本地的 `supersedeInto` 为存储形状编码同一条不覆盖规则。

## Consequences

- A-512 量到的现状，写在此处而非单独归档：此 build 没有作为独立对象的持久 memory 索引、cache 或会话 projection。`acceptance[1]` 的「索引」就是对存储的 `query` 扫描，「cache」是同一目录上的第二个 provider 实例，「projection」是 memory-context 的召回快照——故清掉存储即清掉前两者，memory-context 的改动清掉第三个。没有引入新的持久索引。
- 投影清除按 surface 取未清召回、用一条空的 `system/message` 遮掉其节点，故 lane B 的两条先红（`P6-03.projection.composition.spec.ts`）都堵上：一个先召回、遗忘、再在新进程里 resume 的会话；以及同一会话再跑一轮任务为纯空白、故其步无 query。`P6-03.lifecycle.composition.spec.ts` 的 forget 后投影用例也同样堵上。早先的尝试改为追加一条 cleared 快照，`deriveMessages` 把它与旧的一起折叠、被遗忘内容仍进请求；`replace` 才移除该节点。`memory-context-idempotent.spec.ts` 补上本片引入的唯一新行为：两轮召回同一记录只留一条召回、无遮蔽。
- 天然不覆盖：会话日志里仍留着 forget 之前那条召回的原文（只追加的历史——模型当时确实见过它，且 `replace` 是追加事件、非改写）；forget 之前已发出的请求带过该内容、撤不回；已被 compaction 遮走的召回节点已无物可供本消费者再遮。
- 无 package.json 或锁文件变更：memory 已 peer-depend `dsh-principal`，memory-context 已 peer-depend `dsh-llm`。生成类 `tool-cordis` api-catalog 投影会因新的 export 形状与 provider 动词而陈旧，留流水线重生成。
