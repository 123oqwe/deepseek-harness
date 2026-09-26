---
description: "插件的警告与错误写到 stderr：把插件经 ctx.logger 记下的内容写到操作者看得见的地方的 exporter，供运行出厂宿主的用户与改动其行路由的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-logger-stderr

[English](README.md) | 中文

## 概述

`dsh-logger-stderr` 把 DeepSeek Harness 插件经 `ctx.logger` 记下的警告与错误写到进程的 stderr，渲染出的每一行写一行，行首加 `dsh: `，与 launcher 自己的诊断一样。没有它，这些消息只留在 Cordis 的内存缓冲里，没有操作者会读（BLOCKED-336）。它从不写 stdout：headless 宿主在那里打印结果，ACP 与 SDK 宿主在那里传协议帧。`dsh-base` 与 `dsh-sdk-minimal` 都挂载它，所以每个出厂 profile 都会写出这些行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 哪些消息写到 stderr

这一行默认写 `error` 与 `warn` 两类消息；用 `types` 选别的类别。

```yaml
- id: logger-stderr
  name: '@deepseek-ai/dsh-logger-stderr'
  config:
    types: ['error', 'warn']
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `types` | `['error', 'warn']` | 写到 stderr 的消息类别；其余类别只留在内存缓冲里 |

这一行挂载之前插件已记下的消息，会在它挂载时从内存缓冲里写出一次。`@deepseek-ai/dsh-app-boot` 让整棵树的 logger 以 `WARN` 级别挂载，所以缓冲里既留错误也留警告。

### 自己掌管 stderr 版面的宿主

`ctx.loggerStderr.routeThrough(write)` 把每一行交给 `write`，直到返回的 disposer 被调用。headless runner 在流式输出推理时接管这些行：一行写出之前先收住正在进行的推理分段，下一段推理文字在新的 `dsh: reasoning:` 头下开始。路由抛错也不会丢行，这一行会直接写到 stderr。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | `Config`、带 `routeThrough` 的 `LoggerStderr` 服务，以及按 vendored console exporter 的版式渲染消息的 exporter |
| — | 不发布运行时不变量配套入口：本插件只写行、持有一个路由，不拥有两个观察者可能看到不同结果的持久关系。 |

exporter 经 `ctx.logger.exporter()` 注册，所以卸载插件会移除它。vendored Cordis 的本地修改 22（`vendor/README.md`）让这次移除删掉的是这个 exporter 自己的注册，而不是最近一次的注册。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Agent Note：插件的警告与错误写到 stderr](../../../.agents/notes/implemented/bug-fix/2026-09-26-plugin-warnings-and-errors-reach-stderr.zh.md)——为什么是 stderr、为什么加 `dsh: ` 前缀，以及 headless runner 怎样让这些行不落进推理分段。
- [Vendored 包](../../../vendor/README.md)——本地修改 21 与 22，本包在关停与卸载时的行为依赖它们。
- [runtime-diagnostics 组地图](../README.zh.md)——相邻的诊断包。

-----

<a id="model-experience"></a>
## Model Experience

无，这些行写到操作者的 stderr，从不进入模型请求。

#### KV Cache 影响

这里没有任何内容进入模型请求。

## 已知局限与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些是本包当前的约束，不是待办清单。

- **同一时间只有一个路由。** 后装的 `routeThrough` 会替换先装的，此后先装路由的 disposer 不再改变任何东西。
- **写出的是文本行，不是记录。** 每一行是 console exporter 的渲染结果前加 `dsh: `。需要结构化记录的使用方读内存缓冲，或注册自己的 exporter。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>
