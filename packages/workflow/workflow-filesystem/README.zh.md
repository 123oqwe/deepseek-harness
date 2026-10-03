---
description: "启动时从 harness home 加载已保存的 workflow 定义：一个文件一个定义，只有签名能用已配置的信任锚核验通过才登记，经引擎自身的准入登记。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-filesystem

[English](README.md) | 中文

## 概述

`dsh-workflow-filesystem` 让「已保存的 workflow」就是一个**文件**。挂载时它读取 harness home 下 `workflows` 目录中的每个 `.js` 与 `.mjs` 文件，并把每一个登记到已挂载的引擎上——形状与 `@deepseek-ai/dsh-skill-filesystem` 把一个 Markdown 目录变成 skills 相同。

登记不是执行。定义的 body 以字符串到达引擎、以字符串存放；此处不编译、不求值、不 import。这就是 Epic P4-09 的 acceptance[0]，也正是读取一个模型可写目录仍然安全的原因。

只有签过名的定义才会登记。定义旁边的签名文件写明的 digest 必须是读到的字节算出的那个，签名必须能用部署配置的某个 offline-signed 信任锚核验通过，定义才会加载；其余一律拒绝并写进日志。

## 目录

- [使用本包](#use-this-package)
- [给已保存的 workflow 签名](#sign-a-saved-workflow)
- [真正保护运行的是什么](#what-protects-a-run)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

出厂 base 层把它挂在工作流引擎旁边；它没有任何配置项。

```yaml
- name: '@deepseek-ai/dsh-workflow-worker-thread'
- name: '@deepseek-ai/dsh-workflow-filesystem'
```

每个文件成为一个定义。它的**名字取自文件基名**，绝不取自 body 里的字段：一个自报名字的 body 等于定义在断言自己的身份，而 registry 的版本历史按名字索引，于是一个在版本之间改了自己名字的 body 会把自己的历史劈成两半。

目录是 `<harness home>/workflows`，由推导得到而非配置。一个部署把工作流放在哪个目录并不是 profile 需要变化的选择，而第二个位置会让「这个定义从哪来」对同一次运行有两个答案。

挂载在把每个文件都交给引擎之后才完成，因此一次嵌套已保存工作流的运行不会取决于加载是否恰好先完成。目录不存在时得到零个定义而不是报错——一个尚未保存任何工作流的部署是常态，不是配置错误。

<a id="sign-a-saved-workflow"></a>
## 给已保存的 workflow 签名

定义文件 `<name>.js`（或 `.mjs`）旁边要有签名文件 `<name>.js.sig.json`，否则不会加载：

```json
{ "digest": "sha256-…", "publicKeyFingerprint": "sha256:…", "signature": "<base64>" }
```

- `digest` 是 `@deepseek-ai/dsh-workflow-registry` 的 `computeDefinitionDigest(body)`，按定义文件的原样内容计算。
- `signature` 是用某个 offline-signed 信任锚的私钥对 digest 字符串的 UTF-8 字节做的签名，写成 base64。Ed25519 密钥的写法是 `crypto.sign(null, Buffer.from(digest), privateKey)`。
- `publicKeyFingerprint` 指明是哪个锚。

锚由 profile 自己声明：profile 的 `package.json` 里的 `dsh.trustAnchors`，每个是 `{ "mode": "offline-signed", "publicKeyFingerprint": …, "owner": …, "publicKeyPem": … }`，启动时交给 Trust Kernel。配置里只有公钥；签名用的私钥留在给定义签名的人手里。登记的定义把锚的 `owner` 记为 signer。

<a id="what-protects-a-run"></a>
## 真正保护运行的是什么

首先是签名，在引擎看到任何东西之前就核验。以下情况都会拒绝，理由会被记录并写进日志：签名文件缺失（`unsigned`）；它写明的 digest 不是读到的字节算出的那个（`digest-mismatch`）；没有钉住 Trust Kernel，或者它的 offline-signed 锚里没有那个指纹（`no-trust-anchor`）；文件不是签名，或者签名用那个锚的公钥核验不过（`signature-invalid`）。每次拒绝都写明文件名，并指向本 README。

然后是引擎的登记检查。digest 由读到的字节计算，因此「文件变了」与「定义变了」不可能脱节。引擎重算它并拒绝不符者，也在自递归定义被启动之前拒绝它。

被拒的文件连同名字与理由记录在 `ctx.savedWorkflows.refused` 上，加载继续。一个格式错误的文件不能让 harness 起不来，而操作者需要知道是哪个文件、为什么被拒。

挂载到一个没有登记接口的引擎上会大声拒绝，否则已保存的工作流会加载进虚空，而组合看上去仍然正确。

## Model Experience

None, as this package reads definition files and registers them and registers nothing model-facing.

#### KV Cache effect

此处没有任何内容进入模型请求，因此提供方的缓存复用不受影响。它加载的内容只通过 `workflow` 工具自身的界面到达模型。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **出厂 profile 在配置锚之前不会加载任何已保存的 workflow。** 没有出厂 profile 声明 `dsh.trustAnchors`，所以在运维加上 offline-signed 锚并照上面的办法签名之前，每个已保存的定义都会被拒绝并写进日志。
- **只有 offline-signed 锚能核验已保存的定义。** 此处不查 `dsh.trustAnchors` 里的 Sigstore 锚。
- **每个文件都登记为版本 1。** 加载器没有版本历史的概念：改动 body 后重新保存会在同一名字下登记一个新 digest，而 body 未变的文件会以 `already-registered` 被拒。版本编号属于写这个目录的那一方。
- **目录只在挂载时读取一次。** harness 运行期间新增的文件不会被拾取；`dsh-skill-filesystem` 会监视它的根目录，本包不会。

不发布运行时 invariant 伴随包：本插件只持有一份「加载了什么」的列表、不观测其它任何东西，因此检查器只会拿这份列表和它自己比较，而不是校对两个独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本 Dev Note 是维护者的工作上下文：开放问题与尚未定下的方向。它明确不具权威性——已发布的行为与限制在上面各节以及包代码中。

登记不在 `WorkflowEngine` 这个 seam 上，因此本加载器以结构方式命名它唯一需要的操作，并拒绝挂载到缺少该操作的引擎上。把 `RegisteredDefinition` 下移进 `@deepseek-ai/dsh-workflow` 可以让 seam 声明 `registerDefinition` 并去掉这个结构检查；已量：该移动涉及十个文件，全部在两个 workflow 包及其测试内。seam 是否应当承载登记——那会迫使每个引擎都实现它——尚未定下，在定下之前，结构端口是更小的承诺。

</details>
