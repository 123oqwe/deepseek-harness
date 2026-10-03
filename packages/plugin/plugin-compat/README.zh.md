---
description: "Epic P1-08 插件 ABI、能力与 schema 兼容性协商的类型表面与整图求解器：每次启动只做一次确定性求解，出现矛盾时给出最小 unsat core，缺少必需能力时以 fail-closed 方式阻断。"
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-compat

[English](README.md) | 中文

## 概述

`dsh-plugin-compat` 固定了 Epic P1-08 插件 ABI、能力与 schema 兼容性协商的类型表面与求解器签名：每个插件 manifest（元数据清单）都声明运行时 API 范围、schema 范围、必需／可选的能力依赖，以及针对这些依赖的提供方约束（must[0]）；`solvePluginGraph` 在任何插件加载之前，用一次调用把一次启动的插件图中所有 manifest 一起求解（must[1]）；真正的图级矛盾会报告一个最小 unsat core，只列出实际冲突的约束（must[2]）；缺少必需能力或安全关键能力时，结果只可能是 `'blocked'` 激活，绝不会悄悄降级为 `'active'`（must[3]）。

`src/index.ts` 提供类型表面和可用的整图求解器 `solvePluginGraph`：它为已提供的能力建立索引，遇到提供方约束矛盾时报告最小 unsat core，否则按 `PluginId` 排序、为每个 manifest 返回一条激活结果，并附上由内容派生的 `planId`。`src/solver.ts` 在此之上补充真实启动所需的两件事：`resolveHostCompatContext` 从运行中的 `@deepseek-ai/dsh-schema-registry` 构建 `HostCompatContext`；`resolveActivatedGraph` 把整张图推到不动点，使因自身约束被阻断的插件不再满足其消费方的能力需求。`tests/solver.spec.ts` 与 `tests/provider-resolution.spec.ts` 用 40 个用例覆盖这两部分。本包不发布 invariant 伴生包：它不构造需要检查的注册表、`Context` 或其他可变关系，每个导出都是普通类型，或作用于调用方所提供数据的纯函数。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

整图求解只需传入普通数据，不访问文件、进程或 Cordis `Context`：

```ts
import { solvePluginGraph } from '@deepseek-ai/dsh-plugin-compat'
import type { HostCompatContext, PluginCompatManifest } from '@deepseek-ai/dsh-plugin-compat'

declare const manifests: readonly PluginCompatManifest[] // every plugin's declared manifest for this boot
declare const host: HostCompatContext // this build's runtime API version + currently registered schema versions

const solution = solvePluginGraph(manifests, host)
// solution.solvable === false: solution.unsatCore names the minimal set of
//   conflicting manifest constraints, never a bare "failed"
// solution.solvable === true: solution.loadPlan.activations has one row per
//   manifest — 'active' (with any disabled optional capabilities listed) or
//   'blocked' (with the missing required capabilities listed); a caller
//   never executes a 'blocked' plugin's code
```

`solvePluginGraph` 与 `resolveActivatedGraph` 是作用于已算好数据的纯函数：不读文件、不启动进程，也不构造 Cordis `Context`。`resolveHostCompatContext`（`src/solver.ts`）是唯一读取运行时状态的导出：它调用 schema 注册表的 `listSchemas()`，根据本次构建的真实注册构建 `HostCompatContext`。`parseCompatDeclaration` 把一个插件包 `package.json` 中的 `dsh.compat` 字段校验为 `PluginCompatManifest`；`DSH_RUNTIME_API_VERSION` 是启动时求解所依据的整数。`packages/boot/app-boot/src/profile.ts` 的 `negotiateProfileLayerCompatibility` 调用这两者，用真实插件包的 manifest 提供 `manifests`；`composeProfile`（`apps/cli/src/profile-boot.ts`）在每次真实的 `dsh --profile` 启动中、任何组合包 patch 到达 `boot()` 之前运行这次求解。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节（点击展开）</summary>

本节说明本包背后的设计决策；可观察的类型约定已在[使用本包](#use-this-package)中完整说明。

### 设计哲学

- **与 Plugin Manifest v2 分开的另一条协商轴。** `@deepseek-ai/dsh-plugin-manifest` 的 `PluginManifestV2`（Epic P1-01，本 epic 的前置项）声明的是用于权限审计的能力*访问*：side-effect class、auth audience、destinations。本包声明的是用于图求解的能力*兼容性*：范围、必需与否，以及提供方约束。两个类型互不扩展；`src/index.ts` 的模块文档记录了它们为何保持分离。
- **结构化整数范围，而不是 semver 字符串。** `RuntimeApiRange`／`SchemaRangeRequirement` 按普通整数大小比较，沿用本仓库单调递增的 `SCHEMA_VERSION`／`SESSION_FORMAT_VERSION` 约定，而不是解析 semver 范围字符串；这样，确定性求解器（acceptance[0]）就不会依赖范围字符串解析器自身的行为。
- **整张图、一次调用、没有惰性替代。** `solvePluginGraph` 是本包唯一导出的操作。不存在调用方可以转而使用的逐插件 `resolveOne`：must[1] 的「boot 前求解整个插件图」由结构保证，而不是靠调用方记得遵守的纪律。
- **一个 `pluginId` 只指一个插件。** 图中同一个 `PluginId` 声明两次时，`solvePluginGraph` 直接抛错，不去求解。同一身份下的两个 manifest 可能结论不一（一个 `active`、一个 `blocked`），而 `PluginId` 的顺序区分不了它们，于是数组顺序会决定计划，acceptance[0] 就不成立；改按内容排序虽能恢复确定性，却仍会给一个插件输出两条互相矛盾的计划行，而 epic 的「只有唯一求解出的计划才能激活」这道关卡不接受这种情况。manifest 来自 `package.json` 解析，这是不可信的文件边界，所以重复身份属于配置错误，会大声失败，而不是取最先出现的那一行。
- **无法表示部分激活。** `PluginActivationStatus` 的 `'active'` 变体没有 `missingCapabilities` 字段，`'blocked'` 变体没有 `disabledOptionalCapabilities` 字段。must[3] 的「禁止靠 try/catch 静默降级安全能力」在类型层面没有可以靠捕获内部错误落入的位置：返回类型本身就构造不出部分激活的形态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | manifest、上下文与求解结果的类型表面（`PluginCompatManifest`、`HostCompatContext`、`PluginGraphSolution`、`LoadPlan`、`UnsatCore` 等），以及一次调用完成整图求解的 `solvePluginGraph` |
| [`src/solver.ts`](src/solver.ts) | `resolveHostCompatContext`（取自运行中 schema 注册表的宿主事实）与 `resolveActivatedGraph`（沿提供方边把阻断级联到不动点，并给出存活下来的 `ProviderBinding`） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`tests/solver.spec.ts`](tests/solver.spec.ts)：`solvePluginGraph` 的条款覆盖。注册表中声明的每条 must[] 条款各一个用例（must[0] 拆成声明形态与提供方约束两个用例），每条 acceptance[] 条款各一个用例（acceptance[1] 拆成它点名的两种 fail-closed 场景）；之后的 Fault 与 Characterization 两节在退化和对抗性的图下检验求解：重复的插件身份、只与自身矛盾的 manifest、空图、菱形依赖、版本冲突、可选提供方，以及对生成的图及其排列运行、带固定种子的 fast-check 性质测试。
- [`tests/provider-resolution.spec.ts`](tests/provider-resolution.spec.ts)：`src/solver.ts` 的用例：针对真实 schema 注册表的宿主上下文解析、提供方绑定，以及级联到不动点。
- [`@deepseek-ai/dsh-schema-registry`](../../schema/schema-registry/README.zh.md)：拥有 `SchemaId`／`SchemaVersion` 身份；本包的 `SchemaRangeRequirement` 直接复用它，而不重新声明。
- [`@deepseek-ai/dsh-plugin-manifest`](../plugin-manifest/README.zh.md)：本仓库另一个插件能力 Contract 阶段包（Epic P1-01），声明的是能力*访问*，而不是本包的兼容性*范围*；本包的包布局与纯函数约定沿用它。
- [`packages/host/plugin-inventory/src/types.ts`](../../host/plugin-inventory/src/types.ts)：在同一个 Contract 阶段切片里以纯增量方式加入了 `compatActivation?: PluginActivationStatus`，即求解得到的 `LoadPlan` 对外呈现的字段（注册表自己的校验指引：「将结果写入 `--dump-config` 和 plugin inventory」）。把真实求解值接进这个字段，属于覆盖注册表 `--dump-config`／inventory 校验项的后续阶段，不属于本包，也不属于消费这次求解的启动路径协商。
- [`docs/glossary.md#capability-seam`](../../../docs/glossary.zh.md#capability-seam)：`ProviderConstraint` 据以收窄的 Service Definition／Service Provider／Consumer 词汇。

-----

<a id="model-experience"></a>
## 模型体验

无，本包只导出类型与一个纯求解函数签名，不注册任何模型可见的内容。

#### KV Cache 影响

这里没有任何内容进入模型请求，因此不影响提供方的缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **`solvePluginGraph` 只比较主版本号。** `checkSchemaRanges` 只拿已注册 schema 的 `major` 与 `SchemaRangeRequirement` 的 `minVersion.major`／`maxVersion.major` 比较，忽略更低的版本分量，所以 manifest 无法表达次版本级的要求。
- **unsat core 只覆盖一种矛盾形态。** 只有当**两个不同 manifest 声明的** `requires-provider` 与 `excludes-provider` 约束指向同一个必需能力的*唯一*提供方时，`solvePluginGraph` 才返回 `solvable: false`。一个 manifest 对同一提供方同时声明两者，只与自身矛盾，因此只阻断它自己，图的其余部分照样求解。其他所有失败（运行时 API 范围或 schema 范围不匹配、缺少必需能力、在多个提供方中提供方约束一个也不放行）都按 manifest 报告为 `blocked` 激活，而不是图级 core。
- **尚未接入真实插件启动。** `packages/boot/app-boot/src/profile.ts`（注册表自己的 `stages.U.files`）不调用 `solvePluginGraph`，也从未根据包自己的 `package.json` 构建真实的 `PluginCompatManifest`：单靠本包无法阻止真实插件加载，也无法拒绝一次真实启动。
- **`packages/host/plugin-inventory/src/types.ts` 的 `compatActivation` 字段只是增量声明。** `PluginInventoryEntry.compatActivation` 已声明，但 `packages/host/plugin-inventory/src/index.ts` 的快照构建器从不填充它。真实启动路径上的求解现在在 `composeProfile`（`apps/cli/src/profile-boot.ts`）中运行：它把结果报告到 stderr，并丢弃被阻断层的 patch，但不把激活结果写进 inventory 快照；把它带过去是注册表另立的 `--dump-config`／inventory 校验项。Fault 阶段没有吸收它：填充该字段并从 `--dump-config` 输出计划属于 Usage 阶段的接线，而不是故障覆盖。它仍未解决，且根本没有写入点：`compatActivation` 只有声明，`git grep compatActivation` 也只能找到那一处声明。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文（点击展开）</summary>

本开发备注是给维护者的工作上下文：未决问题与尚未确定的方向。它明确不具权威性：已交付的行为与限制以上面各节和包代码为准。

无。

</details>
