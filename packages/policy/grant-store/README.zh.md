---
description: "为 Epic P2-08 第一片提供可复用的、带作用域与过期的能力授予:授予词汇表、拒绝无作用域或永久草稿的纯校验、只按谓词与限额匹配且由两条覆盖授予中更严格的一条裁定,以及一个进程内存储与一个 fail-closed 的 worker 视图。"
kind: "package-library"
---

# @deepseek-ai/dsh-grant-store

[English](README.md) | 中文

## 概述

`dsh-grant-store` 是 Epic P2-08 的第一片:一条可复用的授予被限定到某个 actor、某项 capability 与某个资源前缀,携带金额、使用次数与时间窗口限额,指名一个环境,并会过期。`src/types.ts` 持有词汇表;`src/match.ts` 校验一份草稿,并只按授予的谓词与限额把一个动作与之匹配;`src/store.ts` 是一个进程内存储,负责签发、列举、撤销与计数使用,外加一个在 epoch 变化时重读、并 fail-closed 的 worker 视图。本片不挂载任何东西——接进权限栈的接线要等 P2-07。

## 目录

- [授予裁定什么,不裁定什么](#what-a-grant-decides)
- [由构造保证的作用域与过期](#scoped-and-expiring)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="what-a-grant-decides"></a>
## 授予裁定什么,不裁定什么

`matchGrants` 读一条授予的谓词——actor 的 tenant 与 principal、capability 的 action、资源前缀、环境——以及它的限额——最大金额、使用次数、时间窗口与过期。它从不读动作的 `justification`:模型撰写的「这已获批」不改变任何裁定,模型撰写的「不要允许这个」也一样不改变。没有任何授予覆盖、或落在某一条覆盖授予的限额之外的动作,不被任何授予允许,于是执行点把它退回审批或拒绝。

当两条授予覆盖同一个动作时,更严格的那条裁定:一个金额落在较宽的授予之内、却超过较窄的那条,被拒绝。这是库层的布尔允许/拒绝,不是审批;这里没有任何东西凭自身权威拒绝一个动作,与 `packages/policy` 的其余部分一样,是报告而非执行。

<a id="scoped-and-expiring"></a>
## 由构造保证的作用域与过期

`validateGrantDraft` 拒绝两种形状,使存储无法持有它们。一份缺少 actor、capability 或资源谓词的草稿——或其资源前缀为空、因而会覆盖每一个资源——是 `GRANT_UNSCOPED`。一份过期缺失、非数值或非有限的草稿是 `GRANT_NO_EXPIRY`,故没有授予是永久的。作用域先被检查,故一份既无作用域又永久的草稿读作无作用域。`createMemoryGrantStore().issue` 跑同一套检查,并抛出一个携带该 code 的 `GrantError`,让存储保持为空,故被拒的草稿从不被存下。

一次撤销推进存储的 epoch。一个在该存储之上打开的 `GrantView` 会在 epoch 移动时重读它的授予,故一次撤销在 worker 下一次授权时抵达它;一个 epoch 或授予读不出的来源不允许任何东西,故一个够不到的 worker 是 fail-closed 而非 fail-open。

<a id="model-experience"></a>
## 模型体验

无。本包不注册任何工具、提示文本或会话事件,故它拥有的东西都不到达模型请求。

#### KV Cache 影响

这里没有任何东西进入请求,故 provider 的缓存复用不受影响。模型最终读到的关于某次授予裁定的内容,是消费它的执行点选择说的话,而那个选择属于消费方。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本片只是库。尚不存在任何 Cordis 服务、provider 或挂载:授予存储不在任何 profile 里,权限裁定期间也没有任何东西读它。把它接进审批/拒绝路径的 Provider 与 Use 阶段随 P2-07 的持久审批队列到来,届时本包才加入 SDK 运行时闭包。
- `GrantView` 模型化的是在一个进程内来源之上、有界的撤销传播。真正的跨 worker 分发——一个持久来源、一个序列化边界,以及 acceptance[2] 的撤销竞态与离线 worker 故障——是第三片的工作。
- 存储把授予 id 铸成一个进程内计数器,并把授予持在内存里;持久性与跨进程身份随持久来源到来。
- 不发布运行时不变式伴随包:本库不持有状态,也不拥有两个观察者可能各执一词的关系——它的函数与进程内存储对调用方提供的授予作出裁定,而尚无任何东西跨越进程边界——故一个检查器无从对账。
