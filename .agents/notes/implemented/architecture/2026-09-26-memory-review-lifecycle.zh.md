# Agent Note: A memory proposal held for review is listed, then approved or rejected by a person

Status: implemented

[English](2026-09-26-memory-review-lifecycle.md) | 中文

## Problem

P6-03 第一片让提案策略把写入送去复审——以 `pending` 存储、挡在召回之外——但没有任何东西能对被扣提案采取行动。一条 `pending` 记录无法转为 `active`（批准）或被拒（拒绝），也无法被列出，因此被策略扣下的 memory 会永远等待。`must[0]` 还要求提案陈述其预期用途与 TTL，而第一片二者都不查：省略 `purpose` 或 `validUntil` 的提案被当作完整而 auto-accept。而 `must[2]`——高敏感默认人工——需要的正是「人」来决定；当时没有任何东西在决定处区分 user 与 agent 或 service principal。

## Decision

`ctx.memory` 新增三个复审动词，接缝与三个 provider 都实现：

- **`listPending({ accessContext })`**——access context 可见的 `pending` 提案，像 `export` 一样按 scope 限定并 cap；是报告通道，不是检索。
- **`approve({ principal, scope, id })`**——`pending` → `active`。
- **`reject({ principal, scope, id })`**——`pending` → `rejected`（永不 active）。

`must[0]` 完整性在 `decideProposal` 里最先判：省略 `purpose` 或省略 `validUntil` 的提案被扣复审。为区分省略的 TTL 与陈述的「不设期限」，`MemoryProposeRequest.validUntil` 改为 `string | null`——显式 `null` 是已陈述、完整；缺键则未申明、被扣。

两条 fail-closed 规则守着迁移。只有 **user principal** 能决定：`MemoryRuntime.approve`/`reject` 在接缝层、到达 provider 之前用 `MEMORY_REVIEW_FORBIDDEN` 拒绝 agent 或 service principal，因此被拒的决定让提案留在 `pending`。而对 scope 看不到的、或不指向 `pending` 记录的 id 的迁移会被拒——未知或越 scope 的用 `MEMORY_RECORD_NOT_FOUND`（不可区分，正如 `revise`/`forget` 已有的处理），已决的用 `MEMORY_NOT_PENDING`。`pendingViews` 与 `reviewTransition` 是三个 provider 共用的主体。

出厂的操作者入口是以宿主用户身份运行的 `dsh memory` CLI（单独一笔，形状由 lane B 的 B-658 用例定），因为人必须能批准被扣提案，否则 `pending` 永不清空。

## Alternatives considered

- **让复审经 P2-12 human-channel 走一次跑到一半的提问。** 否决：复审是事后的——操作者翻看被扣列表并决定——不是一次跑到一半停下来问。出厂入口是宿主用户运行的 CLI，不是 `human-channel` 提问，照 delegate 的裁定。
- **把省略的 `validUntil` 与显式 `null` 合并（都当开放式）。** 否决：`must[0]` 要求*陈述过的* TTL，而「永不过期」是 writer 做的决定（`validUntil: null`），与什么都不说不同。合并二者会 auto-accept 一个没陈述 TTL 的提案。
- **把 user-principal 检查放进每个 provider。** 否决：它是对每个 provider 都成立的接缝层授权，所以在 `MemoryRuntime` 里、到达 provider 之前只放一处——`requireCompleteAccessContext` 已在的地方——而不是在三个后端里各实现一遍、可能各自漂移。

## Consequences

- 被扣提案现在有完整生命周期：列出，然后 approve（可召回）或 reject（永不）。带 tombstone 的 forget、带来源与冲突状态的 export，以及 merge/supersede 向索引的传播，归第三片。
- 无 package.json 或锁文件变更：memory 已 peerDep `dsh-principal`，接缝读它的 `Principal.kind`。CLI 操作者入口是一个新命令包，单独一笔。
- 策略单测夹具现在陈述 purpose 与 TTL，否则 `must[0]` 规则会把它们扣去复审；它们的 `must[0]` 覆盖是显式的。
