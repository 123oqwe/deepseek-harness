---
description: "启动时从 harness home 加载已保存的 workflow 定义：一个文件一个定义，digest 由读到的字节计算，经引擎自身的准入登记。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-filesystem

[English](README.md) | 中文

## 摘要

`dsh-workflow-filesystem` 让「已保存的 workflow」就是一个**文件**。挂载时它读取 harness home 下 `workflows` 目录中的每个 `.js` 与 `.mjs` 文件，并把每一个登记到已挂载的引擎上——形状与 `@deepseek-ai/dsh-skill-filesystem` 把一个 Markdown 目录变成 skills 相同。

登记不是执行。定义的 body 以字符串到达引擎、以字符串存放；此处不编译、不求值、不 import。这就是 Epic P4-09 的 acceptance[0]，也正是读取一个模型可写目录仍然安全的原因。

## 目录

- [使用本包](#use-this-package)
- [真正保护运行的是什么](#what-protects-a-run)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与工作流引擎一同挂载即可；它没有任何配置项。

```yaml
- name: '@deepseek-ai/dsh-workflow-worker-thread'
- name: '@deepseek-ai/dsh-workflow-filesystem'
```

每个文件成为一个定义。它的**名字取自文件基名**，绝不取自 body 里的字段：一个自报名字的 body 等于定义在断言自己的身份，而 registry 的版本历史按名字索引，于是一个在版本之间改了自己名字的 body 会把自己的历史劈成两半。

目录是 `<harness home>/workflows`，由推导得到而非配置。一个部署把工作流放在哪个目录并不是 profile 需要变化的选择，而第二个位置会让「这个定义从哪来」对同一次运行有两个答案。

挂载在把每个文件都交给引擎之后才完成，因此一次嵌套已保存工作流的运行不会取决于加载是否恰好先完成。目录不存在时得到零个定义而不是报错——一个尚未保存任何工作流的部署是常态，不是配置错误。

<a id="what-protects-a-run"></a>
## 真正保护运行的是什么

不是本插件的谨慎，而是引擎的登记检查。digest 由读到的字节计算，因此「文件变了」与「定义变了」不可能脱节，而一个声称自己是某个它并不哈希到的 digest 的定义，在这条路径上根本无法表达。引擎随后重算它并拒绝不符者，也在自递归定义被启动之前拒绝它。

被拒的文件连同名字与理由记录在 `ctx.savedWorkflows.refused` 上，加载继续。一个格式错误的文件不能让 harness 起不来，而操作者需要知道是哪个文件、为什么被拒。

挂载到一个没有登记接口的引擎上会大声拒绝，否则已保存的工作流会加载进虚空，而组合看上去仍然正确。

## Model Experience

None, as this package reads definition files and registers them and registers nothing model-facing.

#### KV Cache effect

此处没有任何内容进入模型请求，因此提供方的缓存复用不受影响。它加载的内容只通过 `workflow` 工具自身的界面到达模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **signer 是加载器自己，它什么都没有背书。** 文件拿到 `signer: 'workflow-filesystem'`，因为这是本构建能诚实声称的唯一来源——没有可用于校验更强来源的签名根。此处任何内容都不得被读作「某个已保存定义来自可信作者」的证据。
- **每个文件都登记为版本 1。** 加载器没有版本历史的概念：改动 body 后重新保存会在同一名字下登记一个新 digest，而 body 未变的文件会以 `already-registered` 被拒。版本编号属于写这个目录的那一方。
- **目录只在挂载时读取一次。** harness 运行期间新增的文件不会被拾取；`dsh-skill-filesystem` 会监视它的根目录，本包不会。

不发布运行时 invariant 伴随包：本插件只持有一份「加载了什么」的列表、不观测其它任何东西，因此检查器只会拿这份列表和它自己比较，而不是校对两个独立观测。

### Dev Note

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：开放问题与尚未定下的方向。它明确不具权威性——已发布的行为与限制在上面各节以及包代码中。

登记不在 `WorkflowEngine` 这个 seam 上，因此本加载器以结构方式命名它唯一需要的操作，并拒绝挂载到缺少该操作的引擎上。把 `RegisteredDefinition` 下移进 `@deepseek-ai/dsh-workflow` 可以让 seam 声明 `registerDefinition` 并去掉这个结构检查；已量：该移动涉及十个文件，全部在两个 workflow 包及其测试内。seam 是否应当承载登记——那会迫使每个引擎都实现它——尚未定下，在定下之前，结构端口是更小的承诺。

</details>
