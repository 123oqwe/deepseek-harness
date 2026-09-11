---
description: "Epic P2-05 的 Cedar 策略 provider，供配置策略集的部署方，以及想了解 harness 请求如何变成 Cedar 请求的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-engine-cedar

[English](README.md) | 中文

## 概述

`dsh-policy-engine-cedar` 在 Cedar 授权器之上挂载 `ctx.policy`:它把 harness 的策略请求翻译成 Cedar 的实体与上下文形态,再把答案读回 `@deepseek-ai/dsh-policy-engine` 的闭合决策;在**加载时**校验所配置的策略集,并把该集合的 digest 记在每一个决策上。授权语义归 Cedar;本包只拥有翻译与失败分类法。在需要执行策略的宿主组合中挂载它——它**只面向宿主**,因为 wasm 制品有 13 MB 且经 CommonJS 入口加载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [开发备注](#dev-note)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 策略集配置成 map,绝不要配成一整段源码字符串

```yaml
- name: '@deepseek-ai/dsh-policy-engine-cedar'
  config:
    policies:
      baseline-permit: 'permit(principal, action, resource);'
      destructive-forbid: 'forbid(principal, action, resource) when { context.sideEffectClass == "destructive" };'
```

键就是策略的身份,也是审计追踪记录的东西。若以一整段源码字符串提交,Cedar 会分配生成的 id(`policy0`、`policy1`),而源码里的 `@id(...)` 注解**不会**成为 explain 报出的 id——这样建出的审计会写出没人写过的策略名。

### 策略可以匹配什么

| Cedar | 来自 |
|---|---|
| `principal` | `Dsh::Principal::"<identity id>"` |
| `action` | `Dsh::Action::"<manifest 命名的 capability>"`——调用同一 capability 的两个工具是同一个问题 |
| `resource` | `Dsh::Resource::"<kind>:<path\|host\|command\|ref>"`——目标的 kind 会保留,因此文本相同的路径与命令是不同资源 |
| `context.sideEffectClass` | manifest 的副作用类别 |
| `context.classified` | 该类别是被声明的还是被兜底的 |
| `context.workspaceTrust`、`context.permissionPosture`、`context.riskClass` | 声明式的上下文事实 |
| `context.world` | 在 P3-01 落地 `ExecutionWorld` 之前恒为 `"absent"`;策略可以据此拒绝 |
| `context.tokenPresented` | 该动作是否携带了 capability token |

### 各类失败保持可区分

策略说"不"是 `forbidden-by-policy`(有规则命中)或 `no-matching-permit`(没有规则命中)。策略集读不了是 `policy-set-invalid`。完全没挂引擎是 `policy-unavailable`——由执行点作答,因为本服务已不在。把三者中的任意两个合并,都会让坏掉的部署看起来像很严的部署。

解析不了的策略集在**加载时**失败,而不是在第一次决策时:配置错误的部署应当拒绝启动,而不是表现为一次被拒的动作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 关于 digest

`policySetDigest` 按排序后的顺序对 id 与源码做哈希,每段都带长度前缀。排序,是因为重排过的集合还是同一个集合;带长度前缀,是因为 `{ab: 'c'}` 与 `{a: 'bc'}` 否则会哈希成同一个值。每个决策都携带它,于是重放分得清"策略变了"与"决策变了"。

### 为什么 `decisionFromAnswer` 是导出的纯函数

在已加载的引擎上,它的 `failure` 分支**不可达**:策略集在加载时已校验,而实体类型是本模块自己写下的常量而非请求数据。它是为"只有缺陷或未来某个 Cedar 版本才可能产生"的状态准备的 fail-closed 映射,因此把它作为**映射**来证明,而不是去搬演一个不会发生的运行时情形。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 请求翻译、digest、加载时校验,以及答案映射 |
| [`tests/provider.spec.ts`](tests/provider.spec.ts) | 翻译、审计 id、digest 行为、加载拒绝、卸载与重挂 |
| — | 不发布 invariant 伴生包:本包不拥有任何两个观察者可能看法不同的关系——一个决策在同一次调用内产生并返回。 |

</details>

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>供维护者的工作上下文——点击展开</summary>

Cedar 自身的语义——forbid 覆盖 permit、默认拒绝、给出匹配策略的 explain——在 `@deepseek-ai/dsh-policy-engine` 的 `tests/cedar-conformance.spec.ts` 中针对同一个 4.12.0 被证明。在这里再断言一遍,等于把库测两遍、把翻译一遍也没测。

那些用例测出的两个事实塑造了本模块:Cedar 以**小写**报告决策(`allow`/`deny`);格式错误的策略集回的是 `type: 'failure'` 而不是 deny。

</details>

## Model Experience

无,因为本包为执行点回答策略问题,不注册工具、提示词文本或会话事件。

#### KV Cache effect

这里没有任何东西进入模型请求;一个决策抵达模型只以其执行点拒绝的形式出现,而那携带闭合的 reason code,绝不携带策略文本。

## 已知局限与后续工作

- **尚无任何东西消费 `ctx.policy`。**执行点属于 Usage 阶段——它归 Trust Kernel;在它存在之前,本 harness 中没有任何动作被策略检查。读者不得把"provider 已挂载"当作"有东西被执行"的证据。
- **未加载 Cedar schema。**调用 `isAuthorized` 时不带 schema,因此策略只做解析校验,不针对声明的实体/动作 schema 校验——写成 `Dsh::Action::"typo"` 的策略能解析,只是永远匹配不上。加上 schema 意味着把 harness 的动作词汇作为数据声明出来,而那是 Usage 阶段的决定,因为路由那套词汇的正是执行点。
- **entities 为空。**没有传入实体层级,因此策略无法表达 `in` 关系(组、目录)。harness 目前也没有这样的层级可投射。
- **只面向宿主。**wasm 制品 13 MB 且经 CommonJS `nodejs` 入口加载;Client face 永不挂载本包。
