---
description: "action 分组导览：声明一次工具调用将要做什么的 manifest，以及让同一次外部副作用不会发生两次的 ledger，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/action

[English](README.md) | 中文

## 概述

action 分组回答关于"一次被尝试的副作用"的两个问题:**它是什么** —— 一份 manifest,点名能力、规范化后的参数,以及副作用类别;**它是否已经发生过** —— 一本 ledger,在发送前预留、在结束后记录结果,使得重试不会产生第二次副作用。两者刻意分开:**manifest 是策略引擎要裁决的那个问题**,而 ledger 是那次裁决留下的记录。两者都不注册工具、也不进入模型请求;模型能观察到的只是它的调用有没有跑,而不是这些记账。

每个包自己的 README 位于下一层目录,目前只有英文版,这也是下面那些名字没有做成链接的原因:否则本页就会声称存在一个并不存在的中文对应页。

## 目录

- [包](#packages)
- [尚未抵达的部分](#what-is-not-arrived-yet)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| `action-manifest` | Epic P2-03 的一等公民 ActionManifest:构造、RFC 8785 参数规范化、内容寻址摘要,以及策略裁决所针对的副作用分类 | —（一个库;纯决策函数） |
| `action-ledger` | Epic P4-12 的外部副作用幂等账本:授权一次发送的预留、epoch fencing,以及事后记录的回执 | `ctx.actionLedger` |

manifest 是承重的那个想法。**manifest 本身就是策略问题** —— 一条跳过了裁决的分发路径,同时也跳过了 manifest,这正是 `assertManifestPrecedesExecution` 选择拒绝这个顺序而不是信任它的原因,也是 ledger 的预留以 manifest 的摘要为键、而不是以调用方自选的 id 为键的原因。

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

取自各包自己的 Known Limitations,因为把本组散文与运行中的系统对照的读者,不该靠读源码去发现这些缺口。

- **manifest 的 `requiresApproval` 只被记录,没有被强制。** 没有任何生产代码读这个标志去拦截什么。
- **目前每一次原生工具调用都无法分类**,所以那个 fail-closed 默认值是常态而不是边缘情况。
- **ledger 只预留,不结算。** agent loop 里的生产调用方取走了预留;对应的结算没有接线,因此 `ambiguous` 无法区分"不可知"与"仅仅是失败了"。
- **没有任何传输层携带幂等键。** `idempotencyHeader` 点名了真实 provider 会收到的那个 header;今天没有任何东西发送它。

-----

<a id="related-documentation"></a>
## 相关文档

- [Policy 子系统](../../docs/subsystems/policy.zh.md) —— manifest **用来做什么**的权威契约:`PolicyRequest` 把它作为必填输入,而 `enforceManifestedAction` 正是在分发路径刚追加了 manifest 之处被调用。
- [Core 子系统](../../docs/subsystems/core.zh.md) —— `ctx.actionLedger`,以及针对它做预留的那条分发路径。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:开放问题与尚未定下的方向。它明确不具权威性 —— 已发布的行为与边界位于上面各节以及每个包自己的 README 中。

本分组尚未定下的开放问题是 **`CapabilityRef` 这个字符串可以说些什么**。它的文法刻意未固定,而 manifest 包也刻意不 import 能力令牌的词汇去钉住它,于是两个生产者可以用不同名字指同一个能力,而没有任何东西会察觉。要固定它,就要决定 manifest 是依赖令牌那条 seam,还是保留自己的一套名字。

第二个问题是 **一个被声明的分类是否应当被原样采信**。`classifySideEffect` 把声明的类别当作既定事实,并且只对 `destructive` 要求审批;一个少报的调用方会被相信。在每次原生调用本来就无法分类的今天这站得住,而在分类开始工作的那一刻就站不住了。

</details>
