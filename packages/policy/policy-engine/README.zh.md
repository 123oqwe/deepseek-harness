---
description: "Epic P2-05 的策略决策词汇与单调组合，供接入执行点或编写策略 provider 的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-engine

[English](README.md) | 中文

## 概述

`dsh-policy-engine` 固定了在本 harness 中"一个策略问题**是什么**"——identity、capability token、`ActionManifest`、`ExecutionWorld` 与声明式的上下文事实——一个闭合答案携带什么,以及支配插件如何影响答案的唯一规则:它们只能**收窄**,永远不能**放宽**。它不持有策略、不挂载服务、不 import 引擎;Cedar provider 是 `@deepseek-ai/dsh-policy-engine-cedar`,执行点属于 Trust Kernel。当你要写这两者之一、或要判定插件被允许向一个决策贡献什么时,阅读它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 一个策略请求携带五项输入,且五项全部必填

`PolicyRequest` 声明 identity(P2-01 的 `Principal`)、出示的 capability token(P2-02)、`ActionManifest`(P2-03)、执行世界(P3-01),以及声明式的上下文事实。没有一项是可选的。可选输入会让调用方省略一项却仍然拿到决策——引擎正是这样悄悄开始回答一个比它所记载的更小的问题。

`world` 在本树上以 `absent` 形态存在,因为 `ExecutionWorld` 归 P3-01 设计、尚不存在。`absent` 是策略**可以匹配**的值,而不是缺失字段:必须知道世界的策略可以在世界未知时拒绝。

上下文事实是闭合枚举——镜像 `@deepseek-ai/dsh-workspace-trust` 的工作区信任状态、镜像 `@deepseek-ai/dsh-risk-taxonomy` 的动作风险类别,以及会话的权限姿态。自由形态的事实包会让"新增一个事实"变成一次无声的策略变更。

### 决策是闭合的,而 `ask` 不是"软拒绝"

`PolicyEffect` 是 `permit | deny | ask`。`ask` 表示欠一个人类回答,且**只能**来自策略;插件返回的任何东西都产生不了它,也无法把 `deny` 变成它。请使用 `isImmediatelyAllowed` 而不是 `effect !== 'deny'`:后者读起来像"已允许",却悄悄把"还没有人回答"的状态算了进去。

每个决策都携带它据以做出的 `PolicySetDigest`,拒绝也不例外。一次分不清"策略变了"与"决策变了"的重放什么也证明不了。

### 插件可以贡献什么

`PolicyConstraint` 是 `(request) => string | undefined`——按**类型**只能拒绝,与 `@deepseek-ai/dsh-tools` 的 `ToolGuard` 是同一种构造。`composeDecision` 会应用每一个已注册的约束:`deny` 保持被拒;`permit` 或 `ask` 在**任一**约束反对时变为 `deny`;顺序不影响结果。即使决策已经是 `deny`,约束仍会被求值,于是审计记录的是"所有拒绝它的理由",而不是最先撞上的那一个。

### 当 provider 不在时

`decisionWhenUnavailable` 返回 `deny`,reason 为 `policy-unavailable`。provider 是普通插件,可以像任何插件一样被卸载;不可丢失的是**执行**,因此引擎缺席时由执行点自己作答。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 为什么这里没有引擎

组合规则是 harness 的性质,不是 Cedar 的性质。只有挂上引擎才能陈述的规则,是关于那个引擎的断言,它的测试证明的也会是 Cedar 的行为而不是本仓库的行为。这个切分与 `dsh-retry` / `dsh-retry-cockatiel` 一致:定义与决策在一个包,被采用的运行时在另一个包。

尽管如此,Cedar 仍是**本包测试的** devDependency,而且是刻意的。make-vs-use 记录中"采用引擎"的论据是:forbid 覆盖 permit、默认拒绝、以及给出匹配策略的 explain,这三条是 Cedar 的语义,而不是本仓库必须自己写的东西。`tests/cedar-conformance.spec.ts` 针对真实的 `@cedar-policy/cedar-wasm` 4.12.0 跑这三条,于是该论据立足于一次测量而不是上游文档。

那个文件还钉住了一个 provider 绝不能弄错的事实:以源码**字符串**提交时,Cedar 会分配生成的 policy id(`policy0`、`policy1`),而源码里的 `@id(...)` 注解**不会**成为 explain 报告的那个 id。provider 必须提交 id → 源码的映射,否则审计追踪会写出没人写过的策略名。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/types.ts`](src/types.ts) | 请求、闭合决策、reason code、仅供审计的 explain,以及 `PolicyConstraint` |
| [`src/evaluate.ts`](src/evaluate.ts) | `composeDecision`、`decisionWhenUnavailable`、`isImmediatelyAllowed` |
| [`tests/monotonic.spec.ts`](tests/monotonic.spec.ts) | 组合规则,含顺序无关性与"只能拒绝"的控制项 |
| [`tests/cedar-conformance.spec.ts`](tests/cedar-conformance.spec.ts) | 被采用的三条语义,针对真实引擎运行 |
| — | 不发布 invariant 伴生包:本包不拥有任何两个观察者可能看法不同的关系——每个导出都是对其参数的纯函数,而一个决策在同一次调用内做出并返回。 |

</details>

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者的工作上下文——点击展开</summary>

社区中最接近的包 `dsh-permission-rules` 以**首次匹配**解析有序的 allow/deny 规则——离用户更近的规则会覆盖基线 deny。它是"顺序无关性"那条用例存在的**负例**,而不是可借鉴的先例:在那种形态下,一个动作是否被允许取决于两个各自独立安装的插件谁先加载。

</details>

## Model Experience

无,因为本包只导出类型与纯决策,不注册工具、提示词文本或会话事件。

#### KV Cache effect

这里没有任何东西进入模型请求;一个决策抵达模型只以其执行点拒绝的形式出现,而那携带闭合的 reason code,绝不携带策略文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **`ExecutionWorld` 是一个只有单一取值的声明位。**P3-01 拥有世界模型且尚未落地,因此 `world` 恒为 `{ kind: 'absent' }`,任何策略都还无法据"动作将在何处运行"作判断。按 §12.46-B 分半记为 BLOCKED-178:本包拥有规则半边,P3-01 拥有生产者半边。
- **尚无任何东西消费这些决策。**这是 Contract 阶段。回答请求的 provider 与作用于决策的执行点属于后续阶段;读者不得把这些测试当作"今天已有动作被策略检查"的证据。
- **reason code 是闭合的,可能过粗。**它们会抵达模型,所以每一个都刻意无法指名某条规则、某个租户或某条路径。若操作者需要更细的模型可见理由,答案是在这里新增一个 code,而不是在某个调用点写自由文本。
