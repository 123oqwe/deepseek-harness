---
description: "面向用户与维护者的最小、不可替换 Trust Kernel 类型表面：kernel 拥有什么、周围哪些仍是插件。"
kind: "package-library"
---

# @deepseek-ai/dsh-trust-kernel

[English](README.md) | 中文

## 概述

`dsh-trust-kernel` 固化了 Epic P0-02 的 Trust Kernel 可能发放给运行时的窄、不可伪造能力表面：一个 root identity、一个 signature-roots handle、一个 policy enforcement entrypoint、一个 audit append entrypoint、一个 secret broker handle，以及一个 sandbox attestation verifier——恰好六项，不多不少。dsh 中其余一切——模型、工具、存储 provider、workflow、memory provider、UI——仍是普通的、可替换的 Cordis 插件；完整边界与六项为何都不是 Cordis Service，见 `docs/architecture/trust-kernel-boundary.md`。

本包目前只交付其 Contract 阶段切片：`TrustKernel` 类型表面（`src/types.ts`）及其不变式伴生插件（`src/invariant.ts`）。本切片尚无 `src/index.ts`——尚无构造出的 `TrustKernel` 值，也没有 `ctx.provide` 接线。见[已知限制与延期工作](#known-limitations-and-deferred-work)。

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

导入 `TrustKernel` 类型表面来为插件收到的能力标注类型——而不是用来构造它：

```ts
import type { TrustKernel, TrustKernelPolicyQuery } from '@deepseek-ai/dsh-trust-kernel/types'

declare function handleRequest(kernel: TrustKernel): void

function checkPolicy(kernel: TrustKernel, payload: unknown): boolean {
  const query: TrustKernelPolicyQuery = { payload }
  return kernel.policyEnforcement(query) === 'allow'
}
```

本包中，`TrustKernel` 及其三个不透明 handle 成员（`TrustKernelRootIdentity`、`TrustKernelSignatureRoots`、`TrustKernelSecretBrokerHandle`）都没有导出的构造函数。后续切片的 `src/index.ts` 才是唯一构造 `TrustKernel` 值、并在 Cordis `Context` 存在之前就用 `ctx.provide('trustKernel', kernel)` 将其钉入 context 的地方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释包背后的设计决策；可观察的类型约定已在[使用本包](#use-this-package)中完整覆盖。

### 设计哲学

- **恰好六项拥有的能力，不多不少。** `TrustKernel` 只声明 Epic P0-02 must 条款所列内容：root identity、signature roots、policy enforcement entrypoint、audit append、secret broker handle、sandbox attestation verifier。
- **不可伪造的 handle，而非品牌化字符串。** `TrustKernelRootIdentity`、`TrustKernelSignatureRoots`、`TrustKernelSecretBrokerHandle` 均由本模块声明但从不导出的 symbol 打标，因此任何调用方都无法在不做显式不安全类型转换的情况下构造出一个合法值。这刻意不同于 `@deepseek-ai/dsh-brand` 的 `Branded<B>` 字符串品牌写法：`Branded<B>` 在运行时就是一个裸字符串，其 `brandString()` helper 可以把任意字符串转换成它——这适合名义上的*标识符*，但不适合不可伪造的*能力*。
- **领域无关的 entrypoint。** `policyEnforcement`、`auditAppend`、`sandboxAttestationVerifier` 只接受不透明（`unknown`）的 payload。kernel 只负责路由与追加；它从不解释一个 query、一条 audit entry 或一份 attestation 的含义——那是调用插件自己的业务领域逻辑。
- **永远不是 Cordis 插件。** 本包不导出 `Config` schema，也不导出 `apply(ctx, config)` entry，因此这里的任何东西都无法用 `ctx.plugin(...)` 挂载、被 `cordis.patch.yml` 的某一行 patch，或被插件卸载替换。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | `TrustKernel` 类型表面：其六个能力成员、三个不透明 handle 类型，以及三个窄 entrypoint 函数类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：在本 Contract 阶段切片中为已解释的空实现——尚无构造出的 `TrustKernel` 值可供检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- `docs/architecture/trust-kernel-boundary.md`——kernel 拥有什么、为何其中没有一项是 Cordis Service，以及周围的插件/永不插件划分。
- [`spec/trust-kernel.md`](../../../spec/trust-kernel.md)——规范化的能力表面与 Epic P0-02 的 must/acceptance 条款。
- [`packages/boot/app-boot`](../../boot/app-boot/README.zh.md)——拥有 `ctx.provide('dshHomePath', ...)`，是后续切片如何把构造出的 `TrustKernel` 钉入 Cordis `Context` 的先例。

-----

<a id="model-experience"></a>
## 模型体验

### Kernel 类型表面

#### 模型看到什么

什么都没有。本 Contract 阶段切片只导出类型——`src/types.ts` 不贡献任何运行时值，因此本包中没有任何东西会渲染进模型请求、系统提示词或工具 schema。

#### Token 影响

零直接影响：本包不贡献任何 prompt 或 schema 文本。

#### KV Cache 影响

独立：本包不注册任何参与模型请求的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **尚无构造出的 `TrustKernel` 值** ——本 Contract 阶段切片只交付类型表面与一个已解释的空不变式伴生插件；`src/index.ts`（构造、`ctx.provide` 接线，以及运行时冻结的深度不可变性检查）是后续切片的交付物。见 [`spec/trust-kernel.md`](../../../spec/trust-kernel.md#contract-stage-slice)。
- **尚无启动期强制执行** ——kernel 未初始化时生产 profile 必须 fail closed、开发 profile 可显式启用 insecure 模式的行为，属于同一后续切片与 `packages/boot/app-boot`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决问题与尚未确定的方向。它明确不具备权威性——已交付的行为与限制记录在上方各节与包代码中。

无。

</details>
