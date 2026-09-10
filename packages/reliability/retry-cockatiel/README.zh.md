---
description: "Epic P4-11 的断路器 Provider:在 dsh-retry 的 Service Definition 背后,每个目的地一个 cockatiel policy,按重试分类器判定为端点不健康的连续失败次数熔断,并在下一次尝试到达 adapter 之前拒绝它。"
kind: "package-reference"
---

# @deepseek-ai/dsh-retry-cockatiel

[English](README.md) | 中文

## 摘要

`dsh-retry-cockatiel` 挂载 `ctx.circuitBreaker`,即 [`@deepseek-ai/dsh-retry`](../retry/README.zh.md) 声明的服务。`cockatiel` 拥有全部机制——连续失败计数、熔断时长、半开探测——依据 make-vs-use 账本对它记下的 `adapt` 裁定。本包只拥有两个属于本 harness 的决策:**哪些目的地是彼此独立的**,以及**哪些失败该算在端点头上**。

## 目录

- [拒绝是什么](#what-a-refusal-is)
- [按目的地记键](#keyed-per-destination)
- [由分类器决定什么算数](#the-classifier-decides-what-counts)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-a-refusal-is"></a>
## 拒绝是什么

`execute` 要么运行该操作,要么抛出 `BreakerOpenError` 而**根本不运行它**。没有"先问是否熔断、再自行决定"这条路:一个单独报告状态的契约,会把"查一下"这件事留给每个调用方,而忘记查的调用方照样编译通过、照样通过自己的测试。用例把拒绝断言成*打桩函数没有被调用*,而不是一个返回的标志位。

调用方自己的错误被原样抛回。被计数的失败在内部以私有的 `CountedFailure` 传递,好让 `cockatiel` 的谓词无需检查调用方的错误类型即可识别它;原始错误在出口处解包——等待 `LlmError` 的调用方不该收到一个断路器内部类型。

<a id="keyed-per-destination"></a>
## 按目的地记键

断路器状态按 `{ provider, baseUrl, model }` 保存,而不是按 provider 名。一个 provider 可以前置多个端点(`llm-deepseek` 每次调用按 call config 解析 base URL),同一 base URL 下的两个模型各自独立失败,一个部署的故障不该把健康的兄弟一起熔断。有一条冻结用例把一个目的地打过阈值,并断言**同一 provider 下**的第二个目的地仍然执行。

日后把它收窄为按 provider 记键不动契约,放宽则会动——所以从目的地起步。

<a id="the-classifier-decides-what-counts"></a>
## 由分类器决定什么算数

`execute` 接受一个 `classify` 回调,本包从不检查原始错误。一次失败是否意味着**端点**不健康,是 [`classifyFailure`](../retry/README.zh.md) 作用在只有调用方能读到的事实上的决策:策略拒绝与格式非法的请求都是永久性的,把它们计入会在一个健康的目的地上熔断。永久性失败直接穿过 `cockatiel` 的谓词,既不记成功也不记失败,断路器因而不动。

<a id="model-experience"></a>
## Model Experience

**无 model 可见面、无 token、无 KV-cache 影响。** 本包不新增工具、提示词文本或会话事件。拒绝只以"调用方拿这个抛出的错误做了什么"的形式抵达模型;断路器本身对一次请求不可见。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **尚无生产调用者。** 这是 Epic P4-11 的 Provider 阶段:断路器已挂载,并已对真实翻译过的 adapter 失败验证过,但没有任何出货路径把 LLM 调用经 `execute` 路由。重试循环在 `@deepseek-ai/dsh-llm-retry`,归 Usage 阶段重接——在那之前,读者不得把这些测试当作"出货 harness 会停止调用故障端点"的证据。
- **断路器状态按进程保存,不持久化。** 重启会把每个目的地重新闭合,因此对着一个已死端点重启的运行要再付一次阈值。持久化会让端点健康成为需要归属与淘汰策略的持久状态,而目前没有任何需求提出;若日后需要,`cockatiel` 提供 `toJSON`/`state`。
- **`openMs` 是固定时长,不是退避曲线。** `cockatiel` 支持逐次增长的熔断时长;本 Provider 只传一个时长,因为没有部署要求调一条曲线,而一个数字才是操作者能推理的东西。

<a id="dev-note"></a>
## Dev Note

本 Provider 把 policy 存在 `private readonly` 映射里,而不是 `#private` 字段。Cordis 交给调用方的是 Service 代理,方法里的 `this` 并非实例,`#private` 访问会抛 `Receiver must be an instance of class …`。`@deepseek-ai/dsh-lease` 的 store 出于同样原因写法相同。
