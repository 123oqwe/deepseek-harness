---
description: "`/trust-skills` 命令：在与宿主用户确认后，把当前工作区提升到 trusted-execute，使项目自带的 skill 可用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-workspace-trust

[English](README.md) | 中文

## 概述

`/trust-skills` 把会话所在的工作区提升到 `'trusted-execute'`——这正是 [`@deepseek-ai/dsh-skill-filesystem`](../../skill/skill-filesystem/README.zh.md) 接纳项目自带 skill 目录所需的状态。它经 [`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.zh.md) 请宿主用户确认，然后把决定交给挂载的 provider 背后的 `@deepseek-ai/dsh-workspace-trust` 的 `requestTrustUpgrade`。它自己不持有任何信任规则。

**为什么是命令，而不是在使用点发问。** 项目 skill 在 `'trusted-read'` 下不会被列出——它们的名称与描述是项目提供的文本，而把这些送到模型面前正是一个未受信任的仓库想要的。因此不存在「agent 去取某个项目 skill、于是可以就它发问」的时刻：那次取用根本不会发生。请求只能来自宿主用户，他是唯一一个可以在不被该仓库影响的情况下想要这件事的参与者。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

把它挂进一个具备 `commands`、`approval` 与某个 `workspaceTrust` provider 的组合。其中任何一项缺席时命令仍会注册，并报出缺的是什么——用户键入的命令理应得到一个回答。

```yaml
- name: '@deepseek-ai/dsh-command-workspace-trust'
```

键入 `/trust-skills` 会确认一次；得到 `allowed-once` 才提升工作区。其余任何结果——拒绝、取消、或根本没有应答者——都让它保持原状。

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

**即使命令是用户自己键入的**，仍然要经 approval 确认。命令表达的是用户想要什么；而 `approval/asked` + `approval/decided` 这一对记录的是：他被告知了这意味着什么，并且同意了。只有命令不会留下这一对，而 must[2] 要求的是交互**与**审计两者。

`grantTrust` 传入的是会话上已附着的 principal，绝不由本包自行构造：`requestTrustUpgrade` 会拒绝非宿主 principal，而一个能自备 principal 的包就会成为第二个可以授予信任的地方。

</details>

<a id="model-experience"></a>

## 模型体验

### `/trust-skills` 的授予

#### 模型看到什么

不直接看到任何东西：本包不注册工具、不注入提示词、不写任何模型可见的消息。模型看到的是其后果——授予成功后，项目自己的 skill 会出现在它被提供的目录里，而此前一个也没有。

#### Token 影响

本包自身没有。授予成功会让 `skill-filesystem` 列出项目的 skill 目录，因此到达模型的目录会按项目提供的内容增长；本包自己写的东西一样也不在请求里。

#### KV Cache 影响

本包自身没有。授予成功会改变 `skill-filesystem` 列出的内容，这会让缓存前缀失效一次——就在新目录第一次进入请求的那一步。

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

- **`trusted-read` 走的是另一条路。** 读状态是自动发问的——在一个会话第一次要加载未信任工作区的指令文件时；本命令只负责 execute 状态。两者是后果不同的两个答案。
- **没有降级命令。** `downgradeTrust` 在决策包里存在且没有调用者。从宿主 UI 降低某个工作区的信任不在本 epic 范围内。
- 不发布运行时不变量伴随包：本包不持有状态、不拥有任何关系——它只发问，而绑定归它调用的 provider 所有，因此这里的检查器没有属于自己的东西可供比对。

-----

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本命令的第一版直接调用信任 provider，其用例也直接调用 handler。两者都通过，而且在命令根本没注册的情况下也照样会通过：那个用例证明的是一个函数能工作，而不是敲 `/trust-skills` 能到达它。现在它经由真实的命令注册表派发，任何关于本包的用例都必须是这个形状。

</details>
