# Agent Note:fixture 刷新按身份配对 manifest,而查找的位置决定它是否真的生效

Status: implemented

[English](2026-09-09-refresh-identity-pairing-and-guard-order.md) | 中文

## 问题

`manifestIdempotencyKey` 是 `sha256(sessionId + actionId + argumentsHash)`([`identity.ts`](../../../../packages/action/action-manifest/src/identity.ts)),因此 fixture 携带的摘要无法在刷新时重算:新一轮运行的 session id 不同。`preserveFixtureVolatiles` 于是把已提交的摘要抄到新记录上——而它取用的记录来自 `stabilizeRefreshLog` 用 `existingIndex` 推进的**位置**配对。

位置不是身份。只要新日志在更早的位置多出或少掉一条事件,其后每条 manifest 都会与另一种类型的记录对上,`'idempotencyKey' in existingData` 为假,复制被跳过,fixture 保留的是新算出的摘要,而不是它已提交的那个。

新增一条 `action/risk-gated` 事件正是如此:**约 80 个 fixture 的摘要被改写,却没有任何门禁失败**,因为 [`normalize.ts`](../../../../packages/test-support/session-snapshot/src/normalize.ts) 在比较时把该字段掩码为 `{{idempotencyKey}}`。代码自身的注释记录了这件事此前已经发生过一次,当时"只有 packed/unpacked 相等这一个用例注意到了"。

## 决定

摘要按**身份**保留——`actionId` 与 `sequence`,由 `committedManifestKeys` 从已提交 fixture 每场景索引一次——而不是按记录所处的位置。`sequence` 必须进入键,因为同一个 action 可以在一个会话里以完全相同的参数合法地跑两次,两次的摘要不同。`argumentsHash` 被刻意排除:已提交 fixture 可能携带的是归一化后的值,而新记录持有真实摘要,以它为键将匹配不到任何东西并静默回落到新值——这正是本配对要消除的失败。在现有语料上,153 条 manifest 记录不产生任何 `(actionId, sequence)` 冲突。

**查找放在哪里,和查找什么同样重要;前两种放法都错了,第三种才成立。**保留逻辑拆为两步:`preservedManifestKey` 从**新**记录读取身份,`applyPreservedManifestKey` 负责写回。

- 读取必须在位置保留**之前**。`preserveNormalizedVolatiles` 会用配对上的已提交记录替换新记录的字段,之后 `actionId` 可能指向另一个 action,身份解析到别人的摘要。
- 写回必须在 `preserveFixtureVolatiles` **之后**。该函数会把错配的已提交记录的 volatile 字段抄到记录上,`idempotencyKey` 也在其中;更早的写回会被静默覆盖成错误摘要,fixture 最终与未修复时一模一样。

这是 [4.4a](../../../../spec/first100/exec/decisions-approved.md) 所说"机制存在但从未被触达"的下一层,而且是双向的:一次正确的查找,既可能被更早的步骤喂入被污染的输入,也可能被更晚的步骤丢弃输出;而由于该字段在比较前被掩码,所有门禁依旧全绿。

## 备选方案

**取消 `normalize.ts` 对 `idempotencyKey` 的掩码,让比较直接抓住被改写的摘要。**否决:摘要覆盖 session id,而它每次运行都不同,不掩码会让每一次合法刷新都失败。掩码本身是对的;缺的是"刷新不得改动比较看不见的值"这一条。

**刷新时用新的 session id 重算摘要。**否决:它只会自洽,什么也证明不了。fixture 里的值是"某次已提交运行以这些参数执行了该 action"的证据,重算等于丢弃证据,把该字段变成装饰。

**只用 `actionId` 作键。**否决:同一个 action 可以在一个会话里以相同参数跑两次,两次摘要不同,第二条会静默取走第一条的值。

**把 `argumentsHash` 纳入键。**基于实测否决:已提交 fixture 可能携带归一化后的值,而新记录持有真实摘要,查找将匹配不到并回落到新值——看似更精确,实则重新引入该缺陷。`(actionId, sequence)` 在语料的 153 条 manifest 记录上无任何冲突。

## 影响

一次插入或删除事件的刷新,不再扰动它并未产生的摘要。[`manifest.spec.ts`](../../../../packages/test-support/session-snapshot/tests/manifest.spec.ts) 中两个用例守住它:其一在两条已提交 manifest 之前插入一条事件,要求两条摘要都被保留;其反面对照要求一个真正新增的 action 保留自己新算出的摘要,因为此时无物可保留,凭空造一个只会更糟。

退回位置配对会让第一个用例变红。把读取移到位置保留之后、或把写回移到 `preserveFixtureVolatiles` 之前,同样会变红——这正是本 Note 存在的性质:修复是身份配对**加上**两处位置。

实测刷新可以佐证:对已提交 fixture 新增 `action/risk-gated` 事件后,86 个文件被改写,新增 148 行、删除 0 行,67 条发生变化的 manifest 行摘要逐字节一致;其余全部差异只是 `seq`、`throughSeq` 与 `sourceEventSeqs` 的顺延。
