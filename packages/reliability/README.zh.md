---
description: "可靠性组地图：重试分类、全 run 唯一的重试预算，以及按目的地的断路，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/reliability

[English](README.md) | 中文

## 概述

可靠性组判定一次失败的远程调用是否值得重试、一个 run 可以为重试花多少,以及一个端点在什么时候干脆不再被调用。借助它,组合中的每个重试层都从**同一份**全 run 预算里支取,而不是各留一份;正在失败的模型端点在请求抵达它之前就被拒绝。本家族是可选项,且只面向宿主侧:它不注册工具、不注入提示词,也不写入会话事件,因此模型能观察到的只是它的请求究竟有没有发出——永远看不到这套机制本身。当组合要与远程模型 provider 通信时挂载它;不通信的组合可以省略整个组。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`retry`](retry/README.zh.md) | 失败分类法、run 预算的记账,以及断路器的 Service Definition | `ctx.runRetryUsage` |
| [`retry-cockatiel`](retry-cockatiel/README.zh.md) | 断路器 provider:按目的地各持一个 `cockatiel` policy | `ctx.circuitBreaker` |

-----

<a id="related-documentation"></a>
## 相关文档

- [Reliability 子系统](../../docs/subsystems/reliability.zh.md)——规范性约定:失败事实与分类、按委派根归属的预算,以及按目的地的断路。
- [LLM Streaming 子系统](../../docs/subsystems/llm-streaming.zh.md)——本组所分类的失败来自其中的 adapter 约定,而在第一个 chunk 处咨询断路器的正是那个服务。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者的工作上下文——点击展开</summary>

两个服务都由消费者用 `ctx.get` 解析,而非 `inject`:硬依赖会让 `llm-retry` 与 `llm/llm` 在每个不挂载重试家族的组合里根本无法注册——包括它们自己的测试组合。因此"缺席"必须在每个调用点读作能力缺失,两个消费者都退回到本 epic 之前的行为,而不是退回到无限额度。

`spendsRetryBudget` 的 `hedged` 输入尚无生产者——对冲属于 P5-04——因此该规则只针对构造出的输入被证明。包 README 把它记为"已知局限",而不是记为覆盖。

</details>
