---
description: "workspace trust 能力的宿主本地 Provider：把工作区绑定到它首次解析到的文件系统身份，在每次读取时重新核对该绑定，并为会话 cwd 回答项目加载门禁。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-trust-local

[English](README.md) | 中文

## 概述

`dsh-workspace-trust-local` 提供 `ctx.workspaceTrust`——harness 在加载任何来自项目目录的内容之前读取的接缝。所有决策归 `@deepseek-ai/dsh-workspace-trust` 所有，所有文件系统观测归 `@deepseek-ai/dsh-workspace` 的 `observeWorkspaceIdentity` 所有；本包只为会话 `cwd` 把二者绑定起来，并在进程生命周期内保存所得记录。它不引入第二张决策表。

授权（grant）写的是路径，但信任绑定到该路径首次被读取时所解析到的身份。之后每次读取都会重新观测并核对，因此原地替换目录、改指 symlink、或把目录从其路径下移走，都会降级为 `'untrusted'`，且都不会从配置中重新授权：一次授权是信任某一个目录的许可，而不是信任此后占据该路径的任何东西的长期许可。

## 目录

- [开启该边界](#turn-the-boundary-on)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="turn-the-boundary-on"></a>
## 开启该边界

`dsh-base` bundle 中该行默认 **disabled**。在没有挂载 Provider 时，`ctx.get('workspaceTrust')` 为 `undefined`，每个 Consumer 加载的内容与本边界存在之前完全一致——包括未信任仓库的 skill 与 instructions。挂载 Provider 才会开启该边界，而这是运维者的动作，不是默认值。

这个默认是刻意的。一个已启用但没有任何 grant 的 Provider 会让所有工作区同时变为未信任，从而让所有已发布 profile 的现有用户都无法再加载项目 skill 与项目自己的 `AGENTS.md`。默认开启并且弄坏所有人的边界，只会被关掉而不会被采用；本边界选择可被发现、且距离开启只差一次编辑。

开启方式：在你的 `cordis.patch.yml` 中启用该行，并授权本宿主信任的工作区：

```yaml
- id: workspace-trust-local
  disabled: false
  config:
    grants:
      - path: /home/you/projects/your-own-repo
        state: trusted-execute
```

未出现在 `grants` 中的路径解析为 `'untrusted'`。`trusted-read` 授权该工作区的 instruction 文件但不授权任何可执行内容；`trusted-execute` 额外授权其 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`stateFor(cwd)` 观测该目录的规范路径以及 device/inode/创建时间身份，然后要么把已有记录与这次新鲜观测进行核对，要么在首次读取时按授权状态绑定一条新记录。

被授权的路径只做**一次**规范化并复用。若每次调用都重新规范化，授权就会跟着自己的路径走，而不是指名一个目录：改指一个被授权的 symlink 会把该授权规范化到攻击者的目录上，而后者随即作为首次绑定被匹配并获得信任——这正是本 epic 所禁止的继承。本包自己的 symlink 改指用例在实现过程中把它作为真实失败捕获到了，因此这处记忆化是承重的，而非性能细节。

完全无法观测的路径解析为 `'untrusted'`：无法观测的路径无法被确认为某次授权所绑定的那个目录，因此它得到的就是陌生人得到的待遇。

-----

<a id="model-experience"></a>
## 模型体验

### 工作区信任解析

#### 模型看到什么

不直接看到任何东西：本包不注册工具、不注入提示词、不写会话事件，因此没有任何请求字段承载它的数据。模型看到的是其后果——在 `'untrusted'` 状态下，工作区自己的 instruction 文件与 skill 不会出现在请求里，就好像该仓库根本没有它们一样，也不会有任何说明省略原因的提示，因为「内容被扣留」的提示本身就会成为一个未信任仓库可以瞄准模型的注入面。

#### Token 影响

本包本身没有。扣留内容的 Consumer 会比原本少发出一些 token；不会新增任何 token。

#### KV Cache 影响

本包本身没有直接影响。信任状态变化会改变 Consumer 组合出的 instruction baseline，从而在变化生效的那一步使缓存前缀失效一次。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **grants 暂代宿主用户交互。** 本 epic 要求信任升级由宿主用户交互完成。这里没有接入审批/交互接缝，因此目前由配置的 grant 承担该权威。`@deepseek-ai/dsh-workspace-trust` 的 `requestTrustUpgrade` 已经拒绝任何非 `'user'` principal，未来的交互式升级路径会调用它。
- **不写审计记录。** 本 epic 同时要求升级时追加审计记录。接入真实的 Trust Kernel `auditAppend` 受阻于 vendored Cordis `Fiber` 结构性修复（[trust-kernel 边界](../../../docs/architecture/trust-kernel-boundary.zh.md)）；在此之前不伪造审计 sink。
- **记录只存活于进程生命周期。** 信任不跨重启持久化，因此被授权的工作区会在下次启动时重新绑定。

-----

-----

### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

已授予的路径只解析一次并被记忆。若每次调用都重新规范化,改指一个已授予的
符号链接会把授权移到它当前指向的目录上,而后者会被当作首次绑定并被信任 ——
这正是 `acceptance[1]` 要防止的信任继承。这里的记忆化是正确性要求,不是性能
取舍。

</details>
