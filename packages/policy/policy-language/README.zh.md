---
description: "Epic P2-10 的策略词汇:dsh 自己的请求所被塑造成的那份 Cedar schema——三个实体类型与十个已声明的 context 键——供编写策略的部署,以及供核查「一条策略究竟能不能匹配到任何东西」的读者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-policy-language

[English](README.md) | 中文

## 概述

`dsh-policy-language` 声明一条 dsh 策略可以指名的词汇:每个策略请求携带的三个 Cedar 实体类型(`Dsh::Principal`;`Dsh::Action`,其 id 是 manifest 的 capability;`Dsh::Resource`,其 id 是带 kind 限定的动作目标),以及请求构造器发送的十个 context 键。它不定义任何语法。按 Epic P2-10 的裁定 (b),dsh 的「有限声明式语言」**就是**这份词汇加上它的约定——另造一门编译到 Cedar 的语法会是第二个信任根,并且会重验 `@deepseek-ai/dsh-policy-engine-cedar` 已为 P2-05 冻结的授权语义。

围绕这份声明,本包补上词汇之所以存在的那些操作:`parsePolicySet` 拒绝解析不过、或读了词汇之外的键的策略集合;`compilePolicySet` 把一份被接受的集合变成重放所依据的、已钉住并已摘要的产物;而插件把这一整套注册成 `policy-set` 这个 settings namespace,好让部署有地方去写它的策略集合。插件还提供 `ctx.policySet`:`@deepseek-ai/dsh-policy-engine-cedar` 在每一次决策时向它要当前生效的集合与它的钉子,所以每一个决策、以及执行点为它追加的那条审计记录,都携带这份集合被接受时的钉子。

## 目录

- [使用本包](#use-this-package)
- [部署在哪里写它的策略集合](#where-a-policy-set-lives)
- [为什么需要一份 schema](#why-a-schema-at-all)
- [源码地图](#source-map)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

读 `DSH_CONTEXT_KEYS` 得知一条策略可以引用什么,读 `DSH_PRINCIPAL_TYPE` / `DSH_ACTION_TYPE` / `DSH_RESOURCE_TYPE` 得知实体类型。指名了它们之外任何东西的策略,是一条永远匹配不到东西的策略。

在部署的策略集合抵达之处调用 `parsePolicySet(policies)`。它回答 `{ok: true}`,或三种具名拒绝之一——`empty`、`unparsable`(带上出错那条策略的 id)、`unknown-context-key`(列出每一个越界的键,而不只是第一个);它先查语法再查词汇,所以一条解析不过的策略被报为解析不过,而不是被报成「没人发送的键」。对一份被接受的集合调用 `compilePolicySet(policies, {contextKeys, engineVersion})` 取得它的钉子:一道同时覆盖规范化策略文本、词汇与引擎版本的摘要——于是 Cedar 升级或词汇变动会**看得见地**重新钉住,而不是静默地改变同一段文本的含义。

<a id="where-a-policy-set-lives"></a>
## 部署在哪里写它的策略集合

挂载本插件会注册 **`policy-set`** 这个 settings namespace,它的 section 形如 `{policies: {<id>: <cedar 源码>}}`。它**要求**有一个 `settings` provider,并通过 `inject` 明说这件事:一个挂了本插件却没有 settings 的 harness 会注册不出任何东西、写不下任何策略集合、什么也不强制——而且是静默地。

```yaml
- id: policy-language
  name: '@deepseek-ai/dsh-policy-language'
  config:
    maxPolicies: 256
    maxSourceBytes: 1048576
```

两个界限是配置而不是常量,因为笔记本 profile 和舰队控制面不接受同一份策略集合。它们施加在**完整集合**上——策略总条数与 UTF-8 总字节——并且**先于解析**:一份大到不该被接受的集合,应该在按它的大小付出工作量之前被拒,而不是之后。

**本包不持有任何策略集合。** `@deepseek-ai/dsh-settings` 本来就会拒绝一次「其 owner 无法服务已存 section」的注册,也本来就会在后来的文档失败时保留该 namespace 的上一有效值、同时让别的 namespace 照常提交。本插件对这两件事的全部贡献,是那个说「不」的函数。下面三条后果来自**一次真实 boot 的观测**,不是来自那些保证的文档:

| 文档的状态 | 发生什么 |
|---|---|
| 启动时就已不可接受 | **boot 失败**:`policy set refused (unknown-context-key): …`。启动时没有上一有效值可留,所以「让 harness 挂在一份它已经拒绝的策略集合之上」不是一个选项 |
| 运行中变得不可接受 | namespace **保留它上一次接受的那份**——不是变空;这正是 fail closed 与 fail off 的区别 |
| 之后又变回可接受 | 新集合**会被取用**。保留上一有效值不等于闩死 |

<a id="why-a-schema-at-all"></a>
## 为什么需要一份 schema

对着 Cedar 4.12.0 实测:一条引用了 dsh 从不发送的 context 键的策略**解析干净、并通过 provider 的加载探针**,随后在它参与的每一次决策上以「无匹配理由」拒绝。它并不静默——`policy-engine-cedar` 把 Cedar 的每次决策错误映射进 `PolicyExplain.diagnostics`,所以审计每次都带着 `record does not have the attribute …`——但它迟到、重复,而且只有去读决策期诊断的人才看得见,那时已经有动作被一条本来就匹配不到的规则拒绝过了。

这份声明买到的,是把那条报告从**决策期**挪到**加载期**:只失败一次、在任何动作被错误拒绝之前失败、在部署被配置的地方失败而不是在它运行的地方失败。

**这里每一个键都由 `toCedarRequest` 里的一行担保**,而 Contract 阶段的漂移用例拿这份清单与那个 mapper 真正构造出来的请求相比。它**两个方向都会红**——这里声明了但没人发送的键,以及发送了却没在这里声明的键——因为一份比请求构造器更宽的 schema,制造的正是上面那种安静的失败。

<a id="source-map"></a>
## 源码地图

| 文件 | 角色 |
|---|---|
| [`src/schema.ts`](src/schema.ts) | 三个实体类型与十个 context 键——词汇本身 |
| [`src/parser.ts`](src/parser.ts) | `parsePolicySet` 与它的三种拒绝,先语法后词汇 |
| [`src/compiler.ts`](src/compiler.ts) | `compilePolicySet`,以及覆盖规范化文本、词汇与引擎版本的那道钉子 |
| [`src/index.ts`](src/index.ts) | `acceptPolicySet`——先限界、再解析、再钉住——以及 `PolicySetProvider`:它用 `acceptPolicySet` 注册 `policy-set` namespace,并在每次调用 `current()` 时从这个 namespace 作答 |
| — | 不发布 invariant 伴生包:本包不拥有任何「两个观察者可能看到不同结果」的关系——每个导出都是对其入参的纯函数,一次解析或一次钉住在同一次调用内产生并返回。 |

## 模型体验

None, as this package declares a vocabulary and registers no prompt, schema, tool, or session event.

#### KV Cache 影响

无;这里没有任何东西组装或贡献于一次 provider 请求,因此没有前缀移动、也没有已缓存前缀被失效。

## 已知限制与延期工作

- **影子评估、diff explain 与升级前的影响报告尚未建成** —— Epic P2-10 要求对策略集合做影子评估、解释两份集合的决策差在哪里,并在升级前重放历史 `ActionManifest` 生成影响报告。每个决策记录的钉子正是这样一次重放要比对的键,但树上没有任何东西执行影子评估、差异解释或重放。
- **对策略文档的非原子编辑可能只提交基线** —— 空的或被截断的文档会解析成「只有基线」这个合法集合,所以一次先截断再重写的写入,可能短暂地用基线替换部署的策略并把它提交(BLOCKED-243)。按 `docs/policy/language.md` 所述原子地替换文档;修复归 settings-file 的 watcher。
- **实体 id 不在这里被约束** —— `Dsh::Action` 的 id 是某条 manifest 指名的任意 capability,`Dsh::Resource` 的是带 kind 限定的目标。把这两个集合封闭起来会成为第二份词汇、带着它自己的漂移问题,而且没有任何子句要求它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

开放问题是实体 id 该不该被封闭。`Dsh::Action` 的 id 是由声明它的那个插件铸出来的 capability 名,封闭这个集合会让本包依赖树上的每一种能力。不封闭则意味着一条策略可以指名一个并不存在的 capability——它解析得过、加载得过、永不匹配,与 context 键写错时那种安静的形态同类,只是高一层。没有任何子句要求它,漂移用例也不覆盖它。

</details>
