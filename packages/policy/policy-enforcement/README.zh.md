---
description: "Epic P2-05 的策略执行点，供接入派发路径或注册插件约束的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-enforcement

[English](README.md) | 中文

## 概述

`dsh-policy-enforcement` 是 harness 中一个动作被决定的地方,无论它由谁发起:它从 `ctx.policy` 读取决策,经 `composeDecision` 应用每一个已注册的插件约束,并请被钉住的 Trust Kernel 绑定结果并记录下来。在任何要执行策略的组合中挂载它,并在派发路径刚追加完 `ActionManifest` 之后立即调用 `enforceManifestedAction`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 决定一个动作

`enforceManifestedAction(ctx, { manifest, token, origin })` 返回一个 `ClosedDecision`。在 manifest 存在处调用它——**manifest 就是那个策略问题**,因此跳过决策的路径也跳过了 manifest,而那已被 P2-03 的 `assertManifestPrecedesExecution` 拒绝。

其内部顺序就是约定:引擎作答、插件可以收窄、kernel 绑定,审计记录在调用方动作**之前**追加。事后再写的记录,恰好会在"决定与执行之间进程死亡"时缺失。

### 注册一个约束

`ctx.policyConstraints.register(constraint)` 接受 `(request) => string | undefined` 并返回它的 disposer。约束随其插件的 fiber 一起释放:卸载的插件不再约束,而且没有任何一种返回形态能放宽决策。

### 没有挂引擎时

决策是 `deny`,reason 为 `policy-unavailable`,并写明本上下文最后见到的 policy-set digest。provider 是普通插件,可以在会话中途被卸载;不可丢失的是**执行**。

没有钉住 Trust Kernel 的组合会**抛错**而不是作出决策:无法执行的 harness 不得装作已经执行过。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

kernel 在每次调用时经 `ctx.get('trustKernel')` 解析,从不缓存:它在任何 entry 挂载之前就被钉住,因此即便插件替换了 policy 服务,也仍然无法让一个动作变成被允许。kernel 的 `deny` 会覆盖抵达它时的 permit;kernel 的 `allow` 永远不会放宽引擎或约束已经作出的拒绝。

传入的 Context 是**组合体的**,不是某个 agent 的。测试装置交给派发路径的 `Agent` 可能根本不带 `ctx`——在那里读 `agent.ctx` 是一个真实缺陷,而且它表现为三条并发用例**超时**而不是失败。

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `enforceAction`、`enforceManifestedAction`、约束注册表,以及审计记录 |
| — | 不发布 invariant 伴生包:本包不拥有任何两个观察者可能看法不同的关系——一个决策在同一次调用内产生、绑定并记录。 |

</details>

## Model Experience

无,因为本包为派发路径决定一个动作,不注册工具、提示词文本或会话事件。

#### KV Cache effect

这里没有任何东西进入模型请求;一次拒绝以其派发路径自己的错误结果抵达模型,携带闭合的 reason code,绝不携带策略文本。

## 已知局限与后续工作

- **调用它的是两条派发路径,不是五条。**原生工具路径与 code-mode 子派发都会到达它,而子 agent 与 workflow 子级自己的工具调用也经由原生路径抵达。进程外 SDK 派发与插件自身的 RPC 目前还没有 manifest 生产者,因此不在这里被决定——插件 RPC 的生产者属于另一个 epic。
- **策略看不到 token 的 verbs 与 resources。**跨过边界的是 `redactTokenForLog` 的投影——digest、subject、tenant、capability、委派深度、过期时间——P2-02 已审定这一形态在 token 层之外是安全的。因此策略可以拒绝"授权所指 capability 不对"的动作,却无法拒绝"授权缺少某个具体资源上的某个动词"的动作。扩展那个投影是 P2-02 的决定,不该由本包另起一份。
- **上下文事实默认取最严值,尚未从已挂载的服务读取。**在派发路径传入真实值之前,`workspaceTrust` 默认 `untrusted`、`permissionPosture` 默认 `default`;针对一个"悄悄兜底成放行"的事实所写的策略,执行的将不是它所声明的东西——这就是默认方向取严而非取便的原因。
- **审计记录送往 kernel 的 `auditAppend`,而在部署未配置 sink 时它是空操作。**没有接 sink 的组合会决策、会执行,但不会记录。

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
