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

**投影清除做在 `@deepseek-ai/dsh-memory-context`**，不在环里。一次召回是该消费者自己的 `snapshot`-form 消息，而 `@deepseek-ai/dsh-llm` 的 `ContextForm` 'snapshot' 已承诺「同一 producer 的后一 snapshot 取代前一」——正是 `time-context` 与 `tmux-context` 依赖的机制。某步召回为空时，用一条不含任何被召回内容的 cleared 标记，取代本消费者早先在同一会话上留下的召回快照。是否有未清召回，按**持久会话日志**判断（`hasOutstandingRecall` 回扫最近一条 memory-context snapshot，除非它已是 cleared 标记，否则算未清），而非按 plugin 实例的内存，故 resume 后仍成立；且这次清除不论该步有没有 query 都跑，故开放轮 query 为空的一步也会清。从未召回过的会话不发任何东西。

持久文档新增一个 additive 顶层 `tombstones` 列表、**不升版本**：它不是逐记录字段，故一份早于它的 version-3 文档是完整的——它没遗忘任何东西——读回时没有墓碑，而非一个臆造的值。

## Alternatives considered

- **把召回经环的 runtime-context 快照走（做成 `RuntimeContextProjection` 的一节，它做 surface 替换）。** 否决：召回是 memory-context 自己的持久快照、已经走 producer-snapshot 取代契约，故修复局部于它如何管理自身快照的存续；把一个 query 驱动的召回变成 runtime-context 一节，会把这次读从 pre-step 里挪走，而它的 `memory/access` 事件与开放轮 query 都在 pre-step。
- **为 `tombstones` 升持久格式版本。** 否决：升版本是为守护旧记录缺、且不臆造就读不了的逐记录字段；一个新的顶层列表是「缺即无」，且 `durable-provider.spec` 断言写出的版本是 3。
- **为 supersede/merge 复用 `record.ts` 的 `recordConflict`。** 直接复用不行：它是按 P6-02 的规范 `MemoryRecord` 定型的，而 provider 存的是暂定的 `ScopedMemoryRecord`；一个本地的 `supersedeInto` 为存储形状编码同一条不覆盖规则。

## Consequences

- A-512 量到的现状，写在此处而非单独归档：此 build 没有作为独立对象的持久 memory 索引、cache 或会话 projection。`acceptance[1]` 的「索引」就是对存储的 `query` 扫描，「cache」是同一目录上的第二个 provider 实例，「projection」是 memory-context 的召回快照——故清掉存储即清掉前两者，memory-context 的改动清掉第三个。没有引入新的持久索引。
- 投影清除起初记在 plugin 实例的内存集合里、且只在有 query 的步跑，两处都漏被遗忘内容：resume 后集合为空（早先那条召回随重放的历史进下一次请求），且开放轮 query 为空的一步在清除前就返回了。lane B 的先红（B-657 第三笔，`P6-03.projection.composition.spec.ts`）正驱动这两处：一个先召回、遗忘、再在新进程里 resume 的会话；以及同一会话再跑一轮任务为纯空白、故其步无 query。两处现已堵上——按持久日志判断有无未清召回，并且不论该步有没有 query 都清；从未召回过的会话仍不发。
- 无 package.json 或锁文件变更：memory 已 peer-depend `dsh-principal`。生成类 `tool-cordis` api-catalog 投影会因新的 export 形状与 provider 动词而陈旧，留流水线重生成。
