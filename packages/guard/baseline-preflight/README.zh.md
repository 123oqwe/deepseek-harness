---
description: "在仓库偏离已捕获的架构/协议基线时中止应用启动的启动期门禁，供接线或排查 P0-01 预检查的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-baseline-preflight

[English](README.md) | 中文

## 概述

`pnpm baseline:capture`（`scripts/release/baseline-fingerprint.mjs`）会把一个 checkout 的架构与协议关键指纹——Git SHA、工具链、workspace package 名称、默认 bundle 行 ID、协议/事件 schema 哈希，以及 pnpm lockfile 哈希——冻结进 `.dsh/baseline.json`。`dsh-baseline-preflight` 在启动时重新校验该指纹：如果工作树相对已捕获基线发生漂移，`apply` 会抛出一个列出每个漂移路径的错误，该抛出会沿 Cordis fiber 激活链传播，在任何执行批次开始前中止启动。在 `<repoRoot>/.dsh/baseline.json` 处没有已捕获基线的 checkout 未加入该机制，启动不受影响。共享 `dsh` base 组合中本插件的行带有 `disabled: true`——按 profile 选择性启用，而非共享 base 的默认行为——因为本仓库自己已提交的 `.dsh/baseline.json` 会持续落后于真实 `HEAD`（这是一个移动目标，不是需要在此修复的 bug）；无条件启用该行会中止从本 checkout 发起的每一次普通 `pnpm dsh` 调用。想要该门禁的 profile 会显式重新启用该行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`dsh` base 组合已经带有该行，但它是禁用的——想要该门禁的 profile 按 `id` 重新启用它，与重新启用任何已禁用的 base 行方式相同。只有在运行过 `pnpm baseline:capture` 的 checkout 中它才会真正做事；其余启动完全不受影响。

### 何时选择

选择它以执行 P0-01 的 MUST 条款：一旦本 checkout 的架构/协议指纹相对最后一次捕获的基线发生漂移，任何针对它的执行批次都不应继续。若某次启动本就与已捕获基线无关（禁用的默认行已经在那里到处空操作），或者已经启用它、想把某个特定 `repoRoot` 排除在门禁之外时，才需要避免启用它（或把 `repoRoot` 覆盖到一个没有 `.dsh/baseline.json` 的目录）。

### 设置

在某个 profile 自己的 `cordis.patch.yml` 或 `--patch` overlay 中，按 `id` 重新启用 base 组合中已禁用的行（与 `apps/web/tests/pwsh-terminal.overlay.yml` 重新启用 `tool-pwsh` 所用形状相同）：

```yaml
- id: baseline-preflight
  name: '@deepseek-ai/dsh-baseline-preflight'
  disabled: false
```

不带 `config` 时，它校验 `process.cwd()`，与 CLI 自身默认值一致。用 `repoRoot` 固定某个 checkout，而不是启动时的 cwd：

```yaml
- id: baseline-preflight
  name: '@deepseek-ai/dsh-baseline-preflight'
  disabled: false
  config:
    repoRoot: /path/to/checkout
```

完全不包含 base 组合的独立组合（某个包本地测试 fixture、无关的目录树）则直接挂载插件，无需覆盖 `disabled` 字段：

```yaml
- name: '@deepseek-ai/dsh-baseline-preflight'
```

### 你会得到什么

无漂移：`apply` 返回，启动照常进行。有漂移：`apply` 抛出 `Error: baseline-preflight: checkout has drifted from its captured baseline …`，列出每个漂移的路径与字段，与 `pnpm baseline:verify` 的报告完全一致；该抛出会中止 Cordis Loader 激活，因此 `boot()`（`@deepseek-ai/dsh-app-boot`）会 reject，应用永远不会启动完成。在 `<repoRoot>/.dsh/baseline.json` 处没有已捕获基线，或在打包/安装环境中校验工具本身不存在：`apply` 直接返回而不做校验——这个 checkout 还没有可供校验的对象。行被禁用（base 组合的默认状态）：`apply` 根本不会运行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件如何抵达真正的漂移检查，以及为何它在未注册的 checkout 中保持启动期空操作；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 漂移检查的唯一事实来源

`scripts/release/baseline-fingerprint.mjs` 导出 `verifyBaseline(repoRoot)`——与 `pnpm baseline:verify` CLI 路径调用的是同一个函数——因此启动期检查与独立命令永远不会对“什么算漂移”产生分歧。该脚本是位于每个包 TypeScript 项目之外的纯 `.mjs` 仓库工具文件；`src/index.ts` 中的 `verifyBaseline` 用一个基于本模块（`import.meta.url`）计算出的 `file://` URL 构建的动态 `import()` 抵达它，而非静态说明符，因此这个无类型的跨边界导入不需要项目引用，TypeScript 也永远不会尝试解析该脚本自身的模块图。等待到的结果只在这一处被收窄为 `BaselineFingerprintModule`。

### 为何 base 组合中的行默认禁用

base 组合中存在这一行（`packages/bundle/base/cordis.patch.yml`），是为了让组合图为每个 base 驱动的 profile 声明本门禁的身份，但它带有 `disabled: true`——与上方 `hmr` 行相同的模式（“模块热重载按 profile 选择性启用”）。促成这一点的是两个事实，而非一个：`repoRoot`（默认 `process.cwd()`）对绝大多数真实使用场景而言，是终端用户自己的项目目录，与本 monorepo 的基线指纹机制毫无关系；而即便对本 checkout 自身的根目录而言，已提交的 `.dsh/baseline.json` 也是一个在两次捕获之间会落后于真实 `HEAD` 的移动目标，因此默认启用的行同样会中止本仓库自身的普通 `pnpm dsh` 使用。想要该门禁的 profile 会显式启用该行（见上文“设置”）。

### 为何缺失基线或无法解析工具都是空操作而非失败

一旦某个 profile 启用了该行，还有两个条件会让 `apply` 保持空操作而非抛出——两者都是“有什么可校验”的范围事实，而非被悄悄跳过的漂移：

- **没有已捕获基线。** `apply` 首先检查 `existsSync(join(repoRoot, '.dsh/baseline.json'))`：不存在则立即返回，把该 checkout 的入驻步骤（`pnpm baseline:capture`）留作单独、刻意的动作。
- **校验工具无法解析。** `scripts/release/baseline-fingerprint.mjs` 是仓库内部工具，从不属于本包已发布的 `files`，因此只存在于本 monorepo 自己的源码树中。`loadBaselineFingerprintModule` 只把动态 `import()` 这一步包在 try/catch 中（绝不包含 `verifyBaseline` 本身）；解析失败——打包/安装场景——会被当作与“没有可供校验的已捕获对象”完全相同的情况处理。

只有当已捕获基线与校验工具二者都存在时，漂移才是相对该 checkout 明确捕获过的东西的真实回归，此时 `verifyBaseline` 返回 `ok: false` 会作为中止启动的错误向上传播。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`／`Config`／`apply`、抵达 `verifyBaseline` 的动态导入、漂移消息格式化 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件（无运行时不变式：插件只执行一次启动期检查，不拥有包级事件历史） |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从本门禁延伸到它所校验的指纹与所属的 guard 组。

- [`scripts/release/baseline-fingerprint.mjs`](../../../scripts/release/baseline-fingerprint.mjs)——本插件调用的 `capture`／`verify` CLI 与共享的 `verifyBaseline`。
- [测试策略](../../../docs/testing.zh.md)——启动期校验门禁一节与基线指纹报告格式。
- [`tests/release/baseline-fingerprint.spec.ts`](../../../tests/release/baseline-fingerprint.spec.ts)——CLI 级的 capture/verify 约定。
- [guard 组映射](../README.zh.md)——同组的 guard 包。

-----

<a id="model-experience"></a>
## 模型体验

无：本插件不添加提示词、schema 或工具。它要么让启动照常继续，要么在任何 agent、session 或工具注册之前就中止启动，因此模型永远不会观察到它导致的部分或降级组合。

#### KV Cache 影响

无；启动要么完整完成，要么在任何请求组装之前就已中止。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明该门禁何时不合适。它们是当前包约束，不是任务积压。

- **选择性启用，而非默认启用**——base 组合中的行是 `disabled: true`；profile 需要显式启用它（见[设置](#use-this-package)）。目前没有任何 profile 这样做。
- **没有基线就没有检查**——从未运行过 `pnpm baseline:capture` 的 checkout 启动不受影响；本插件只针对真正捕获过的指纹执行漂移检查，绝不针对基线的缺席本身。
- **只在本 monorepo 自己的 checkout 中才有意义**——`scripts/release/baseline-fingerprint.mjs` 是仓库内部工具，从不属于本包已发布的 `files`；一个仍然启用该行的打包/安装消费者会得到永久性空操作，而不是错误，因为校验工具本身根本无法解析。
- **仅在启动期生效**——门禁只在插件激活时运行一次；长期运行的进程在启动完成之后再发生漂移，要到下一次启动才会被发现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
