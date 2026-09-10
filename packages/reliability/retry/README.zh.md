---
description: "Epic P4-11 的重试决策词汇:失败分类法及其对照 action ledger 调和状态判定的可重试性、每个 run 全局的一份预算供所有在范围内的层记账,以及 hedge 排除规则——退避与 Retry-After 解析交给树里已有的实现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-retry

[English](README.md) | 中文

## 概述

`dsh-retry` 交付 Epic P4-11 所统一的决策:一次失败是否根本允许重试,以及一次尝试是否花费 run 的预算。`src/classify.ts` 承载分类法与 hedge 规则;`src/budget.ts` 承载 run 全局的记账;`tests/retry.spec.ts` 以 13 条用例覆盖二者。`src/index.ts` 重新导出它们,外加 Usage 阶段新增的两样:`chargedRun` 回答一次重试**记在哪个 run 上**,`RunRetryUsagePlugin` 是一个 run 的花费被计数的唯一处所。这份记账是**自供**的——一个实现只是映射加一条算术规则的 family 的既定模式——按部署变化的是**额度**,它是该插件的 `Config`。

registry 的问题陈述是:多个层各自决定可重试性,它们的上限于是相乘。修法是每个决策**只有一个**——而不是本包做得更多。

## 目录

- [本包刻意不做的事](#what-this-package-deliberately-does-not-do)
- [must[3]:由 ledger 决定一个副作用是否可以再次发出](#must3-the-ledger-decides-whether-an-effect-may-be-sent-again)
- [组合](#composition)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-this-package-deliberately-does-not-do"></a>
## 本包刻意不做的事

有两项机制树里已经有了,再写一份就是本 epic 要终结的重复(§12.64):

- **退避与抖动**属于 [`@deepseek-ai/dsh-llm-retry`](../../llm/llm-retry/README.zh.md),其抖动是*对称的*——在钳制之前既可能调高延迟也可能调低。对称抖动是正当的抖动,所以 P4-11 让那份实现去消费本包的分类器与预算,而不是替换它。`admitRetry` 接受一个已经算好的 `delayMs`。
- **`Retry-After` 解析**在 provider 边界由 `providerRetryAfterMs` 完成,其结果搭载在 `LlmError.providerRetryAfterMs` 上,而这个字段 LLM 服务已经在校验。本包不看任何 header。

这里也**没有断路器实现**,本包依赖里也没有任何断路器库。`src/provider.ts` 声明的是 `circuitBreaker` 这个 Service Definition——`BreakerDestination`、`BreakerOpenError` 与 `CircuitBreakerContract`——理由与 `@deepseek-ai/dsh-lease-contract` 声明 `leaseStore` 相同:服务名必须意味着契约,这样两个 Provider 才不会对"这个服务是什么"各执一词。连续失败计数、熔断时长与半开探测都是 `cockatiel` 的,依 make-vs-use 账本的 `adapt` 裁定在 [`@deepseek-ai/dsh-retry-cockatiel`](../retry-cockatiel/README.zh.md) 中采纳。手写一个断路器摆在采纳来的那个旁边,会让 harness 拥有两个。

<a id="must3-the-ledger-decides-whether-an-effect-may-be-sent-again"></a>
## must[3]:由 ledger 决定一个副作用是否可以再次发出

一次有副作用的尝试只有在幂等保证下才可重试,而 [`@deepseek-ai/dsh-action-ledger`](../../action/action-ledger/README.zh.md) 是唯一能给出这种保证的东西。`classifyFailure` **读取**它的状态,而不是重新判定幂等:

| `LedgerState` | 可重试 | 理由 |
| --- | --- | --- |
| `prepared` | 是 | 请求从未发出,因此不可能产生重复。 |
| `compensated` | 是 | 副作用发生过并已被撤销,所以这个键是已结清而非空闲。 |
| `sent` | **否** | 请求已发出且没有回执——正是 must[3] 存在的那种情形。 |
| `confirmed` | **否** | 它已经提交;再试一次就是重复。 |
| `ambiguous` | **否** | 重试恰恰是解决不了它的手段;它该走调和。 |
| *缺席* | **否** | 没有咨询过 ledger,这与"安全"不是一回事。 |

最后一行值得明说:把"缺席"读作"安全",会让 must[3] 只在挂载了 ledger 的地方成立,而在其他任何地方悄悄不成立。

<a id="composition"></a>
## 组合

`dsh-base` 以 `run-retry-usage` 行(`@deepseek-ai/dsh-retry/usage`)挂载这套记账,因此任何以 base 为底的 profile 上,一个 run 都只有一份预算,所有会重试的层都记在它上面。`llm-retry` 用 `ctx.get` 解析它,所以去掉该行的 profile 只是退回自己那套按会话计数的限额——即 P4-11 之前的行为——而不是启动失败。把它挂在共享 base 上,正是让 must[1] 在用户实际启动的 `dsh` 上**发生**,而不只是对愿意自行挂载的组合**可用**。

两个出厂值都是 `Config` 字段,可按 profile 修改:

| 字段 | 出厂值 | 依据 |
|---|---|---|
| `maxRetries` | 10 | 一个 run 跨所有层可以重做十次:到这个量级,run 已经明显是在打转,而不是在熬过一段短暂的不稳定。`llm-retry` 自己的单请求策略把一次请求的尝试次数压得远低于此,所以这条 run 级预算只在多次请求各自都重试时才会绑定。 |
| `maxDelayBudgetMs` | 300000 | 一个 run 最多**等待**五分钟。只限次数的预算,会让一个 run 在退避里耗掉一小时却仍显得节制;这一条才是运维真正感受得到的界限。 |

<a id="model-experience"></a>
## Model Experience

无,因为本包只把失败分类法、run 预算与断路器 Service Definition 作为对调用方所给值的纯决策导出,不注册任何 model 可见的东西。

#### KV Cache effect

这里没有任何东西进入模型请求;模型能观察到的只是它的调用方到底有没有发出请求,而那由各重试层拥有。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **`spendsRetryBudget` 的 `hedged` 输入尚无生产者。** 树里没有 hedging 生产者——hedging 属于 P5-04——所以这是 §12.46-B 拆分中的**规则**那一半。BLOCKED-166 记录了关闭条件:P5-04 必须给被 hedge 的尝试打上标记,规则才可能触发;在那之前,该规则只对构造输入被证明过。**一个有活调用者却没有可达输入的函数,是零调用者形态的一种更隐蔽版本**,故如实记录,不当作覆盖呈现。
- **MCP 客户端尚未记账到 run。** must[1] 的"所有层消费同一份预算"要跨层关闭,`llm-retry` 是第一层:它记的是**委托链根**的 run,于是父代与其子代共用一份额度。MCP 客户端挂在 run 上的重连是余下的在范围层;在它也记账之前,一个 run 仍可能经那条路径超支。
- **message-bus outbox 是按裁定出范围,不是被遗漏。** 它的 `decideDelivery` 是已验收的 P4-06 内部的按消息死信策略,回答的是"何时停止投递这条消息",而不是"一个 run 可以花多少去重做失败的工作"(§12.64)。

不发布 invariant 伴随包:本包不拥有任何两个观察者可能看法不同的关系——每个导出都是对其参数的纯函数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是给维护者的工作上下文:开放问题与尚未决定的方向。它明确**不具权威性**——出货行为与限制在上面各节与包代码中。

`RunRetryBudget` 是否也该携带一个墙钟截止时间(而不只是延迟上限)尚未决定。`maxDelayBudgetMs` 约束的是花在**等待**上的时间,这与约束"一个 run 可以持续尝试多久"不是一回事;一个快速重试到永远的 run 在两个限制之内都合规。Usage 阶段会显示各层是否需要第二个界;在没有调用方的情况下先发明它,正是本 epic 自己的条款图所反对的零消费者形态。

分类器把 `hedged` 当作一个事实接收而非自行推导,因为树里没有可供推导的 hedging 生产者。如果 P5-04 最终用比布尔更丰富的东西标记 hedge——比如一个标识竞速尝试的组 id——本字段应当跟随那个形状,而不是保留一个生产者还得压扁成布尔的字段。

</details>
